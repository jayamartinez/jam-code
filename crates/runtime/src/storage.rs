use crate::{commands::SearchQuery, error::JamError, protocol::*};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{path::Path, time::Duration};

pub(crate) const SCHEMA_VERSION: i64 = 8;
/// Projects that have not been removed from JAM.
const ACTIVE_PROJECT: &str = "json_extract(data,'$.removedAt') IS NULL";

/// A JAM session's link to the provider's own session or thread.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Binding {
    pub provider_id: String,
    pub native_id: String,
}

pub(crate) struct Store {
    pub connection: Connection,
}

fn decode<T: DeserializeOwned>(data: String) -> rusqlite::Result<T> {
    serde_json::from_str(&data).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}

impl Store {
    pub fn open(path: &Path) -> Result<Self, JamError> {
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(3))?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(JamError::new(
                "unavailable",
                "This database was created by a newer version of JAM Code. Update JAM Code to open it.",
            ));
        }
        if version > 0 && version < SCHEMA_VERSION {
            backup_before_upgrade(&connection, path, version)?;
        }
        // Numbered, transactional, additive. A failed migration leaves the
        // previous version intact rather than resetting anything.
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            let target = index as i64 + 1;
            if version >= target {
                continue;
            }
            let transaction = connection.transaction()?;
            match migration {
                Migration::Sql(sql) => transaction.execute_batch(sql)?,
                Migration::Code(step) => step(&transaction)?,
            }
            transaction.pragma_update(None, "user_version", target)?;
            transaction.commit()?;
        }
        let store = Self { connection };
        store.transaction(|| {
            for mut session in store.sessions()? {
                if session.status == SessionStatus::Running || session.needs_input {
                    if session.status == SessionStatus::Running {
                        session.status = SessionStatus::Interrupted;
                    }
                    session.needs_input = false;
                    store.save_session(&session)?;
                    // The provider process that asked is gone with the old run.
                    store.interrupt_messages(&session.resource_id, InteractionStatus::Expired)?;
                }
            }
            Ok(())
        })?;
        Ok(store)
    }

    /// Explicit demo-only initialization; reopening never replaces user-created demo records.
    pub fn seed_demo(&mut self) -> Result<(), JamError> {
        let seeded = self
            .connection
            .query_row(
                "SELECT value FROM metadata WHERE key = 'demo_seed_v1'",
                [],
                |r| r.get::<_, String>(0),
            )
            .optional()?
            .is_some();
        if seeded {
            return Ok(());
        }
        let fixture: DemoFixture = serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/workspace.json"
        ))?;
        self.connection.execute_batch("BEGIN IMMEDIATE")?;
        let result = self.insert_fixture(fixture);
        match result {
            Ok(()) => self.connection.execute_batch("COMMIT")?,
            Err(error) => {
                self.connection.execute_batch("ROLLBACK")?;
                return Err(error);
            }
        }
        Ok(())
    }

    /// The one Settings resource, so Settings can open as a tab. It is part
    /// of every database, not of the demo, and reopening never duplicates it.
    pub fn ensure_settings_resource(&self) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT OR IGNORE INTO resources(id,project_id,data) VALUES ('settings',NULL,?1)",
            [serde_json::json!({
                "id": "settings",
                "kind": "settings",
                "title": "Settings",
                "pinned": false,
                "updatedAt": crate::runtime::now(),
            })
            .to_string()],
        )?;
        Ok(())
    }

    fn insert_fixture(&self, fixture: DemoFixture) -> Result<(), JamError> {
        for project in &fixture.workspace.projects {
            self.connection.execute(
                "INSERT INTO projects(id,data) VALUES (?1,?2)",
                params![project.id, serde_json::to_string(project)?],
            )?;
        }
        for resource in &fixture.workspace.resources {
            self.save_resource(resource)?;
        }
        for conversation in &fixture.conversations {
            self.connection.execute(
                "INSERT INTO conversations(id,resource_id,data) VALUES (?1,?1,?2)",
                params![
                    conversation.resource_id,
                    serde_json::to_string(
                        &serde_json::json!({"sessionId":conversation.session_id})
                    )?
                ],
            )?;
        }
        for session in &fixture.workspace.sessions {
            self.save_session(session)?;
        }
        for conversation in &fixture.conversations {
            let resource = self.resource(&conversation.resource_id)?;
            for message in &conversation.messages {
                self.save_message(&resource, message)?;
            }
        }
        // Provider descriptors are live runtime state, not seeded records.
        self.connection.execute(
            "INSERT INTO metadata(key,value) VALUES ('demo_seed_v1','1')",
            [],
        )?;
        Ok(())
    }

    fn all<T: DeserializeOwned>(&self, sql: &str) -> Result<Vec<T>, JamError> {
        let mut stmt = self.connection.prepare(sql)?;
        Ok(stmt
            .query_map([], |row| decode(row.get(0)?))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn sessions(&self) -> Result<Vec<Session>, JamError> {
        self.all("SELECT data FROM sessions ORDER BY rowid")
    }

    /// Records. Provider descriptors come from the runtime's provider
    /// manager, not the database, and are filled in by the caller.
    pub fn workspace(&self, cursor: Cursor) -> Result<WorkspaceSnapshot, JamError> {
        Ok(WorkspaceSnapshot {
            protocol_version: VERSION,
            runtime_id: cursor.runtime_id,
            sequence: cursor.sequence,
            projects: self.all(&format!(
                "SELECT data FROM projects WHERE {ACTIVE_PROJECT} ORDER BY rowid"
            ))?,
            resources: self.all(&format!(
                "SELECT data FROM resources WHERE project_id IS NULL OR project_id IN
                   (SELECT id FROM projects WHERE {ACTIVE_PROJECT}) ORDER BY rowid"
            ))?,
            sessions: self.all(&format!(
                "SELECT s.data FROM sessions s JOIN resources r ON r.id=s.conversation_id
                 WHERE r.project_id IS NULL OR r.project_id IN
                   (SELECT id FROM projects WHERE {ACTIVE_PROJECT}) ORDER BY s.rowid"
            ))?,
            providers: Vec::new(),
            worktrees: self.all(&format!(
                "SELECT data FROM worktrees WHERE project_id IN
                   (SELECT id FROM projects WHERE {ACTIVE_PROJECT}) ORDER BY rowid"
            ))?,
        })
    }

    pub fn worktree(&self, id: &str) -> Result<Worktree, JamError> {
        self.connection
            .query_row("SELECT data FROM worktrees WHERE id=?1", [id], |row| {
                decode(row.get(0)?)
            })
            .optional()?
            .ok_or_else(|| JamError::new("not_found", "Worktree not found."))
    }

    pub fn save_worktree(&self, worktree: &Worktree) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO worktrees(id,project_id,data) VALUES (?1,?2,?3)",
            params![
                worktree.id,
                worktree.project_id,
                serde_json::to_string(worktree)?
            ],
        )?;
        Ok(())
    }

    pub fn binding(&self, session_id: &str) -> Result<Option<Binding>, JamError> {
        Ok(self
            .connection
            .query_row(
                "SELECT provider_id,native_id FROM provider_bindings WHERE session_id=?1",
                [session_id],
                |row| {
                    Ok(Binding {
                        provider_id: row.get(0)?,
                        native_id: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }

    /// Links a session to its provider's ID. A new ID (a resume that had to
    /// start fresh) replaces the old one; the JAM session is unchanged.
    pub fn save_binding(
        &self,
        session_id: &str,
        provider_id: &str,
        native_id: &str,
        data: &Value,
    ) -> Result<(), JamError> {
        let now = crate::runtime::now();
        self.connection.execute(
            "INSERT INTO provider_bindings(session_id,provider_id,native_id,created_at,updated_at,data)
             VALUES (?1,?2,?3,?4,?4,?5)
             ON CONFLICT(session_id) DO UPDATE SET native_id=excluded.native_id,
               updated_at=excluded.updated_at,data=excluded.data",
            params![session_id, provider_id, native_id, now, data.to_string()],
        )?;
        Ok(())
    }

    pub fn resource(&self, id: &str) -> Result<Resource, JamError> {
        self.connection
            .query_row("SELECT data FROM resources WHERE id=?1", [id], |row| {
                decode(row.get(0)?)
            })
            .optional()?
            .ok_or_else(|| JamError::new("not_found", "Resource not found."))
    }

    pub fn session(&self, id: &str) -> Result<Session, JamError> {
        self.connection
            .query_row("SELECT data FROM sessions WHERE id=?1", [id], |row| {
                decode(row.get(0)?)
            })
            .optional()?
            .ok_or_else(|| JamError::new("not_found", "Session not found."))
    }

    pub fn conversation(
        &self,
        resource_id: &str,
        cursor: Cursor,
    ) -> Result<Conversation, JamError> {
        let resource = self.resource(resource_id)?;
        let session_id = resource.session_id.ok_or_else(|| {
            JamError::new("not_found", "This resource is not an agent conversation.")
        })?;
        let mut statement = self.connection.prepare("SELECT data FROM (SELECT data,ordinal FROM messages WHERE conversation_id=?1 ORDER BY ordinal DESC LIMIT 500) ORDER BY ordinal")?;
        let messages = statement
            .query_map([resource_id], |row| decode(row.get(0)?))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Conversation {
            resource_id: resource_id.into(),
            session_id,
            messages,
            cursor,
        })
    }

    /// The saved working copy of a file, if one has been written.
    pub fn file_edit(&self, project_id: &str, path: &str) -> Result<Option<String>, JamError> {
        Ok(self
            .connection
            .query_row(
                "SELECT text FROM file_edits WHERE project_id=?1 AND path=?2",
                params![project_id, path],
                |row| row.get::<_, String>(0),
            )
            .optional()?)
    }

    pub fn save_file_edit(
        &self,
        project_id: &str,
        path: &str,
        text: &str,
        updated_at: &str,
    ) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO file_edits(project_id,path,text,updated_at) VALUES (?1,?2,?3,?4)
             ON CONFLICT(project_id,path) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at",
            params![project_id, path, text, updated_at],
        )?;
        Ok(())
    }

    pub fn setting(&self, key: &str) -> Result<Option<String>, JamError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM settings WHERE key=?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()?)
    }

    pub fn save_setting(&self, key: &str, value: &str, updated_at: &str) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO settings(key,value,updated_at) VALUES (?1,?2,?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
            params![key, value, updated_at],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), JamError> {
        self.connection
            .execute("DELETE FROM settings WHERE key=?1", params![key])?;
        Ok(())
    }

    /// Every project, including removed ones, so adding a folder again can
    /// bring its history back.
    pub fn all_projects(&self) -> Result<Vec<Project>, JamError> {
        self.all("SELECT data FROM projects ORDER BY rowid")
    }

    pub fn insert_project(&self, project: &Project) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO projects(id,data) VALUES (?1,?2)",
            params![project.id, serde_json::to_string(project)?],
        )?;
        Ok(())
    }

    pub fn save_project(&self, project: &Project) -> Result<(), JamError> {
        self.connection.execute(
            "UPDATE projects SET data=?2 WHERE id=?1",
            params![project.id, serde_json::to_string(project)?],
        )?;
        Ok(())
    }

    pub fn save_resource(&self, resource: &Resource) -> Result<(), JamError> {
        self.connection.execute("INSERT INTO resources(id,project_id,data) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![resource.id, resource.project_id, serde_json::to_string(resource)?])?;
        Ok(())
    }

    pub fn save_session(&self, session: &Session) -> Result<(), JamError> {
        self.connection.execute("INSERT INTO sessions(id,conversation_id,data) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![session.id, session.resource_id, serde_json::to_string(session)?])?;
        Ok(())
    }

    /// A conversation's resource, record and session. The caller holds a
    /// transaction so a worktree and receipt commit with them.
    pub fn insert_conversation(
        &self,
        resource: &Resource,
        session: &Session,
    ) -> Result<(), JamError> {
        self.save_resource(resource)?;
        self.connection.execute(
            "INSERT INTO conversations(id,resource_id,data) VALUES (?1,?1,?2)",
            params![
                resource.id,
                serde_json::to_string(&serde_json::json!({"sessionId":session.id}))?
            ],
        )?;
        self.save_session(session)
    }

    pub fn save_message(&self, resource: &Resource, message: &Message) -> Result<(), JamError> {
        self.connection.execute("INSERT INTO messages(id,conversation_id,ordinal,data) VALUES (?1,?2,(SELECT coalesce(max(ordinal),0)+1 FROM messages WHERE conversation_id=?2),?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![message.id, resource.id, serde_json::to_string(message)?])?;
        self.connection.execute("INSERT INTO search_documents(resource_id,message_id,title,body) VALUES (?1,?2,?3,?4) ON CONFLICT(message_id) DO UPDATE SET title=excluded.title,body=excluded.body", params![resource.id, message.id, resource.title, message.searchable_text()])?;
        Ok(())
    }

    /// Ends running tools and unanswered requests in a conversation.
    /// `pending` is what an unanswered request becomes: `Cancelled` after an
    /// explicit interrupt, `Expired` when the provider can no longer answer.
    pub fn interrupt_messages(
        &self,
        resource_id: &str,
        pending: InteractionStatus,
    ) -> Result<Vec<Message>, JamError> {
        let resource = self.resource(resource_id)?;
        let conversation = self.conversation(resource_id, Cursor::default())?;
        let mut changed = Vec::new();
        for mut message in conversation.messages {
            let mut interrupted = false;
            for block in &mut message.blocks {
                match block {
                    MessageBlock::Tool { status, detail, .. } if status == "running" => {
                        *status = "failed".into();
                        detail.push_str(if detail.is_empty() {
                            "Interrupted"
                        } else {
                            " · Interrupted"
                        });
                        interrupted = true;
                    }
                    MessageBlock::Interaction { interaction }
                        if interaction.status == InteractionStatus::Pending =>
                    {
                        interaction.status = pending;
                        interaction.outcome = Some(
                            if pending == InteractionStatus::Expired {
                                "No longer waiting: JAM restarted"
                            } else {
                                "Interrupted"
                            }
                            .into(),
                        );
                        interrupted = true;
                    }
                    _ => {}
                }
            }
            if interrupted {
                self.save_message(&resource, &message)?;
                changed.push(message);
            }
        }
        Ok(changed)
    }

    pub fn transaction<T>(
        &self,
        operation: impl FnOnce() -> Result<T, JamError>,
    ) -> Result<T, JamError> {
        self.connection.execute_batch("BEGIN IMMEDIATE")?;
        match operation() {
            Ok(value) => {
                if let Err(error) = self.connection.execute_batch("COMMIT") {
                    let _ = self.connection.execute_batch("ROLLBACK");
                    return Err(error.into());
                }
                Ok(value)
            }
            Err(error) => {
                self.connection.execute_batch("ROLLBACK")?;
                Err(error)
            }
        }
    }

    pub fn receipt(&self, id: &str, fingerprint: &str) -> Result<Option<Value>, JamError> {
        let previous: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT fingerprint,receipt FROM requests WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        match previous {
            None => Ok(None),
            Some((previous, receipt)) if previous == fingerprint => {
                Ok(Some(serde_json::from_str(&receipt)?))
            }
            Some(_) => Err(JamError::new(
                "conflict",
                "This request ID was already used for different content.",
            )),
        }
    }

    pub fn save_receipt(
        &self,
        id: &str,
        fingerprint: &str,
        receipt: &impl Serialize,
    ) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO requests(id,fingerprint,receipt) VALUES (?1,?2,?3)",
            params![id, fingerprint, serde_json::to_string(receipt)?],
        )?;
        Ok(())
    }

    pub fn search(&self, query: SearchQuery) -> Result<Vec<SearchResult>, JamError> {
        if query.query.encode_utf16().count() > 256 {
            return Err(JamError::invalid(
                "Search queries must be at most 256 characters.",
            ));
        }
        if let Some(id) = &query.project_id {
            crate::commands::validate_id(id)?;
        }
        if query
            .provider_id
            .as_deref()
            .is_some_and(|id| !["mock", "claude", "codex"].contains(&id))
        {
            return Err(JamError::invalid("Unknown provider filter."));
        }
        let tokens = query
            .query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|s| !s.is_empty())
            .take(20)
            .map(|s| format!("\"{s}\"*"))
            .collect::<Vec<_>>();
        if tokens.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self.connection.prepare(
            "WITH hits AS MATERIALIZED (
                SELECT d.resource_id, r.data AS resource_data, s.data AS session_data,
                       snippet(search_fts,1,'','',' … ',32) AS excerpt,
                       search_fts.rank AS score
                FROM search_fts
                JOIN search_documents d ON d.id=search_fts.rowid
                JOIN resources r ON r.id=d.resource_id
                JOIN sessions s ON s.conversation_id=r.id
                JOIN projects p ON p.id=r.project_id
                WHERE search_fts MATCH ?1
                  AND json_extract(p.data,'$.removedAt') IS NULL
                  AND (?2 IS NULL OR r.project_id=?2)
                  AND (?3 IS NULL OR json_extract(r.data,'$.pinned')=?3)
                  AND (?4 IS NULL OR json_extract(s.data,'$.providerId')=?4)
            ), ranked AS (
                SELECT *, row_number() OVER (PARTITION BY resource_id ORDER BY score) AS hit_rank
                FROM hits
            )
            SELECT resource_data,session_data,excerpt FROM ranked
            WHERE hit_rank=1 ORDER BY score,resource_id LIMIT 50",
        )?;
        let rows = stmt.query_map(
            params![
                tokens.join(" AND "),
                query.project_id,
                query.pinned,
                query.provider_id
            ],
            |row| {
                let resource: Resource = decode(row.get(0)?)?;
                let session: Session = decode(row.get(1)?)?;
                Ok(SearchResult {
                    resource_id: resource.id,
                    title: resource.title,
                    project_id: resource.project_id.unwrap_or_default(),
                    provider_id: session.provider_id,
                    presentation: session.presentation,
                    pinned: resource.pinned,
                    snippet: bounded_snippet(row.get(2)?),
                    updated_at: resource.updated_at,
                })
            },
        )?;
        let mut found = std::collections::HashSet::new();
        Ok(rows
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|r| found.insert(r.resource_id.clone()))
            .take(50)
            .collect())
    }
}

/// Removes a conversation's rows in foreign-key order: its provider binding,
/// search documents (triggers keep the FTS index in step), messages, sessions,
/// conversation record and resource. The caller holds the transaction.
pub(crate) fn delete_conversation_rows(connection: &Connection, id: &str) -> Result<(), JamError> {
    connection.execute(
        "DELETE FROM provider_bindings WHERE session_id IN (SELECT id FROM sessions WHERE conversation_id=?1)",
        [id],
    )?;
    connection.execute("DELETE FROM search_documents WHERE resource_id=?1", [id])?;
    connection.execute("DELETE FROM messages WHERE conversation_id=?1", [id])?;
    connection.execute("DELETE FROM sessions WHERE conversation_id=?1", [id])?;
    connection.execute("DELETE FROM conversations WHERE id=?1", [id])?;
    connection.execute("DELETE FROM resources WHERE id=?1", [id])?;
    Ok(())
}

enum Migration {
    Sql(&'static str),
    Code(fn(&rusqlite::Transaction<'_>) -> Result<(), JamError>),
}

const MIGRATIONS: [Migration; 8] = [
    Migration::Sql(include_str!("migrations/001-foundation.sql")),
    Migration::Sql(include_str!("migrations/002-file-edits.sql")),
    Migration::Sql(include_str!("migrations/003-settings.sql")),
    Migration::Sql(include_str!("migrations/004-snapshots.sql")),
    Migration::Sql(include_str!("migrations/005-provider-bindings.sql")),
    Migration::Sql(include_str!("migrations/006-worktrees.sql")),
    Migration::Code(crate::demo_cleanup::remove_demo_seed),
    Migration::Sql(include_str!("migrations/008-attachments.sql")),
];

/// A copy of the database as it was before an upgrade, beside it, so a
/// failed or unwanted upgrade can be undone by hand. Written once per
/// version; an in-memory database has nothing to copy.
fn backup_before_upgrade(
    connection: &Connection,
    path: &Path,
    version: i64,
) -> Result<(), JamError> {
    if path.as_os_str().is_empty() || path == Path::new(":memory:") {
        return Ok(());
    }
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".before-v{}.bak", version + 1));
    let backup = path.with_file_name(name);
    if backup.exists() {
        return Ok(());
    }
    let target = backup.to_str().ok_or_else(|| {
        JamError::new(
            "unavailable",
            "The database folder's name cannot be used for a backup.",
        )
    })?;
    connection
        .execute("VACUUM INTO ?1", [target])
        .map_err(|error| {
            JamError::new(
                "unavailable",
                format!("JAM Code could not back up its database before upgrading it: {error}"),
            )
        })?;
    Ok(())
}

/// Copies a database written by an earlier build under another file name to
/// `target`, leaving the original untouched as a fallback. The copy is
/// consistent even with a write-ahead log beside the source, and appears at
/// `target` only once it is complete.
pub(crate) fn import_database(source: &Path, target: &Path) -> Result<(), JamError> {
    let partial = target.with_extension("sqlite.importing");
    if partial.exists() {
        std::fs::remove_file(&partial).map_err(file_error)?;
    }
    {
        let connection = Connection::open(source)?;
        connection.busy_timeout(Duration::from_secs(3))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(JamError::new(
                "unavailable",
                "The existing database was created by a newer version of JAM Code.",
            ));
        }
        let destination = partial.to_str().ok_or_else(|| {
            JamError::new("unavailable", "The data folder's name cannot be used.")
        })?;
        connection.execute("VACUUM INTO ?1", [destination])?;
    }
    if let Some(name) = source.file_name().and_then(|name| name.to_str()) {
        let connection = Connection::open(&partial)?;
        let has_metadata: bool = connection.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='metadata'",
            [],
            |row| row.get(0),
        )?;
        if has_metadata {
            connection.execute(
                "INSERT OR REPLACE INTO metadata(key,value) VALUES ('imported_from',?1)",
                [name],
            )?;
        }
    }
    std::fs::rename(&partial, target).map_err(file_error)?;
    Ok(())
}

fn file_error(error: std::io::Error) -> JamError {
    JamError::new(
        "unavailable",
        format!("JAM Code could not prepare its database: {error}"),
    )
}

fn bounded_snippet(text: String) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 4096
        })
        .collect()
}
