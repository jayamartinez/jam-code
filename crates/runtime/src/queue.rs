//! Follow-ups queued while an agent works.
//!
//! A queued follow-up is a Send that waits: its text, its context (with the
//! snapshots and attachments it carries) and the chat's options as they were
//! when it was queued. It is runtime state in SQLite, so it survives closing
//! panes, reloading the interface and restarting JAM, and every view of the
//! chat shows the same queue through `queue.updated` events.
//!
//! This module stores and edits the queue. Sending queued follow-ups as turns
//! finish is a separate step; nothing here starts a turn.
use crate::{
    attachments::Attachment,
    commands::{StartTurn, parse, validate_id},
    error::JamError,
    protocol::*,
    runtime::{Runtime, State, new_id, now},
    storage::Store,
};
use rusqlite::{OptionalExtension, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{Arc, atomic::Ordering};

/// Most follow-ups one conversation can have waiting.
pub(crate) const MAX_QUEUED: usize = 20;

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
        let receipt = {
            let mut state = self.lock()?;
            if self.shutting_down.load(Ordering::Acquire) {
                return Err(JamError::new("unavailable", "JAM is shutting down."));
            }
            if let Some(receipt) = state.store.receipt(&input.request_id, &fingerprint)? {
                return Ok(receipt);
            }
            let resource = state.store.resource(&input.resource_id)?;
            if resource.session_id.is_none() {
                return Err(JamError::invalid("This resource is not a conversation."));
            }
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
            receipt
        };
        Ok(receipt)
    }

    /// Tells every view the conversation's whole queue, in order.
    pub(crate) fn publish_queue(&self, state: &mut State, resource_id: &str) {
        if let Ok(queued) = state.store.queued_turns(resource_id) {
            self.publish(state, resource_id, EventPayload::QueueUpdated { queued });
        }
    }
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
