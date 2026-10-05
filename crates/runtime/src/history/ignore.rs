//! Ignoring a provider-history entry: a tombstone keyed by its identity, so
//! later scans keep it hidden until it is restored. The provider's history
//! is never touched.
use crate::{
    commands::validate_id,
    error::JamError,
    runtime::{Runtime, now},
};
use serde_json::{Value, json};

impl Runtime {
    /// Hides an entry from JAM (a tombstone), or shows it again. An entry
    /// linked to a conversation is refused: that conversation is deleted
    /// instead. Neither touches the provider's history.
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
