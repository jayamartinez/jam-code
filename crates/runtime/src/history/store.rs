//! Provider-history rows: JAM's index of provider conversations.
use crate::{error::JamError, protocol::HistoryEntry, storage::Store};
use rusqlite::{OptionalExtension, Row, params};

/// Every provider has this one instance until JAM can tell several accounts
/// or provider homes apart (see PROVIDERS.md, "Provider history").
pub(crate) const DEFAULT_INSTANCE: &str = "default";

/// One `provider_history` row. `native_id` never leaves the runtime.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Entry {
    pub id: String,
    pub provider_id: String,
    pub instance_id: String,
    pub native_id: String,
    pub origin: String,
    pub session_id: Option<String>,
    pub project_id: Option<String>,
    pub worktree_id: Option<String>,
    pub project_source: Option<String>,
    pub title: Option<String>,
    pub preview: Option<String>,
    pub cwd: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub revision: Option<String>,
    pub resumable: bool,
    pub discovered_at: String,
    pub seen_scan: Option<String>,
    pub missing_since: Option<String>,
    pub synced_at: Option<String>,
    pub synced_revision: Option<String>,
    pub sync_checkpoint: Option<String>,
    pub ignored_at: Option<String>,
}

impl Entry {
    /// What tells one version of the provider's conversation from the next.
    pub fn token(&self) -> Option<String> {
        self.revision.clone().or_else(|| self.updated_at.clone())
    }
}

const COLUMNS: &str = "id,provider_id,instance_id,native_id,origin,session_id,project_id,
    worktree_id,project_source,title,preview,cwd,created_at,updated_at,revision,resumable,
    discovered_at,seen_scan,missing_since,synced_at,synced_revision,sync_checkpoint,ignored_at";

fn entry(row: &Row<'_>) -> rusqlite::Result<Entry> {
    Ok(Entry {
        id: row.get(0)?,
        provider_id: row.get(1)?,
        instance_id: row.get(2)?,
        native_id: row.get(3)?,
        origin: row.get(4)?,
        session_id: row.get(5)?,
        project_id: row.get(6)?,
        worktree_id: row.get(7)?,
        project_source: row.get(8)?,
        title: row.get(9)?,
        preview: row.get(10)?,
        cwd: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        revision: row.get(14)?,
        resumable: row.get(15)?,
        discovered_at: row.get(16)?,
        seen_scan: row.get(17)?,
        missing_since: row.get(18)?,
        synced_at: row.get(19)?,
        synced_revision: row.get(20)?,
        sync_checkpoint: row.get(21)?,
        ignored_at: row.get(22)?,
    })
}

/// A page of `history_list`, newest first.
pub(crate) struct ListFilter<'a> {
    pub provider_id: Option<&'a str>,
    pub ignored: bool,
    /// Continue after this `(sort_at, id)`.
    pub after: Option<(&'a str, &'a str)>,
    pub limit: u32,
}

impl Store {
    pub fn history_entry(&self, id: &str) -> Result<Entry, JamError> {
        self.connection
            .query_row(
                &format!("SELECT {COLUMNS} FROM provider_history WHERE id=?1"),
                [id],
                entry,
            )
            .optional()?
            .ok_or_else(|| JamError::new("not_found", "That history entry is not in JAM Code."))
    }

    pub fn history_by_native(
        &self,
        provider_id: &str,
        instance_id: &str,
        native_id: &str,
    ) -> Result<Option<Entry>, JamError> {
        Ok(self
            .connection
            .query_row(
                &format!(
                    "SELECT {COLUMNS} FROM provider_history
                     WHERE provider_id=?1 AND instance_id=?2 AND native_id=?3"
                ),
                params![provider_id, instance_id, native_id],
                entry,
            )
            .optional()?)
    }

    pub fn save_history(&self, entry: &Entry) -> Result<(), JamError> {
        let sort_at = entry.updated_at.as_ref().unwrap_or(&entry.discovered_at);
        self.connection.execute(
            &format!(
                "INSERT INTO provider_history({COLUMNS},sort_at) VALUES
                 (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)
                 ON CONFLICT(id) DO UPDATE SET origin=excluded.origin,session_id=excluded.session_id,
                   project_id=excluded.project_id,worktree_id=excluded.worktree_id,
                   project_source=excluded.project_source,title=excluded.title,
                   preview=excluded.preview,cwd=excluded.cwd,created_at=excluded.created_at,
                   updated_at=excluded.updated_at,revision=excluded.revision,
                   resumable=excluded.resumable,seen_scan=excluded.seen_scan,
                   missing_since=excluded.missing_since,synced_at=excluded.synced_at,
                   synced_revision=excluded.synced_revision,
                   sync_checkpoint=excluded.sync_checkpoint,ignored_at=excluded.ignored_at,
                   sort_at=excluded.sort_at"
            ),
            params![
                entry.id,
                entry.provider_id,
                entry.instance_id,
                entry.native_id,
                entry.origin,
                entry.session_id,
                entry.project_id,
                entry.worktree_id,
                entry.project_source,
                entry.title,
                entry.preview,
                entry.cwd,
                entry.created_at,
                entry.updated_at,
                entry.revision,
                entry.resumable,
                entry.discovered_at,
                entry.seen_scan,
                entry.missing_since,
                entry.synced_at,
                entry.synced_revision,
                entry.sync_checkpoint,
                entry.ignored_at,
                sort_at,
            ],
        )?;
        Ok(())
    }

    pub fn history_list(&self, filter: ListFilter<'_>) -> Result<Vec<Entry>, JamError> {
        let (after_sort, after_id) = filter.after.unzip();
        let mut statement = self.connection.prepare(&format!(
            "SELECT {COLUMNS} FROM provider_history
             WHERE (?1 IS NULL OR provider_id=?1)
               AND (ignored_at IS NOT NULL)=?2
               AND (?3 IS NULL OR sort_at<?3 OR (sort_at=?3 AND id<?4))
             ORDER BY sort_at DESC, id DESC LIMIT ?5"
        ))?;
        let rows = statement.query_map(
            params![
                filter.provider_id,
                filter.ignored,
                after_sort,
                after_id,
                filter.limit
            ],
            entry,
        )?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// A JAM session already bound to this provider conversation and not yet
    /// indexed: the conversation JAM itself started.
    pub fn unindexed_binding(
        &self,
        provider_id: &str,
        instance_id: &str,
        native_id: &str,
    ) -> Result<Option<String>, JamError> {
        Ok(self
            .connection
            .query_row(
                "SELECT session_id FROM provider_bindings
                 WHERE provider_id=?1 AND instance_id=?2 AND native_id=?3
                   AND session_id NOT IN
                     (SELECT session_id FROM provider_history WHERE session_id IS NOT NULL)
                 ORDER BY updated_at DESC LIMIT 1",
                params![provider_id, instance_id, native_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// Records that a scan finished without the provider listing these, and
    /// returns how many of the provider's entries it did not list.
    pub fn mark_unlisted(
        &self,
        provider_id: &str,
        instance_id: &str,
        scan: &str,
        now: &str,
    ) -> Result<u32, JamError> {
        const UNLISTED: &str = "provider_id=?1 AND instance_id=?2 AND seen_scan IS NOT ?3";
        self.connection.execute(
            &format!(
                "UPDATE provider_history SET missing_since=?4
                 WHERE {UNLISTED} AND missing_since IS NULL"
            ),
            params![provider_id, instance_id, scan, now],
        )?;
        Ok(self.connection.query_row(
            &format!("SELECT count(*) FROM provider_history WHERE {UNLISTED}"),
            params![provider_id, instance_id, scan],
            |row| row.get(0),
        )?)
    }

    /// Whether JAM recorded any message of this conversation itself: a turn
    /// sent from JAM, rather than one read from the provider's history.
    pub fn has_recorded_messages(&self, conversation_id: &str) -> Result<bool, JamError> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM messages WHERE conversation_id=?1 AND source_id IS NULL)",
            [conversation_id],
            |row| row.get(0),
        )?)
    }

    /// Deleting a conversation leaves the entry it was linked to in the
    /// index, without it. The caller holds the transaction, before the
    /// session rows go.
    pub fn unlink_history(&self, session_id: &str) -> Result<(), JamError> {
        self.connection.execute(
            "UPDATE provider_history SET session_id=NULL,synced_at=NULL,synced_revision=NULL,
               sync_checkpoint=NULL
             WHERE session_id=?1",
            [session_id],
        )?;
        Ok(())
    }

    /// An entry as the client sees it: addressed by JAM's ID, with its
    /// projection's project when it has one.
    pub fn history_wire(&self, entry: &Entry) -> Result<HistoryEntry, JamError> {
        let resource = match &entry.session_id {
            Some(session_id) => Some(self.resource(&self.session(session_id)?.resource_id)?),
            None => None,
        };
        let changed = match &resource {
            Some(resource) => {
                entry.synced_at.is_some()
                    && entry.token() != entry.synced_revision
                    && !self.has_recorded_messages(&resource.id)?
            }
            None => false,
        };
        let (project_id, worktree_id) = match &resource {
            Some(resource) => (resource.project_id.clone(), resource.worktree_id.clone()),
            None => (entry.project_id.clone(), entry.worktree_id.clone()),
        };
        Ok(HistoryEntry {
            id: entry.id.clone(),
            provider_id: entry.provider_id.clone(),
            origin: entry.origin.clone(),
            title: entry.title.clone(),
            preview: entry.preview.clone(),
            created_at: entry.created_at.clone(),
            updated_at: entry.updated_at.clone(),
            discovered_at: entry.discovered_at.clone(),
            synced_at: entry.synced_at.clone(),
            resource_id: resource.map(|resource| resource.id),
            project_id,
            worktree_id,
            source_path: entry.cwd.clone(),
            missing_since: entry.missing_since.clone(),
            ignored_at: entry.ignored_at.clone(),
            changed,
            resumable: entry.resumable,
        })
    }
}
