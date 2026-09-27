//! Pending approvals and questions, keyed by JAM interaction ID.
//!
//! An adapter opens one when its provider asks and waits on the receiver. The
//! reader's answer arrives through `interaction.respond`, is checked against
//! the choices and questions the provider actually offered, and is delivered
//! exactly once. A withdrawn or answered interaction is stale: answering it
//! again is an error, never a second provider response.
use crate::{
    error::JamError,
    protocol::{Interaction, InteractionStatus},
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    Choice(String),
    /// Question ID to chosen option labels or free text.
    Answers(BTreeMap<String, Vec<String>>),
}

struct Pending {
    session_id: String,
    interaction: Interaction,
    reply: oneshot::Sender<Answer>,
}

#[derive(Clone, Default)]
pub struct Interactions {
    pending: Arc<Mutex<HashMap<String, Pending>>>,
}

/// At most this many unanswered requests per runtime; a provider that asks
/// without end cannot grow JAM's memory without bound.
const MAX_PENDING: usize = 256;

impl Interactions {
    pub fn open(
        &self,
        session_id: &str,
        interaction: &Interaction,
    ) -> Result<oneshot::Receiver<Answer>, JamError> {
        let (reply, receiver) = oneshot::channel();
        let mut pending = self.lock()?;
        if pending.len() >= MAX_PENDING {
            return Err(JamError::new(
                "unavailable",
                "Too many provider requests are waiting for an answer.",
            ));
        }
        pending.insert(
            interaction.id.clone(),
            Pending {
                session_id: session_id.into(),
                interaction: interaction.clone(),
                reply,
            },
        );
        Ok(receiver)
    }

    /// The provider withdrew the request, or the turn ended.
    pub fn withdraw(&self, id: &str) {
        if let Ok(mut pending) = self.lock() {
            pending.remove(id);
        }
    }

    pub fn is_pending(&self, id: &str) -> bool {
        self.lock().map(|p| p.contains_key(id)).unwrap_or(false)
    }

    /// Validates and delivers the reader's answer.
    pub fn answer(&self, session_id: &str, id: &str, answer: Answer) -> Result<(), JamError> {
        let mut pending = self.lock()?;
        let entry = pending
            .get(id)
            .filter(|entry| entry.session_id == session_id)
            .ok_or_else(|| {
                JamError::new("stale", "This request is no longer waiting for an answer.")
            })?;
        validate(&entry.interaction, &answer)?;
        let entry = pending.remove(id).expect("checked above");
        entry
            .reply
            .send(answer)
            .map_err(|_| JamError::new("stale", "The provider stopped waiting for this answer."))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<String, Pending>>, JamError> {
        self.pending
            .lock()
            .map_err(|_| JamError::new("internal", "Interaction state is unavailable."))
    }
}

fn validate(interaction: &Interaction, answer: &Answer) -> Result<(), JamError> {
    if interaction.status != InteractionStatus::Pending {
        return Err(JamError::new("stale", "This request was already answered."));
    }
    match answer {
        Answer::Choice(choice) => {
            if !interaction.choices.iter().any(|c| &c.id == choice) {
                return Err(JamError::invalid(
                    "That choice is not offered for this request.",
                ));
            }
        }
        Answer::Answers(answers) => {
            let questions = interaction
                .questions
                .as_deref()
                .ok_or_else(|| JamError::invalid("This request does not ask questions."))?;
            for (key, values) in answers {
                let question = questions.iter().find(|q| &q.id == key).ok_or_else(|| {
                    JamError::invalid("That question is not part of this request.")
                })?;
                if values.is_empty() || values.iter().any(|v| v.trim().is_empty()) {
                    return Err(JamError::invalid("An answer cannot be empty."));
                }
                if !question.multi_select && values.len() > 1 {
                    return Err(JamError::invalid("That question takes one answer."));
                }
                if !question.allow_other
                    && values
                        .iter()
                        .any(|v| !question.options.iter().any(|o| &o.label == v))
                {
                    return Err(JamError::invalid("Choose one of the offered answers."));
                }
            }
            if questions.iter().any(|q| !answers.contains_key(&q.id)) {
                return Err(JamError::invalid("Answer every question before sending."));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{InteractionChoice, InteractionQuestion, QuestionOption};

    fn approval() -> Interaction {
        Interaction {
            id: "interaction-1".into(),
            kind: "command".into(),
            title: "Run a command".into(),
            detail: Some("ls".into()),
            reason: None,
            choices: vec![
                InteractionChoice {
                    id: "accept".into(),
                    label: "Allow once".into(),
                    tone: "allow".into(),
                },
                InteractionChoice {
                    id: "decline".into(),
                    label: "Deny".into(),
                    tone: "deny".into(),
                },
            ],
            questions: None,
            status: InteractionStatus::Pending,
            outcome: None,
            tool_id: None,
        }
    }

    #[tokio::test]
    async fn an_answer_is_delivered_once_and_then_stale() {
        let interactions = Interactions::default();
        let receiver = interactions.open("session-1", &approval()).unwrap();
        assert!(
            interactions
                .answer(
                    "session-1",
                    "interaction-1",
                    Answer::Choice("always".into())
                )
                .is_err(),
            "unoffered choices are rejected"
        );
        assert!(
            interactions
                .answer(
                    "session-2",
                    "interaction-1",
                    Answer::Choice("accept".into())
                )
                .is_err(),
            "another session cannot answer"
        );
        interactions
            .answer(
                "session-1",
                "interaction-1",
                Answer::Choice("accept".into()),
            )
            .unwrap();
        assert_eq!(receiver.await.unwrap(), Answer::Choice("accept".into()));
        let again = interactions
            .answer(
                "session-1",
                "interaction-1",
                Answer::Choice("accept".into()),
            )
            .unwrap_err();
        assert_eq!(again.code, "stale");
    }

    #[test]
    fn withdrawn_requests_are_stale() {
        let interactions = Interactions::default();
        let _receiver = interactions.open("session-1", &approval()).unwrap();
        interactions.withdraw("interaction-1");
        assert_eq!(
            interactions
                .answer(
                    "session-1",
                    "interaction-1",
                    Answer::Choice("accept".into())
                )
                .unwrap_err()
                .code,
            "stale"
        );
    }

    #[test]
    fn questions_require_offered_or_allowed_answers() {
        let mut question = approval();
        question.kind = "question".into();
        question.choices.clear();
        question.questions = Some(vec![InteractionQuestion {
            id: "q1".into(),
            header: None,
            question: "Which?".into(),
            options: vec![
                QuestionOption {
                    label: "A".into(),
                    description: None,
                },
                QuestionOption {
                    label: "B".into(),
                    description: None,
                },
            ],
            multi_select: false,
            allow_other: false,
        }]);
        let one = |v: &[&str]| {
            Answer::Answers(BTreeMap::from([(
                "q1".to_string(),
                v.iter().map(|s| s.to_string()).collect(),
            )]))
        };
        assert!(validate(&question, &one(&["C"])).is_err());
        assert!(validate(&question, &one(&["A", "B"])).is_err());
        assert!(validate(&question, &Answer::Answers(BTreeMap::new())).is_err());
        assert!(validate(&question, &one(&["A"])).is_ok());
    }
}
