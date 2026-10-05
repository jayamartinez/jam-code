//! Ignoring a provider-history entry: a tombstone keyed by its identity, so
//! later scans keep it hidden until it is restored. Deleting a conversation
//! bound to a provider conversation leaves the same tombstone. The
//! provider's history is never touched.
use super::store::Entry;
use crate::{
    commands::validate_id,
    error::JamError,
    runtime::{Runtime, new_id, now},
    storage::Store,
};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

impl Runtime {
    /// Hides an entry from JAM (a tombstone), or shows it again. An entry
    /// linked to a conversation is hidden by deleting that conversation,
    /// which leaves the same tombstone. Neither touches the provider's history.
    pub(super) fn set_history_ignored(
        &self,
        history_id: &str,
        ignored: bool,
    ) -> Result<Value, JamError> {
        validate_id(history_id)?;
        let state = self.lock()?;
        let mut entry = state.store.history_entry(history_id)?;
        if ignored && entry.session_id.is_some() {
            return Err(JamError::new(
                "conflict",
                "Delete this chat to remove it from JAM Code.",
            ));
        }
        entry.ignored_at = match (ignored, entry.ignored_at.take()) {
            (true, previous) => previous.or_else(|| Some(now())),
            (false, _) => None,
        };
        state.store.save_history(&entry)?;
        Ok(json!({ "entry": state.store.history_wire(&entry)? }))
    }
}

impl Store {
    /// Deleting a conversation bound to a provider conversation leaves a
    /// tombstone for it, created if no scan indexed it yet, so a later scan
    /// does not bring it back. The caller holds the transaction, before the
    /// binding and session rows go.
    pub fn tombstone_projection(&self, session_id: &str, now: &str) -> Result<(), JamError> {
        self.unlink_history(session_id)?;
        let binding: Option<(String, String, String, String)> = self
            .connection
            .query_row(
                "SELECT provider_id,instance_id,native_id,origin FROM provider_bindings
                 WHERE session_id=?1",
                [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let Some((provider_id, instance_id, native_id, origin)) = binding else {
            return Ok(());
        };
        let mut entry = self
            .history_by_native(&provider_id, &instance_id, &native_id)?
            .unwrap_or_else(|| Entry {
                id: new_id("history"),
                provider_id,
                instance_id,
                native_id,
                origin,
                discovered_at: now.to_owned(),
                ..Entry::default()
            });
        entry.ignored_at.get_or_insert_with(|| now.to_owned());
        self.save_history(&entry)
    }
}
