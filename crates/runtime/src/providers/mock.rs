use super::{
    Answer, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
    ProviderUpdate, TurnIo, descriptor, set_capability,
};
use crate::{
    protocol::{
        Interaction, InteractionChoice, InteractionQuestion, InteractionStatus, MessageBlock,
        ProviderDescriptor, QuestionOption, SessionStatus,
    },
    runtime::new_id,
};
use std::time::Duration;

/// Deliberately performs no I/O, process invocation, model call or file
/// mutation. It exists for tests, development and the browser preview, and
/// is always labelled as a demonstration.
pub struct MockProvider;

const NOT_DEMO: &str = "Not implemented by the demo provider.";

impl ProviderAdapter for MockProvider {
    fn id(&self) -> &'static str {
        "mock"
    }

    fn unchecked(&self, _config: &ProviderConfig) -> ProviderDescriptor {
        let mut descriptor = descriptor("mock", "Demo provider", "unsupported", NOT_DEMO);
        descriptor.installation = "builtin".into();
        descriptor.authentication = "not-required".into();
        for key in ["create", "resume", "interrupt", "streaming"] {
            set_capability(&mut descriptor, key, "supported", None);
        }
        for key in ["toolApproval", "userInput"] {
            set_capability(
                &mut descriptor,
                key,
                "supported",
                Some("Simulated with the /approval and /question demo prompts."),
            );
        }
        descriptor
    }

    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let descriptor = self.unchecked(&config);
        Box::pin(async move { descriptor })
    }

    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        Box::pin(async move {
            let TurnIo {
                updates,
                mut cancelled,
                interactions,
            } = io;
            let prompt = turn.text.trim();
            if prompt == "/approval" || prompt == "/question" {
                return ask(
                    prompt == "/question",
                    &turn.session_id,
                    updates,
                    cancelled,
                    interactions,
                )
                .await;
            }
            let fail = prompt == "/fail";
            for index in 0..4 {
                tokio::select! {
                    biased;
                    _ = cancelled.changed() => return Ok(()),
                    _ = tokio::time::sleep(Duration::from_millis(350)) => {}
                }
                let mut blocks = vec![MessageBlock::Text { text: "I'll trace the resource and session boundaries, then summarize the result. This is a simulated provider turn.".into() }];
                if index >= 1 {
                    blocks.push(MessageBlock::Tool {
                        id: "mock-inspection".into(),
                        kind: "read".into(),
                        title: "Inspect resource ownership".into(),
                        detail: "Simulated inspection · no files were read or changed".into(),
                        status: if index == 1 {
                            "running"
                        } else if fail {
                            "failed"
                        } else {
                            "completed"
                        }
                        .into(),
                        files: None,
                    });
                }
                if index == 3 {
                    blocks.push(MessageBlock::Text { text: if fail {
                    "The mock provider encountered the requested test failure. Your message remains saved; start another turn to continue."
                } else {
                    "The runtime owns the session; a pane only presents its resource. Detaching a view leaves work available in history. This mock turn is complete, and the transcript is saved locally. No commands ran and no repository files changed."
                }.into() });
                }
                if updates.send(ProviderUpdate::Blocks(blocks)).await.is_err() {
                    return Ok(());
                }
            }
            let _ = updates
                .send(ProviderUpdate::Finished(if fail {
                    SessionStatus::Failed
                } else {
                    SessionStatus::Idle
                }))
                .await;
            Ok(())
        })
    }
}

/// A simulated approval or question, answered through the real
/// `interaction.respond` path. Nothing is executed either way.
async fn ask(
    question: bool,
    session_id: &str,
    updates: tokio::sync::mpsc::Sender<ProviderUpdate>,
    mut cancelled: tokio::sync::watch::Receiver<bool>,
    interactions: super::Interactions,
) -> Result<(), crate::JamError> {
    let mut interaction = if question {
        Interaction {
            id: new_id("interaction"),
            kind: "question".into(),
            title: "Demo provider asks".into(),
            detail: None,
            reason: None,
            choices: Vec::new(),
            questions: Some(vec![InteractionQuestion {
                id: "approach".into(),
                header: Some("Approach".into()),
                question: "Which approach should the demo describe?".into(),
                options: vec![
                    QuestionOption {
                        label: "Runtime-owned".into(),
                        description: Some("Sessions live in the runtime.".into()),
                    },
                    QuestionOption {
                        label: "View-owned".into(),
                        description: Some("Sessions end with their pane.".into()),
                    },
                ],
                multi_select: false,
                allow_other: true,
            }]),
            status: InteractionStatus::Pending,
            outcome: None,
            tool_id: None,
        }
    } else {
        Interaction {
            id: new_id("interaction"),
            kind: "command".into(),
            title: "Demo provider wants to run a command".into(),
            detail: Some("echo simulated".into()),
            reason: Some("Simulated request · nothing runs whichever you choose.".into()),
            choices: vec![
                InteractionChoice {
                    id: "allow".into(),
                    label: "Allow once".into(),
                    tone: "allow".into(),
                },
                InteractionChoice {
                    id: "deny".into(),
                    label: "Deny".into(),
                    tone: "deny".into(),
                },
            ],
            questions: None,
            status: InteractionStatus::Pending,
            outcome: None,
            tool_id: None,
        }
    };
    let receiver = interactions.open(session_id, &interaction)?;
    let intro = MessageBlock::Text {
        text: "This is a simulated request from the demo provider.".into(),
    };
    let block = |interaction: &Interaction| {
        vec![
            intro.clone(),
            MessageBlock::Interaction {
                interaction: interaction.clone(),
            },
        ]
    };
    if updates
        .send(ProviderUpdate::Blocks(block(&interaction)))
        .await
        .is_err()
    {
        interactions.withdraw(&interaction.id);
        return Ok(());
    }
    let answer = tokio::select! {
        biased;
        _ = cancelled.changed() => {
            interactions.withdraw(&interaction.id);
            return Ok(());
        }
        answer = receiver => answer.ok(),
    };
    let Some(answer) = answer else {
        return Ok(());
    };
    interaction.status = InteractionStatus::Resolved;
    interaction.outcome = Some(match &answer {
        Answer::Choice(choice) if choice == "allow" => "Allowed once".into(),
        Answer::Choice(_) => "Denied".into(),
        Answer::Answers(answers) => answers
            .values()
            .flatten()
            .cloned()
            .collect::<Vec<_>>()
            .join(", "),
    });
    let mut blocks = block(&interaction);
    blocks.push(MessageBlock::Text {
        text: format!(
            "The demo provider received: {}. No command ran.",
            interaction.outcome.as_deref().unwrap_or_default()
        ),
    });
    let _ = updates.send(ProviderUpdate::Blocks(blocks)).await;
    let _ = updates
        .send(ProviderUpdate::Finished(SessionStatus::Idle))
        .await;
    Ok(())
}
