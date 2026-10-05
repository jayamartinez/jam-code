//! Follow-ups queued while an agent works.
//!
//! A queued follow-up is a Send that waits: its text, its context (with the
//! snapshots and attachments it carries) and the chat's options as they were
//! when it was queued. It is runtime state in SQLite, so it survives closing
//! panes, reloading the interface and restarting JAM, and every view of the
//! chat shows the same queue through `queue.updated` events.
//!
//! Dispatch is deliberately narrow. When a turn finishes `completed` and the
//! first follow-up has not failed, the session stays running and that
//! follow-up starts as soon as the finished turn's task has ended, so only one
//! provider turn runs at a time and the chat never reports finishing in
//! between. A failed or interrupted turn, Stop, a follow-up that could not be
//! sent and a restart all leave the queue waiting for the reader, who can send
//! one now, edit, reorder or remove it. Nothing starts at launch.
use crate::{
    attachments::Attachment,
    commands::{StartTurn, parse, validate_id},
    error::JamError,
    protocol::*,
    runtime::{Runtime, State, new_id, now},
    storage::Store,
    turns::FromQueue,
};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, atomic::Ordering};

/// Most follow-ups one conversation can have waiting.
pub(crate) const MAX_QUEUED: usize = 20;
/// Longest reason kept for a follow-up that could not be sent.
const ERROR_CHARS: usize = 500;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueuedRef {
    resource_id: String,
    queued_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EditQueued {
    resource_id: String,
    queued_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MoveQueued {
    resource_id: String,
    queued_id: String,
    /// Where it goes, counted from the front of the queue.
    position: usize,
}

impl Runtime {
    pub(crate) fn queue_request(
        self: &Arc<Self>,
        method: &str,
        params: Value,
    ) -> Result<Value, JamError> {
        match method {
            "queue.add" => {
                let fingerprint = format!("queue:{}", serde_json::to_string(&params)?);
                let input: StartTurn = parse(params)?;
                input.validate()?;
                self.queue_add(input, fingerprint)
            }
            "queue.update" => {
                let input: EditQueued = parse(params)?;
                validate_id(&input.resource_id)?;
                validate_id(&input.queued_id)?;
                if input.text.encode_utf16().count() > 20_000 {
                    return Err(JamError::invalid(
                        "A message can be at most 20,000 characters.",
                    ));
                }
                let mut state = self.lock()?;
                let mut turn = queued_in(&state, &input.resource_id, &input.queued_id)?;
                if input.text.trim().is_empty() && turn.context.is_empty() {
                    return Err(JamError::invalid(
                        "A queued message needs text or context. Remove it instead.",
                    ));
                }
                turn.text = input.text;
                turn.updated_at = Some(now());
                state.store.save_queued_turn(&turn)?;
                self.publish_queue(&mut state, &input.resource_id);
                Ok(json!({ "queued": state.store.queued_turns(&input.resource_id)? }))
            }
            "queue.remove" => {
                let input: QueuedRef = parse(params)?;
                validate_id(&input.resource_id)?;
                validate_id(&input.queued_id)?;
                let mut state = self.lock()?;
                // Already sent or removed: the card may go either way.
                let removed = match state.store.queued_turn(&input.queued_id)? {
                    Some(turn) if turn.resource_id == input.resource_id => state
                        .store
                        .transaction(|| state.store.remove_queued_turn(&turn.id))?,
                    Some(_) => return Err(JamError::new("not_found", "Queued message not found.")),
                    None => Vec::new(),
                };
                self.publish_queue(&mut state, &input.resource_id);
                let queued = state.store.queued_turns(&input.resource_id)?;
                drop(state);
                // Its attachments were only ever its own copies.
                for attachment in &removed {
                    let _ = self.attachments.remove(attachment);
                }
                Ok(json!({ "queued": queued }))
            }
            "queue.move" => {
                let input: MoveQueued = parse(params)?;
                validate_id(&input.resource_id)?;
                validate_id(&input.queued_id)?;
                let mut state = self.lock()?;
                queued_in(&state, &input.resource_id, &input.queued_id)?;
                let mut order: Vec<String> = state
                    .store
                    .queued_turns(&input.resource_id)?
                    .into_iter()
                    .map(|turn| turn.id)
                    .collect();
                order.retain(|id| id != &input.queued_id);
                order.insert(input.position.min(order.len()), input.queued_id);
                state
                    .store
                    .transaction(|| state.store.reorder_queue(&input.resource_id, &order))?;
                self.publish_queue(&mut state, &input.resource_id);
                Ok(json!({ "queued": state.store.queued_turns(&input.resource_id)? }))
            }
            // Sends one follow-up now, whatever its place: as a new turn when
            // the chat is idle, or steered into the running turn.
            "queue.send" => {
                let input: QueuedRef = parse(params)?;
                validate_id(&input.resource_id)?;
                validate_id(&input.queued_id)?;
                self.send_queued(&input.resource_id, &input.queued_id)
            }
            _ => Err(JamError::new("unknown_method", "Unknown queue request.")),
        }
    }

    /// Queues a follow-up. Its snapshots and attachments must be staged for
    /// this chat, exactly as for a Send, and become the follow-up's own.
    fn queue_add(
        self: &Arc<Self>,
        mut input: StartTurn,
        fingerprint: String,
    ) -> Result<Value, JamError> {
        let (receipt, idle) = {
            let mut state = self.lock()?;
            if self.shutting_down.load(Ordering::Acquire) {
                return Err(JamError::new("unavailable", "JAM is shutting down."));
            }
            if let Some(receipt) = state.store.receipt(&input.request_id, &fingerprint)? {
                return Ok(receipt);
            }
            let resource = state.store.resource(&input.resource_id)?;
            let session_id = resource
                .session_id
                .clone()
                .ok_or_else(|| JamError::invalid("This resource is not a conversation."))?;
            let session = state.store.session(&session_id)?;
            if state.store.queued_turns(&resource.id)?.len() >= MAX_QUEUED {
                return Err(JamError::new(
                    "conflict",
                    format!(
                        "At most {MAX_QUEUED} messages can wait in one chat. Send or remove some first."
                    ),
                ));
            }
            // The stored records replace what the client claimed about them.
            state
                .store
                .attach_snapshots(&mut input.context, &resource.id, false, None)?;
            state
                .store
                .send_attachments(&mut input.context, &resource.id, false, None)?;
            let turn = QueuedTurn {
                id: new_id("queued"),
                resource_id: resource.id.clone(),
                text: input.text,
                context: input.context,
                options: input.options,
                created_at: now(),
                updated_at: None,
                error: None,
            };
            let receipt = json!({
                "accepted": true,
                "resourceId": resource.id,
                "queuedId": turn.id,
                "requestId": input.request_id,
            });
            state.store.transaction(|| {
                state.store.insert_queued_turn(&turn)?;
                state
                    .store
                    .save_receipt(&input.request_id, &fingerprint, &receipt)
            })?;
            self.publish_queue(&mut state, &resource.id);
            let busy = state
                .tasks
                .values()
                .any(|task| task.session_id == session_id);
            // The turn it was meant to follow may have finished while this
            // request was on its way; then it goes now.
            (
                receipt,
                session.status == SessionStatus::Idle && !session.needs_input && !busy,
            )
        };
        if idle {
            self.dispatch_queue(&input.resource_id, false);
        }
        Ok(receipt)
    }

    /// Starts the first follow-up if nothing is running and it has not
    /// failed. `handoff` is the finished turn passing the session on: it is
    /// still marked running, and goes idle here if nothing can follow.
    pub(crate) fn dispatch_queue(self: &Arc<Self>, resource_id: &str, handoff: bool) {
        let next = (|| -> Result<Option<QueuedTurn>, JamError> {
            let state = self.lock()?;
            let resource = state.store.resource(resource_id)?;
            let Some(session_id) = resource.session_id else {
                return Ok(None);
            };
            let session = state.store.session(&session_id)?;
            let busy = state
                .tasks
                .values()
                .any(|task| task.session_id == session_id);
            let ready = !busy
                && !session.needs_input
                && if handoff {
                    session.status == SessionStatus::Running
                } else {
                    session.status == SessionStatus::Idle
                };
            if !ready {
                return Ok(None);
            }
            Ok(state
                .store
                .queued_turns(resource_id)?
                .into_iter()
                .next()
                .filter(|turn| turn.error.is_none()))
        })();
        match next {
            Ok(Some(turn)) => {
                let _ = self.start_queued(turn, handoff);
            }
            _ if handoff => self.settle_handoff(resource_id),
            _ => {}
        }
    }

    /// Starts a queued follow-up as a turn. A refusal is recorded on it, so
    /// it and the follow-ups behind it wait for the reader.
    fn start_queued(self: &Arc<Self>, turn: QueuedTurn, handoff: bool) -> Result<Value, JamError> {
        let resource_id = turn.resource_id.clone();
        let id = turn.id.clone();
        let result = self.start_turn_from(
            StartTurn {
                resource_id: turn.resource_id,
                text: turn.text,
                context: turn.context,
                request_id: id.clone(),
                options: turn.options,
            },
            queued_fingerprint(&id),
            false,
            Some(FromQueue {
                id: id.clone(),
                handoff,
            }),
        );
        if let Err(error) = &result {
            // Quitting is not the follow-up's fault, and one already sent or
            // removed has nothing to record.
            if !self.shutting_down.load(Ordering::Acquire) && error.code != "not_found" {
                self.mark_queued_failed(&resource_id, &id, &error.message);
            }
            if handoff {
                self.settle_handoff(&resource_id);
            }
        }
        result
    }

    /// Sends one follow-up now: a new turn when the chat is idle, steered
    /// into the running turn otherwise. A retry after it was sent answers
    /// with the same receipt.
    fn send_queued(
        self: &Arc<Self>,
        resource_id: &str,
        queued_id: &str,
    ) -> Result<Value, JamError> {
        let fingerprint = queued_fingerprint(queued_id);
        let (turn, running) = {
            let state = self.lock()?;
            if let Some(receipt) = state.store.receipt(queued_id, &fingerprint)? {
                return Ok(receipt);
            }
            let turn = queued_in(&state, resource_id, queued_id)?;
            let resource = state.store.resource(resource_id)?;
            let session_id = resource
                .session_id
                .ok_or_else(|| JamError::invalid("This resource is not a conversation."))?;
            let session = state.store.session(&session_id)?;
            let running = session.status == SessionStatus::Running
                || state
                    .tasks
                    .values()
                    .any(|task| task.session_id == session_id);
            (turn, running)
        };
        if running {
            // A steer joins the running turn as it is: its options stay.
            self.steer(
                StartTurn {
                    resource_id: turn.resource_id,
                    text: turn.text,
                    context: turn.context,
                    request_id: turn.id.clone(),
                    options: None,
                },
                fingerprint,
                Some(turn.id),
            )
        } else {
            self.start_queued(turn, false)
        }
    }

    fn mark_queued_failed(&self, resource_id: &str, queued_id: &str, reason: &str) {
        let Ok(mut state) = self.lock() else { return };
        let Ok(Some(mut turn)) = state.store.queued_turn(queued_id) else {
            return;
        };
        turn.error = Some(reason.chars().take(ERROR_CHARS).collect());
        turn.updated_at = Some(now());
        if state.store.save_queued_turn(&turn).is_ok() {
            self.publish_queue(&mut state, resource_id);
        }
    }

    /// A handoff with nothing to start: the turn that finished leaves the
    /// session idle after all.
    fn settle_handoff(&self, resource_id: &str) {
        let Ok(mut state) = self.lock() else { return };
        let Ok(resource) = state.store.resource(resource_id) else {
            return;
        };
        let Some(session_id) = resource.session_id else {
            return;
        };
        let busy = state
            .tasks
            .values()
            .any(|task| task.session_id == session_id);
        let Ok(mut session) = state.store.session(&session_id) else {
            return;
        };
        if busy || session.status != SessionStatus::Running {
            return;
        }
        session.status = SessionStatus::Idle;
        session.needs_input = false;
        if state.store.save_session(&session).is_ok() {
            self.publish(
                &mut state,
                resource_id,
                EventPayload::SessionUpdated { session },
            );
        }
    }

    /// Tells every view the conversation's whole queue, in order.
    pub(crate) fn publish_queue(&self, state: &mut State, resource_id: &str) {
        if let Ok(queued) = state.store.queued_turns(resource_id) {
            self.publish(state, resource_id, EventPayload::QueueUpdated { queued });
        }
    }
}

/// The fingerprint of a queued follow-up's own request, whether it is sent
/// as a turn or steered, so it is sent at most once.
fn queued_fingerprint(id: &str) -> String {
    format!("queued:{id}")
}

/// A follow-up in this conversation's queue.
fn queued_in(state: &State, resource_id: &str, queued_id: &str) -> Result<QueuedTurn, JamError> {
    state
        .store
        .queued_turn(queued_id)?
        .filter(|turn| turn.resource_id == resource_id)
        .ok_or_else(|| {
            JamError::new(
                "not_found",
                "That queued message was already sent or removed.",
            )
        })
}

impl Store {
    pub(crate) fn queued_turns(&self, resource_id: &str) -> Result<Vec<QueuedTurn>, JamError> {
        let mut statement = self.connection.prepare(
            "SELECT data FROM queued_turns WHERE resource_id=?1 ORDER BY position, rowid",
        )?;
        let rows = statement
            .query_map([resource_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.iter()
            .map(|data| serde_json::from_str(data).map_err(Into::into))
            .collect()
    }

    pub(crate) fn queued_turn(&self, id: &str) -> Result<Option<QueuedTurn>, JamError> {
        let data: Option<String> = self
            .connection
            .query_row("SELECT data FROM queued_turns WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        data.map(|data| serde_json::from_str(&data).map_err(Into::into))
            .transpose()
    }

    /// Whether a finished turn should hand its session to a follow-up: one is
    /// waiting and has not failed.
    pub(crate) fn queue_ready(&self, resource_id: &str) -> Result<bool, JamError> {
        Ok(self
            .queued_turns(resource_id)?
            .first()
            .is_some_and(|turn| turn.error.is_none()))
    }

    /// The follow-up that carries a staged snapshot or attachment, if any.
    pub(crate) fn asset_queue(&self, table: &str, id: &str) -> Result<Option<String>, JamError> {
        let sql = match table {
            "attachments" => "SELECT queued_id FROM attachments WHERE id=?1",
            "snapshots" => "SELECT queued_id FROM snapshots WHERE id=?1",
            _ => return Err(JamError::new("internal", "Unknown asset table.")),
        };
        Ok(self
            .connection
            .query_row(sql, [id], |row| row.get::<_, Option<String>>(0))
            .optional()?
            .flatten())
    }

    /// Adds a follow-up at the end of its queue and makes the snapshots and
    /// attachments it carries its own. The caller holds the transaction.
    fn insert_queued_turn(&self, turn: &QueuedTurn) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO queued_turns(id,resource_id,position,data) VALUES (?1,?2,
               (SELECT coalesce(max(position),0)+1 FROM queued_turns WHERE resource_id=?2),?3)",
            params![turn.id, turn.resource_id, serde_json::to_string(turn)?],
        )?;
        for item in &turn.context {
            let Some(asset) = item.asset_id.as_deref() else {
                continue;
            };
            let sql = match item.kind {
                ContextKind::Attachment => "UPDATE attachments SET queued_id=?1 WHERE id=?2",
                ContextKind::Snapshot => "UPDATE snapshots SET queued_id=?1 WHERE id=?2",
                _ => continue,
            };
            self.connection.execute(sql, params![turn.id, asset])?;
        }
        Ok(())
    }

    fn save_queued_turn(&self, turn: &QueuedTurn) -> Result<(), JamError> {
        self.connection.execute(
            "UPDATE queued_turns SET data=?2 WHERE id=?1",
            params![turn.id, serde_json::to_string(turn)?],
        )?;
        Ok(())
    }

    /// Positions in the given order, one after another.
    fn reorder_queue(&self, resource_id: &str, order: &[String]) -> Result<(), JamError> {
        for (index, id) in order.iter().enumerate() {
            self.connection.execute(
                "UPDATE queued_turns SET position=?3 WHERE id=?1 AND resource_id=?2",
                params![id, resource_id, index as i64 + 1],
            )?;
        }
        Ok(())
    }

    /// A follow-up was sent: what it carried now belongs to the turn that
    /// sent it, and it leaves the queue. The caller holds the transaction.
    pub(crate) fn dequeue_sent(&self, id: &str) -> Result<(), JamError> {
        self.connection.execute(
            "UPDATE attachments SET queued_id=NULL WHERE queued_id=?1",
            [id],
        )?;
        self.connection.execute(
            "UPDATE snapshots SET queued_id=NULL WHERE queued_id=?1",
            [id],
        )?;
        self.connection
            .execute("DELETE FROM queued_turns WHERE id=?1", [id])?;
        Ok(())
    }

    /// Removes a follow-up that will not be sent. Its snapshots return to the
    /// snapshot inbox; its attachments are returned for their copies to be
    /// deleted once this commits. The caller holds the transaction.
    pub(crate) fn remove_queued_turn(&self, id: &str) -> Result<Vec<Attachment>, JamError> {
        self.connection.execute(
            "UPDATE snapshots SET queued_id=NULL, data=json_remove(data,'$.resourceId')
               WHERE queued_id=?1 AND sent=0",
            [id],
        )?;
        let attachments = self.attachments("queued_id=?1 AND sent=0", [id])?;
        self.connection.execute(
            "DELETE FROM attachments WHERE queued_id=?1 AND sent=0",
            [id],
        )?;
        self.connection
            .execute("DELETE FROM queued_turns WHERE id=?1", [id])?;
        Ok(attachments)
    }

    /// Removes every follow-up a deleted conversation had waiting, as
    /// [`Store::remove_queued_turn`] does for one.
    pub(crate) fn remove_conversation_queue(
        &self,
        resource_id: &str,
    ) -> Result<Vec<Attachment>, JamError> {
        let mut attachments = Vec::new();
        for turn in self.queued_turns(resource_id)? {
            attachments.extend(self.remove_queued_turn(&turn.id)?);
        }
        Ok(attachments)
    }
}
