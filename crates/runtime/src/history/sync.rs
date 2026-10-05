//! Syncing one provider conversation into its projection: an ordinary JAM
//! conversation, session and binding that search, the transcript and resume
//! treat like any other. Messages are matched by the provider's own ID, so a
//! repeated or interrupted sync never adds one twice.
use super::{apply_item, clean_item, opaque, store::Entry, timestamp};
use crate::{
    commands::validate_id,
    error::JamError,
    protocol::*,
    provider_requests::block_on,
    providers::{HistoryMessage, HistoryReadRequest},
    runtime::{Runtime, new_id, now},
    storage::Store,
};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};

/// Messages asked for in one read page, the most accepted from one, and the
/// most pages one sync reads.
const READ_PAGE: usize = 200;
const READ_PAGE_LIMIT: usize = 1_000;
const READ_PAGES: usize = 1_000;
const BLOCKS_LIMIT: usize = 256;
const BLOCK_TEXT_LIMIT: usize = 100_000;
const UNTITLED: &str = "Untitled conversation";

impl Runtime {
    /// Reads one provider conversation into its JAM projection, creating
    /// the conversation, session and binding the first time. Messages are
    /// matched by their provider ID, so a repeated or interrupted sync adds
    /// none twice. A projection JAM has continued is not merged with the
    /// provider's record again (see PROVIDERS.md).
    pub(super) fn sync_history(&self, history_id: &str, archive: bool) -> Result<Value, JamError> {
        validate_id(history_id)?;
        let _job = self.history_jobs.claim(format!("sync:{history_id}"))?;
        let entry = self.lock()?.store.history_entry(history_id)?;
        let (adapter, config) = self.history_source(&entry.provider_id)?;
        let history = adapter.history().expect("checked by history_source");
        {
            let state = self.lock()?;
            let entry = sync_target(&state.store, history_id)?;
            if let Some(session_id) = &entry.session_id {
                let session = state.store.session(session_id)?;
                // Without a revision or update time, every sync reads again.
                let unchanged = entry.synced_at.is_some()
                    && entry.token().is_some()
                    && entry.token() == entry.synced_revision;
                if unchanged || state.store.has_recorded_messages(&session.resource_id)? {
                    return self.synced(&state.store, &entry);
                }
            } else {
                self.projection_project(&state.store, &entry)?;
            }
        }
        let mut page: Option<String> = None;
        let mut checkpoint = None;
        // Created by this sync: new to every view, so its messages need no events.
        let mut fresh = false;
        for _ in 0..READ_PAGES {
            let read = block_on(history.read(HistoryReadRequest {
                native_id: entry.native_id.clone(),
                page: page.clone(),
                checkpoint: entry.sync_checkpoint.clone(),
                limit: READ_PAGE,
                config: config.clone(),
            }))
            .ok_or_else(|| {
                JamError::new("unavailable", "The runtime executor is not available.")
            })?;
            let read = match read {
                Ok(read) => read,
                Err(error) if error.code == "not_found" => {
                    let state = self.lock()?;
                    let mut entry = state.store.history_entry(history_id)?;
                    entry.missing_since.get_or_insert_with(now);
                    state.store.save_history(&entry)?;
                    return Err(JamError::new(
                        "not_found",
                        "The provider no longer has this conversation.",
                    ));
                }
                Err(error) => return Err(error),
            };
            let mut state = self.lock()?;
            let (resource, created, changed) = state.store.transaction(|| {
                let mut entry = sync_target(&state.store, history_id)?;
                if let Some(item) = read.item.clone().and_then(clean_item)
                    && item.native_id == entry.native_id
                {
                    apply_item(&mut entry, item);
                }
                let (resource, created) = match &entry.session_id {
                    Some(session_id) => {
                        let session = state.store.session(session_id)?;
                        // A turn started between pages makes the transcript JAM's.
                        if session.status == SessionStatus::Running
                            || session.needs_input
                            || state.store.has_recorded_messages(&session.resource_id)?
                        {
                            return Err(JamError::new(
                                "conflict",
                                "This chat was continued in JAM Code while it was syncing.",
                            ));
                        }
                        (state.store.resource(&session.resource_id)?, false)
                    }
                    None => (
                        self.create_projection(&state.store, &mut entry, archive)?,
                        true,
                    ),
                };
                let mut changed = Vec::new();
                for message in read.messages.into_iter().take(READ_PAGE_LIMIT) {
                    let Some((source_id, message)) = clean_message(message, &resource) else {
                        continue;
                    };
                    if let Some(message) = state
                        .store
                        .save_synced_message(&resource, &source_id, message)?
                    {
                        changed.push(message);
                    }
                }
                state.store.save_history(&entry)?;
                Ok((resource, created, changed))
            })?;
            // A projection created by this sync is new to every view; one
            // being brought up to date tells its open views what changed.
            fresh |= created;
            if created {
                let session = state.store.session(
                    resource
                        .session_id
                        .as_deref()
                        .expect("a projection has a session"),
                )?;
                self.publish(
                    &mut state,
                    &resource.id,
                    EventPayload::SessionUpdated { session },
                );
            }
            for message in changed.into_iter().filter(|_| !fresh) {
                self.publish(
                    &mut state,
                    &resource.id,
                    EventPayload::MessageUpserted { message },
                );
            }
            match read.next_page {
                Some(next) if page.as_ref() != Some(&next) => page = Some(next),
                Some(_) => {
                    return Err(JamError::new(
                        "provider_error",
                        "The provider repeated a page of this conversation.",
                    ));
                }
                None => {
                    checkpoint = read.checkpoint;
                    page = None;
                    break;
                }
            }
        }
        if page.is_some() {
            return Err(JamError::new(
                "provider_error",
                "This conversation is too long to sync.",
            ));
        }
        let mut state = self.lock()?;
        let (entry, session) = state.store.transaction(|| {
            let mut entry = sync_target(&state.store, history_id)?;
            let session_id = entry
                .session_id
                .clone()
                .ok_or_else(|| JamError::new("conflict", "This chat was removed while syncing."))?;
            let session = state.store.session(&session_id)?;
            let mut resource = state.store.resource(&session.resource_id)?;
            if let Some(title) = entry.title.as_deref()
                && title != resource.title
            {
                state.store.retitle(&mut resource, title)?;
            }
            // Its place in the inbox is the provider's last activity.
            if let Some(updated_at) = &entry.updated_at {
                resource.updated_at = updated_at.clone();
                state.store.save_resource(&resource)?;
            }
            entry.synced_at = Some(now());
            entry.synced_revision = entry.token();
            entry.sync_checkpoint = checkpoint;
            entry.missing_since = None;
            state.store.save_history(&entry)?;
            Ok((entry, session))
        })?;
        let resource_id = session.resource_id.clone();
        self.publish(
            &mut state,
            &resource_id,
            EventPayload::SessionUpdated { session },
        );
        self.synced(&state.store, &entry)
    }

    /// `providerHistory.sync`'s answer: the entry and its conversation.
    fn synced(&self, store: &Store, entry: &Entry) -> Result<Value, JamError> {
        let session =
            store.session(entry.session_id.as_deref().ok_or_else(|| {
                JamError::new("conflict", "This chat was removed while syncing.")
            })?)?;
        Ok(json!({
            "entry": store.history_wire(entry)?,
            "resource": store.resource(&session.resource_id)?,
            "session": session,
        }))
    }

    /// The trusted project a new projection belongs to. A conversation from
    /// a folder JAM does not know is listed but not opened until the reader
    /// links it to a project (adding the folder through the normal flow).
    fn projection_project(&self, store: &Store, entry: &Entry) -> Result<String, JamError> {
        let project_id = entry.project_id.clone().ok_or_else(|| {
            JamError::new(
                "project_folder_required",
                "Add this conversation's folder as a project, or choose a project for it, before opening it.",
            )
        })?;
        let active = store
            .workspace(Cursor::default())?
            .projects
            .iter()
            .any(|project| project.id == project_id);
        if !active {
            return Err(JamError::new(
                "project_folder_required",
                "This conversation's project is no longer in JAM Code.",
            ));
        }
        Ok(project_id)
    }

    /// An ordinary JAM conversation for a provider conversation, bound to it
    /// with the entry's origin. The caller holds the transaction.
    fn create_projection(
        &self,
        store: &Store,
        entry: &mut Entry,
        archive: bool,
    ) -> Result<Resource, JamError> {
        let project_id = self.projection_project(store, entry)?;
        let created_at = now();
        let resource = Resource {
            id: new_id("conversation"),
            kind: "conversation".into(),
            title: entry.title.clone().unwrap_or_else(|| UNTITLED.into()),
            project_id: Some(project_id),
            session_id: Some(new_id("session")),
            path: None,
            pinned: false,
            updated_at: entry
                .updated_at
                .clone()
                .unwrap_or_else(|| created_at.clone()),
            // Archived from the start, so it never shows as open first.
            closed_at: archive.then(|| created_at.clone()),
            close_suggestion_dismissed_at: None,
            worktree_id: entry.worktree_id.clone(),
        };
        let session = Session {
            id: resource.session_id.clone().expect("new session ID"),
            resource_id: resource.id.clone(),
            provider_id: entry.provider_id.clone(),
            presentation: if entry.provider_id == "codex" {
                Presentation::Codex
            } else {
                Presentation::Claude
            },
            status: SessionStatus::Idle,
            model: crate::provider_requests::model_label(
                self.providers.checked(&entry.provider_id).as_ref(),
                &Default::default(),
            ),
            options: Default::default(),
            needs_input: false,
            usage: None,
        };
        store.insert_conversation(&resource, &session)?;
        store.connection.execute(
            "INSERT INTO provider_bindings(session_id,provider_id,instance_id,native_id,origin,
               created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?6)",
            rusqlite::params![
                session.id,
                entry.provider_id,
                entry.instance_id,
                entry.native_id,
                entry.origin,
                created_at
            ],
        )?;
        entry.session_id = Some(session.id);
        Ok(resource)
    }
}

/// The entry a sync works on, unless the reader removed it meanwhile.
fn sync_target(store: &Store, history_id: &str) -> Result<Entry, JamError> {
    let entry = store.history_entry(history_id)?;
    if entry.ignored_at.is_some() {
        return Err(JamError::new(
            "conflict",
            "This conversation was removed from JAM Code. Restore it first.",
        ));
    }
    Ok(entry)
}

/// A message from the provider's history as JAM stores it. Nothing in it is
/// live: an unanswered request or unfinished tool there has long ended.
fn clean_message(message: HistoryMessage, resource: &Resource) -> Option<(String, Message)> {
    let source_id = opaque(&message.source_id)?;
    if message.role != "user" && message.role != "assistant" {
        return None;
    }
    let created_at = message
        .created_at
        .and_then(|text| timestamp(&text))
        .unwrap_or_else(|| resource.updated_at.clone());
    let blocks = message
        .blocks
        .into_iter()
        .take(BLOCKS_LIMIT)
        .map(|block| match block {
            MessageBlock::Text { text } => MessageBlock::Text {
                text: crate::providers::bounded(&text, BLOCK_TEXT_LIMIT),
            },
            MessageBlock::Reasoning { text } => MessageBlock::Reasoning {
                text: crate::providers::bounded(&text, BLOCK_TEXT_LIMIT),
            },
            MessageBlock::Tool {
                id,
                kind,
                title,
                detail,
                status,
                files,
            } => MessageBlock::Tool {
                id,
                kind,
                title,
                detail: crate::providers::bounded(&detail, BLOCK_TEXT_LIMIT),
                status: if status == "running" {
                    "failed".into()
                } else {
                    status
                },
                files,
            },
            MessageBlock::Interaction { mut interaction } => {
                if interaction.status == InteractionStatus::Pending {
                    interaction.status = InteractionStatus::Expired;
                    interaction.outcome = Some("Not answered in JAM Code".into());
                }
                MessageBlock::Interaction { interaction }
            }
            other => other,
        })
        .collect();
    let completed_at = (message.role == "assistant").then(|| created_at.clone());
    Some((
        source_id,
        Message {
            id: String::new(),
            role: message.role,
            created_at,
            blocks,
            completed_at,
        },
    ))
}

impl Store {
    /// Saves a message read from the provider's history. One the projection
    /// already has (the same `source_id`) keeps its JAM ID and is rewritten
    /// only when it changed. Returns the message when anything was written.
    pub fn save_synced_message(
        &self,
        resource: &Resource,
        source_id: &str,
        mut message: Message,
    ) -> Result<Option<Message>, JamError> {
        let existing: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT id,data FROM messages WHERE conversation_id=?1 AND source_id=?2",
                params![resource.id, source_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        match existing {
            Some((id, data)) => {
                message.id = id;
                if serde_json::to_string(&message)? == data {
                    return Ok(None);
                }
                self.save_message(resource, &message)?;
            }
            None => {
                message.id = new_id("message");
                self.save_message(resource, &message)?;
                self.connection.execute(
                    "UPDATE messages SET source_id=?2 WHERE id=?1",
                    params![message.id, source_id],
                )?;
            }
        }
        Ok(Some(message))
    }

    /// A projection's title follows the provider's; its search documents
    /// carry the title too.
    pub fn retitle(&self, resource: &mut Resource, title: &str) -> Result<(), JamError> {
        resource.title = title.to_owned();
        self.save_resource(resource)?;
        self.connection.execute(
            "UPDATE search_documents SET title=?2 WHERE resource_id=?1",
            params![resource.id, title],
        )?;
        Ok(())
    }
}
