//! Refreshing a synced conversation: bringing its projection up to date when
//! the provider's record has moved on since the last sync, such as a Claude
//! Code session the reader kept using outside JAM Code.
//!
//! Nothing refreshes on a timer. The client asks when the reader opens the
//! conversation or comes back to the window; the adapter answers with one
//! conversation's current metadata, cheaply, and the conversation is read
//! again only when that changed.
use super::{apply_item, clean_item};
use crate::{
    commands::validate_id, error::JamError, protocol::SessionStatus, provider_requests::block_on,
    providers::HistoryItemRequest, runtime::Runtime,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RefreshHistory {
    resource_id: String,
}

impl Runtime {
    /// Syncs the conversation `resource_id` projects again if its provider
    /// record changed. A conversation that is not a projection, is working
    /// or waiting, was removed from JAM Code's index, or was continued in JAM
    /// Code (whose transcript is then the record) is left as it is, and so is
    /// one the provider no longer has. Answers whether it was read again.
    pub(super) fn refresh_history(&self, input: RefreshHistory) -> Result<Value, JamError> {
        validate_id(&input.resource_id)?;
        let unchanged = || Ok(json!({ "refreshed": false }));
        let entry = {
            let state = self.lock()?;
            let resource = state.store.resource(&input.resource_id)?;
            let Some(session_id) = resource.session_id else {
                return unchanged();
            };
            let Some(entry) = state.store.history_by_session(&session_id)? else {
                return unchanged();
            };
            let session = state.store.session(&session_id)?;
            if entry.ignored_at.is_some()
                || session.status == SessionStatus::Running
                || session.needs_input
                || state.store.has_recorded_messages(&resource.id)?
            {
                return unchanged();
            }
            entry
        };
        // A provider that is turned off or cannot report its history now
        // leaves the copy JAM Code has.
        let Ok((adapter, config)) = self.history_source(&entry.provider_id) else {
            return unchanged();
        };
        let history = adapter.history().expect("checked by history_source");
        let item = block_on(history.item(HistoryItemRequest {
            native_id: entry.native_id.clone(),
            config,
        }))
        .ok_or_else(|| JamError::new("unavailable", "The runtime executor is not available."))??;
        let Some(item) = item
            .and_then(clean_item)
            .filter(|item| item.native_id == entry.native_id)
        else {
            return unchanged();
        };
        {
            let state = self.lock()?;
            let mut current = state.store.history_entry(&entry.id)?;
            apply_item(&mut current, item);
            if current.token().is_some() && current.token() == current.synced_revision {
                return unchanged();
            }
            state.store.save_history(&current)?;
        }
        match self.sync_history(&entry.id, false) {
            Ok(_) => Ok(json!({ "refreshed": true })),
            // Already being synced, or continued in JAM Code meanwhile.
            Err(error) if error.code == "conflict" => unchanged(),
            Err(error) => Err(error),
        }
    }
}
