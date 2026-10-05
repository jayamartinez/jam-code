//! Permanently deleting a conversation: JAM's own record of it, and nothing
//! else. The project's folder and files, Git branches and worktrees, and the
//! provider's own history of the session are never touched.
//!
//! Deletion is an explicit lifecycle command, separate from archiving and
//! from interrupting. It is refused while the conversation's agent is
//! working, waiting for an answer, or still stopping an interrupted turn, so
//! the database never changes under a live provider task.
use crate::{
    JamError,
    attachments::Attachment,
    commands::{parse, validate_id},
    protocol::SessionStatus,
    runtime::Runtime,
    storage::{Store, delete_conversation_rows},
};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteConversation {
    resource_id: String,
}

impl Runtime {
    /// Deleting a conversation that is already gone is `not_found`, so a
    /// retry after a lost answer is recognizable rather than a second delete.
    pub(crate) fn delete_conversation(&self, params: Value) -> Result<Value, JamError> {
        let input: DeleteConversation = parse(params)?;
        validate_id(&input.resource_id)?;
        let (provider_id, session_id, assets, attachments) = {
            let state = self.lock()?;
            let resource = state.store.resource(&input.resource_id)?;
            let session_id = match (&resource.kind[..], resource.session_id) {
                ("conversation", Some(session_id)) => session_id,
                _ => return Err(JamError::invalid("Only a conversation can be deleted.")),
            };
            let session = state.store.session(&session_id)?;
            if session.status == SessionStatus::Running || session.needs_input {
                return Err(JamError::new(
                    "conflict",
                    "Stop the agent or answer its request before deleting this chat.",
                ));
            }
            if state
                .tasks
                .values()
                .any(|task| task.session_id == session_id)
            {
                return Err(JamError::new(
                    "conflict",
                    "This chat's last turn is still stopping. Try again in a moment.",
                ));
            }
            let assets = state
                .store
                .transaction(|| state.store.delete_conversation(&resource.id, &session_id))?;
            (session.provider_id, session_id, assets.0, assets.1)
        };
        // The records are gone; what follows cannot bring them back. An asset
        // file left behind here has no row, and is removed by the snapshot
        // store's recovery at the next start.
        for asset in assets {
            let _ = self.snapshots.assets.delete(&asset);
        }
        for attachment in &attachments {
            let _ = self.attachments.remove(attachment);
        }
        // A process kept idle for this session's next turn has no next turn.
        if let Some(adapter) = self.providers.adapter(&provider_id) {
            adapter.release(&session_id);
        }
        Ok(json!({ "resourceId": input.resource_id }))
    }
}

impl Store {
    /// Removes everything owned only by this conversation, inside the
    /// caller's transaction, and returns the snapshot assets and attachments
    /// whose files can be deleted once it commits.
    ///
    /// Removed: its resource, conversation, sessions, messages, search
    /// documents (and through them the FTS index), provider binding, request
    /// receipts and the snapshots and attachments sent in it. A snapshot still staged for it
    /// goes back to the inbox. Projects, worktrees, file edits, other
    /// conversations and every other resource are left as they are.
    fn delete_conversation(
        &self,
        resource_id: &str,
        session_id: &str,
    ) -> Result<(Vec<String>, Vec<Attachment>), JamError> {
        let connection = &self.connection;
        const OWNED: &str = "json_extract(data,'$.resourceId')=?1";
        let assets = {
            let mut statement = connection.prepare(&format!(
                "SELECT id FROM snapshots WHERE sent=1 AND {OWNED}"
            ))?;
            statement
                .query_map([resource_id], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?
        };
        connection.execute(
            &format!("DELETE FROM snapshots WHERE sent=1 AND {OWNED}"),
            [resource_id],
        )?;
        connection.execute(
            &format!(
                "UPDATE snapshots SET data=json_remove(data,'$.resourceId') WHERE sent=0 AND {OWNED}"
            ),
            [resource_id],
        )?;
        connection.execute(
            "DELETE FROM metadata WHERE key='snapshot_last_conversation' AND value=?1",
            [resource_id],
        )?;
        // Receipts would otherwise answer a retried request with a chat that
        // no longer exists.
        connection.execute(
            "DELETE FROM requests WHERE json_extract(receipt,'$.resourceId')=?1
               OR json_extract(receipt,'$.sessionId')=?2",
            params![resource_id, session_id],
        )?;
        // A provider conversation it was bound to stays in the provider's
        // history; a tombstone keeps the next scan from bringing it back.
        self.tombstone_projection(session_id, &crate::runtime::now())?;
        // Every attachment it sent belongs to it alone: one copy, one message.
        let attachments = self.attachments("resource_id=?1", [resource_id])?;
        connection.execute(
            "DELETE FROM attachments WHERE resource_id=?1",
            [resource_id],
        )?;
        delete_conversation_rows(connection, resource_id)?;
        Ok((assets, attachments))
    }
}
