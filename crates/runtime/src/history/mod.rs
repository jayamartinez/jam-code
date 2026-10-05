//! Provider history: JAM's local, searchable projection of conversations
//! that live in a provider's own history, including ones created outside
//! JAM (in Claude Code or Codex directly).
//!
//! The provider's record stays canonical. A scan lists it through the
//! adapter (`ProviderHistory::list`) into a discovery index, one row per
//! provider conversation, keyed by its provider, instance and native ID. No
//! transcript is read and no JAM conversation is created by a scan. Syncing
//! one entry reads its messages (`ProviderHistory::read`) into an ordinary
//! JAM conversation with a provider binding, which search, the transcript and
//! resume then treat like any other. JAM's own metadata (pin, archive,
//! project, layout) is never rewritten by a scan or a sync.
//!
//! A provider's reported folder is metadata, not access: it only links an
//! entry to a project or worktree JAM already trusts. Deleting a projection
//! leaves a tombstone so a later scan does not bring it back; the provider's
//! own history is never deleted.
mod store;

use crate::{
    commands::{parse, validate_id, validate_provider},
    error::JamError,
    protocol::*,
    provider_requests::block_on,
    providers::{HistoryItem, HistoryListRequest, HistoryMessage, HistoryReadRequest},
    runtime::{Runtime, new_id, now},
    storage::Store,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
pub(crate) use store::DEFAULT_INSTANCE;
use store::{Entry, ListFilter};

/// Items asked for in one listing page, and the most accepted from one.
const LIST_PAGE: usize = 200;
const LIST_PAGE_LIMIT: usize = 1_000;
/// A listing longer than this many pages is treated as incomplete.
const LIST_PAGES: usize = 1_000;
/// Messages asked for in one read page, the most accepted from one, and the
/// most pages one sync reads.
const READ_PAGE: usize = 200;
const READ_PAGE_LIMIT: usize = 1_000;
const READ_PAGES: usize = 1_000;
/// Entries one `providerHistory.list` returns by default and at most.
const LIST_DEFAULT: u32 = 100;
const LIST_MAX: u32 = 200;
/// Bounds on what a provider reports, in UTF-16 units like the protocol's.
const ID_LIMIT: usize = 512;
const TITLE_LIMIT: usize = 256;
const PREVIEW_LIMIT: usize = 512;
const PATH_LIMIT: usize = 4_096;
const BLOCKS_LIMIT: usize = 256;
const BLOCK_TEXT_LIMIT: usize = 100_000;
const UNTITLED: &str = "Untitled conversation";

/// Scans and syncs in progress, so the same one never runs twice at once.
#[derive(Default)]
pub(crate) struct HistoryJobs(Mutex<HashSet<String>>);

struct Job<'a> {
    jobs: &'a HistoryJobs,
    key: String,
}

impl HistoryJobs {
    fn claim(&self, key: String) -> Result<Job<'_>, JamError> {
        let mut running = self
            .0
            .lock()
            .map_err(|_| JamError::new("internal", "Provider history is unavailable."))?;
        if !running.insert(key.clone()) {
            return Err(JamError::new(
                "conflict",
                "This provider history is already being read. Try again when it finishes.",
            ));
        }
        Ok(Job { jobs: self, key })
    }
}

impl Drop for Job<'_> {
    fn drop(&mut self) {
        if let Ok(mut running) = self.jobs.0.lock() {
            running.remove(&self.key);
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ScanHistory {
    provider_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListHistory {
    #[serde(default)]
    provider_id: Option<String>,
    /// Lists tombstones instead of the entries that are shown.
    #[serde(default)]
    ignored: bool,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoryTarget {
    history_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssociateHistory {
    history_id: String,
    project_id: String,
}

/// What one scan found.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanSummary {
    provider_id: String,
    /// Entries seen for the first time.
    discovered: u32,
    /// Entries whose reported metadata changed.
    updated: u32,
    unchanged: u32,
    /// Items rejected as malformed (no usable ID).
    rejected: u32,
    /// Entries a complete scan did not list. Only counted when complete.
    missing: u32,
    /// The listing ended normally. An incomplete scan marks nothing missing.
    complete: bool,
}

impl Runtime {
    pub(crate) fn history_request(&self, method: &str, params: Value) -> Result<Value, JamError> {
        match method {
            "providerHistory.scan" => {
                let input: ScanHistory = parse(params)?;
                Ok(serde_json::to_value(
                    self.scan_history(&input.provider_id)?,
                )?)
            }
            "providerHistory.list" => self.list_history(parse(params)?),
            "providerHistory.sync" => {
                let input: HistoryTarget = parse(params)?;
                self.sync_history(&input.history_id)
            }
            "providerHistory.associate" => self.associate_history(parse(params)?),
            "providerHistory.ignore" => {
                let input: HistoryTarget = parse(params)?;
                self.set_history_ignored(&input.history_id, true)
            }
            "providerHistory.restore" => {
                let input: HistoryTarget = parse(params)?;
                self.set_history_ignored(&input.history_id, false)
            }
            _ => Err(JamError::new(
                "unknown_method",
                "Unknown JAM request method.",
            )),
        }
    }

    /// The adapter's history, and the provider's saved settings, for a
    /// provider that is enabled and can report its history.
    fn history_source(
        &self,
        provider_id: &str,
    ) -> Result<
        (
            std::sync::Arc<dyn crate::providers::ProviderAdapter>,
            crate::providers::ProviderConfig,
        ),
        JamError,
    > {
        validate_provider(provider_id)?;
        let adapter = self.providers.adapter(provider_id).ok_or_else(|| {
            JamError::new("provider_unavailable", "That provider is not available.")
        })?;
        if adapter.history().is_none() {
            return Err(JamError::new(
                "unsupported",
                "JAM Code cannot read this provider's own history yet.",
            ));
        }
        let state = self.lock()?;
        let settings = self.provider_settings(&state)?;
        if !settings.enabled(provider_id) {
            return Err(JamError::new(
                "provider_disabled",
                "That provider is turned off in Settings → Providers.",
            ));
        }
        Ok((adapter, settings.config(provider_id)))
    }

    /// Lists the provider's history into the discovery index. Each page is
    /// committed on its own, without holding the database lock while the
    /// provider is asked, so an interrupted scan keeps what it saw and a
    /// repeated one changes nothing that did not change.
    fn scan_history(&self, provider_id: &str) -> Result<ScanSummary, JamError> {
        let (adapter, config) = self.history_source(provider_id)?;
        let history = adapter.history().expect("checked by history_source");
        let _job = self.history_jobs.claim(format!("scan:{provider_id}"))?;
        let scan = new_id("scan");
        let mut summary = ScanSummary {
            provider_id: provider_id.to_owned(),
            ..ScanSummary::default()
        };
        // The folders JAM trusts, read once: a project added during the scan
        // is matched by the next one.
        let folders = Folders::of(&self.lock()?.store)?;
        let mut page: Option<String> = None;
        for _ in 0..LIST_PAGES {
            let listed = block_on(history.list(HistoryListRequest {
                page: page.clone(),
                limit: LIST_PAGE,
                config: config.clone(),
            }))
            .ok_or_else(|| {
                JamError::new("unavailable", "The runtime executor is not available.")
            })??;
            {
                let state = self.lock()?;
                let seen_at = now();
                state.store.transaction(|| {
                    for item in listed.items.into_iter().take(LIST_PAGE_LIMIT) {
                        reconcile(
                            &state.store,
                            &folders,
                            provider_id,
                            &scan,
                            &seen_at,
                            item,
                            &mut summary,
                        )?;
                    }
                    Ok(())
                })?;
            }
            match listed.next_page {
                None => {
                    summary.complete = true;
                    break;
                }
                // A provider that hands back the same page again would never end.
                Some(next) if page.as_ref() == Some(&next) => break,
                Some(next) => page = Some(next),
            }
        }
        if summary.complete {
            let state = self.lock()?;
            summary.missing =
                state
                    .store
                    .mark_unlisted(provider_id, DEFAULT_INSTANCE, &scan, &now())?;
        }
        Ok(summary)
    }

    fn list_history(&self, input: ListHistory) -> Result<Value, JamError> {
        if let Some(provider) = &input.provider_id {
            validate_provider(provider)?;
        }
        let limit = input.limit.unwrap_or(LIST_DEFAULT);
        if limit == 0 || limit > LIST_MAX {
            return Err(JamError::invalid(format!(
                "A history page lists 1 to {LIST_MAX} entries."
            )));
        }
        let after = match input.cursor.as_deref() {
            None => None,
            Some(cursor) => Some(
                cursor
                    .split_once('|')
                    .filter(|_| cursor.len() <= 512)
                    .ok_or_else(|| JamError::invalid("That history cursor is not valid."))?,
            ),
        };
        let state = self.lock()?;
        let entries = state.store.history_list(ListFilter {
            provider_id: input.provider_id.as_deref(),
            ignored: input.ignored,
            after,
            limit,
        })?;
        let cursor = (entries.len() == limit as usize)
            .then(|| entries.last())
            .flatten()
            .map(|last| {
                let sort_at = last.updated_at.as_ref().unwrap_or(&last.discovered_at);
                format!("{sort_at}|{}", last.id)
            });
        let entries = entries
            .iter()
            .map(|entry| state.store.history_wire(entry))
            .collect::<Result<Vec<_>, _>>()?;
        let mut result = json!({ "entries": entries });
        if let Some(cursor) = cursor {
            result["cursor"] = json!(cursor);
        }
        Ok(result)
    }

    /// Links an entry that has no projection yet to a project the reader
    /// chose. Only a project JAM already has can be chosen, so this never
    /// grants access to a folder; later scans keep the choice.
    fn associate_history(&self, input: AssociateHistory) -> Result<Value, JamError> {
        validate_id(&input.history_id)?;
        let project = self.project(&input.project_id)?;
        let state = self.lock()?;
        let mut entry = state.store.history_entry(&input.history_id)?;
        if entry.session_id.is_some() {
            return Err(JamError::new(
                "conflict",
                "This conversation is already in JAM Code and keeps its project.",
            ));
        }
        entry.project_id = Some(project.id);
        entry.worktree_id = None;
        entry.project_source = Some("reader".into());
        state.store.save_history(&entry)?;
        Ok(json!({ "entry": state.store.history_wire(&entry)? }))
    }

    /// Hides an entry from JAM (a tombstone), or shows it again. A synced
    /// entry is removed by deleting its conversation, which leaves the same
    /// tombstone. Neither touches the provider's history.
    fn set_history_ignored(&self, history_id: &str, ignored: bool) -> Result<Value, JamError> {
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

    /// Reads one provider conversation into its JAM projection, creating
    /// the conversation, session and binding the first time. Messages are
    /// matched by their provider ID, so a repeated or interrupted sync adds
    /// none twice. A projection JAM has continued is not merged with the
    /// provider's record again (see PROVIDERS.md).
    fn sync_history(&self, history_id: &str) -> Result<Value, JamError> {
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
                    None => (self.create_projection(&state.store, &mut entry)?, true),
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
    fn create_projection(&self, store: &Store, entry: &mut Entry) -> Result<Resource, JamError> {
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
            closed_at: None,
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

/// Brings one listed item into the index. A new item that JAM itself started
/// is linked to its existing session; any other is external.
fn reconcile(
    store: &Store,
    folders: &Folders,
    provider_id: &str,
    scan: &str,
    seen_at: &str,
    item: HistoryItem,
    summary: &mut ScanSummary,
) -> Result<(), JamError> {
    let Some(item) = clean_item(item) else {
        summary.rejected += 1;
        return Ok(());
    };
    let existing = store.history_by_native(provider_id, DEFAULT_INSTANCE, &item.native_id)?;
    let known = existing.is_some();
    let mut entry = match existing {
        Some(entry) => entry,
        None => {
            let session_id =
                store.unindexed_binding(provider_id, DEFAULT_INSTANCE, &item.native_id)?;
            summary.discovered += 1;
            Entry {
                id: new_id("history"),
                provider_id: provider_id.to_owned(),
                instance_id: DEFAULT_INSTANCE.to_owned(),
                native_id: item.native_id.clone(),
                origin: if session_id.is_some() {
                    "jam"
                } else {
                    "external"
                }
                .into(),
                session_id,
                discovered_at: seen_at.to_owned(),
                ..Entry::default()
            }
        }
    };
    let before = entry.clone();
    apply_item(&mut entry, item);
    // A projection keeps the project it was given; an unlinked entry follows
    // its reported folder unless the reader chose a project for it.
    if entry.session_id.is_none() && entry.project_source.as_deref() != Some("reader") {
        let (project_id, worktree_id) = folders.match_folder(entry.cwd.as_deref()).unzip();
        entry.project_id = project_id;
        entry.worktree_id = worktree_id.flatten();
        entry.project_source = entry.project_id.as_ref().map(|_| "folder".into());
    }
    // Listed again after a complete scan missed it.
    entry.missing_since = None;
    if known {
        if entry == before {
            summary.unchanged += 1;
        } else {
            summary.updated += 1;
        }
    }
    entry.seen_scan = Some(scan.to_owned());
    store.save_history(&entry)
}

/// Copies an item's reported metadata onto its entry.
fn apply_item(entry: &mut Entry, item: HistoryItem) {
    entry.title = item.title;
    entry.preview = item.preview;
    entry.cwd = item.cwd;
    entry.created_at = item.created_at;
    entry.updated_at = item.updated_at;
    entry.revision = item.revision;
    entry.resumable = item.resumable;
}

/// An item with a usable ID and bounded, plain metadata; `None` when the
/// provider's ID itself is unusable.
fn clean_item(item: HistoryItem) -> Option<HistoryItem> {
    Some(HistoryItem {
        native_id: opaque(&item.native_id)?,
        title: item.title.and_then(|text| line(&text, TITLE_LIMIT)),
        preview: item.preview.and_then(|text| line(&text, PREVIEW_LIMIT)),
        created_at: item.created_at.and_then(|text| timestamp(&text)),
        updated_at: item.updated_at.and_then(|text| timestamp(&text)),
        revision: item.revision.and_then(|text| opaque(&text)),
        cwd: item.cwd.filter(|path| {
            !path.is_empty()
                && path.encode_utf16().count() <= PATH_LIMIT
                && !path.chars().any(char::is_control)
        }),
        resumable: item.resumable,
    })
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

/// A provider's own identifier or token, exactly as given: never trimmed or
/// rewritten, so it still names the same thing.
fn opaque(text: &str) -> Option<String> {
    (!text.trim().is_empty()
        && text.chars().count() <= ID_LIMIT
        && !text.chars().any(char::is_control))
    .then(|| text.to_owned())
}

/// Display text on one line, without escapes, at most `limit` UTF-16 units
/// (the protocol's measure).
fn line(text: &str, limit: usize) -> Option<String> {
    let text = crate::providers::plain(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let mut units = 0;
    let text: String = text
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= limit
        })
        .collect();
    (!text.is_empty()).then_some(text)
}

/// An RFC 3339 time, rewritten in UTC like JAM's own.
fn timestamp(text: &str) -> Option<String> {
    use time::format_description::well_known::Rfc3339;
    let parsed = time::OffsetDateTime::parse(text.trim(), &Rfc3339).ok()?;
    parsed.to_offset(time::UtcOffset::UTC).format(&Rfc3339).ok()
}

/// The folders JAM already trusts: active projects' folders and the
/// worktrees recorded for them. A reported folder is compared as text, and
/// the filesystem is never consulted for it.
struct Folders {
    /// `(folder, project, worktree)`.
    known: Vec<(String, String, Option<String>)>,
}

impl Folders {
    fn of(store: &Store) -> Result<Self, JamError> {
        let workspace = store.workspace(Cursor::default())?;
        let mut known = Vec::new();
        for project in &workspace.projects {
            for path in &project.paths {
                if let Some(folder) = folder_key(path) {
                    known.push((folder, project.id.clone(), None));
                }
            }
        }
        for worktree in &workspace.worktrees {
            if let Some(folder) = folder_key(&worktree.path) {
                known.push((
                    folder,
                    worktree.project_id.clone(),
                    Some(worktree.id.clone()),
                ));
            }
        }
        Ok(Self { known })
    }

    /// The project (and worktree) whose folder is exactly `cwd`. A folder
    /// inside a project is not matched: an agent resumes in the folder it
    /// worked in, and JAM would run it in the project's.
    fn match_folder(&self, cwd: Option<&str>) -> Option<(String, Option<String>)> {
        let folder = folder_key(cwd?)?;
        // A worktree is more specific than a project folder with the same path.
        self.known
            .iter()
            .filter(|(known, ..)| *known == folder)
            .max_by_key(|(_, _, worktree)| worktree.is_some())
            .map(|(_, project, worktree)| (project.clone(), worktree.clone()))
    }
}

/// An absolute folder path in a form two spellings of it share: separators
/// and trailing separators normalized and, where volumes are
/// case-insensitive by default, lowercased. A relative path or one that
/// climbs (`..`) matches nothing.
fn folder_key(path: &str) -> Option<String> {
    if path.is_empty() || path.chars().count() > PATH_LIMIT || path.contains('\0') {
        return None;
    }
    let path = Path::new(path);
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return None;
    }
    let normalized: PathBuf = path.components().collect();
    let text = normalized.to_string_lossy().into_owned();
    Some(if cfg!(any(windows, target_os = "macos")) {
        text.to_lowercase()
    } else {
        text
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_match_by_spelling_never_by_climbing() {
        let root = if cfg!(windows) {
            r"C:\work\jam"
        } else {
            "/work/jam"
        };
        let key = folder_key(root).unwrap();
        let trailing = format!("{root}{}", std::path::MAIN_SEPARATOR);
        assert_eq!(folder_key(&trailing).as_deref(), Some(key.as_str()));
        assert_eq!(folder_key("relative/jam"), None);
        let climbing = format!("{root}{0}..{0}jam", std::path::MAIN_SEPARATOR);
        assert_eq!(folder_key(&climbing), None);
        assert_eq!(folder_key(""), None);
        if cfg!(windows) {
            assert_eq!(folder_key("c:/WORK/jam").as_deref(), Some(key.as_str()));
        }
    }

    #[test]
    fn reported_metadata_is_bounded_plain_and_timestamps_are_utc() {
        let item = clean_item(HistoryItem {
            native_id: "thread-1".into(),
            title: Some(format!(
                "\u{1b}[31mFix\u{1b}[0m the\n  build {}",
                "x".repeat(400)
            )),
            created_at: Some("2026-10-01T12:00:00+02:00".into()),
            updated_at: Some("yesterday".into()),
            cwd: Some("C:\\a\u{7}".into()),
            ..HistoryItem::default()
        })
        .unwrap();
        let title = item.title.unwrap();
        assert!(title.starts_with("Fix the build xx"));
        assert_eq!(title.chars().count(), TITLE_LIMIT);
        assert_eq!(item.created_at.as_deref(), Some("2026-10-01T10:00:00Z"));
        assert_eq!(item.updated_at, None);
        assert_eq!(item.cwd, None);
        for unusable in ["", "  ", "a\nb"] {
            let item = HistoryItem {
                native_id: unusable.into(),
                ..HistoryItem::default()
            };
            assert!(clean_item(item).is_none());
        }
        // An ID is kept exactly, never trimmed into another one.
        let item = HistoryItem {
            native_id: " spaced ".into(),
            ..HistoryItem::default()
        };
        assert_eq!(clean_item(item).unwrap().native_id, " spaced ");
    }
}
