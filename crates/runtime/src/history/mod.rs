//! Provider history: JAM's index of conversations that live in a provider's
//! own history, including ones created outside JAM (in Claude Code or Codex
//! directly). The provider's record stays canonical (ADR 0016).
//!
//! A scan lists it through the adapter (`ProviderHistory::list`) into the
//! index, one row per provider conversation, keyed by its provider, instance
//! and native ID. No transcript is read and no JAM conversation is created
//! by a scan, and JAM's own metadata is never rewritten by one. A thread JAM
//! itself started is linked to its conversation.
mod folders;
mod ignore;
mod store;
mod sync;

use crate::{
    commands::{parse, validate_provider},
    error::JamError,
    provider_requests::block_on,
    providers::{HistoryItem, HistoryListRequest},
    runtime::{Runtime, new_id, now},
    storage::Store,
};
use folders::Folders;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::HashSet, sync::Mutex};
pub(crate) use store::DEFAULT_INSTANCE;
use store::{Entry, ListFilter};

/// Items asked for in one listing page, and the most accepted from one.
const LIST_PAGE: usize = 200;
const LIST_PAGE_LIMIT: usize = 1_000;
/// A listing longer than this many pages is treated as incomplete.
const LIST_PAGES: usize = 1_000;
/// Entries one `providerHistory.list` returns by default and at most.
const LIST_DEFAULT: u32 = 100;
const LIST_MAX: u32 = 200;
/// Bounds on what a provider reports, in UTF-16 units like the protocol's.
const ID_LIMIT: usize = 512;
const TITLE_LIMIT: usize = 256;
const PREVIEW_LIMIT: usize = 512;
const PATH_LIMIT: usize = 4_096;

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
                folders: Vec::new(),
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
    // A projection keeps the project it was given.
    folders::associate(&mut entry, folders);
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

#[cfg(test)]
mod tests {
    use super::*;

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
