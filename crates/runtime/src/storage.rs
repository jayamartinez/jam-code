use crate::{commands::SearchQuery, error::JamError, protocol::*};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{path::Path, time::Duration};

pub(crate) const SCHEMA_VERSION: i64 = 2;

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
                "This database was created by a newer JAM version.",
            ));
        }
        // Numbered, transactional, additive. A failed migration leaves the
        // previous version intact rather than resetting anything.
        const MIGRATIONS: [&str; 2] = [
            include_str!("migrations/001-foundation.sql"),
            include_str!("migrations/002-file-edits.sql"),
        ];
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            let target = index as i64 + 1;
            if version >= target {
                continue;
            }
            let transaction = connection.transaction()?;
            transaction.execute_batch(migration)?;
            transaction.pragma_update(None, "user_version", target)?;
            transaction.commit()?;
        }
        let store = Self { connection };
        store.transaction(|| {
            for mut session in store.sessions()? {
                if session.status == SessionStatus::Running {
                    session.status = SessionStatus::Interrupted;
                    store.save_session(&session)?;
                    store.interrupt_messages(&session.resource_id)?;
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
        self.connection.execute(
            "INSERT INTO metadata(key,value) VALUES ('providers',?1)",
            [serde_json::to_string(&fixture.workspace.providers)?],
        )?;
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

    pub fn workspace(&self, cursor: Cursor) -> Result<WorkspaceSnapshot, JamError> {
        let sessions = self.sessions()?;
        let mut providers: Vec<Value> = self
            .connection
            .query_row(
                "SELECT value FROM metadata WHERE key = 'providers'",
                [],
                |row| decode(row.get(0)?),
            )
            .optional()?
            .unwrap_or_default();
        for provider in &mut providers {
            if provider["id"] == "mock" {
                provider["running"] =
                    Value::Bool(sessions.iter().any(|s| s.status == SessionStatus::Running));
            }
        }
        Ok(WorkspaceSnapshot {
            protocol_version: VERSION,
            runtime_id: cursor.runtime_id,
            sequence: cursor.sequence,
            projects: self.all("SELECT data FROM projects ORDER BY rowid")?,
            resources: self.all("SELECT data FROM resources ORDER BY rowid")?,
            sessions,
            providers,
        })
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

    pub fn create_conversation(
        &self,
        resource: &Resource,
        session: &Session,
    ) -> Result<(), JamError> {
        self.transaction(|| {
            self.save_resource(resource)?;
            self.connection.execute(
                "INSERT INTO conversations(id,resource_id,data) VALUES (?1,?1,?2)",
                params![
                    resource.id,
                    serde_json::to_string(&serde_json::json!({"sessionId":session.id}))?
                ],
            )?;
            self.save_session(session)
        })
    }

    pub fn save_message(&self, resource: &Resource, message: &Message) -> Result<(), JamError> {
        self.connection.execute("INSERT INTO messages(id,conversation_id,ordinal,data) VALUES (?1,?2,(SELECT coalesce(max(ordinal),0)+1 FROM messages WHERE conversation_id=?2),?3) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![message.id, resource.id, serde_json::to_string(message)?])?;
        self.connection.execute("INSERT INTO search_documents(resource_id,message_id,title,body) VALUES (?1,?2,?3,?4) ON CONFLICT(message_id) DO UPDATE SET title=excluded.title,body=excluded.body", params![resource.id, message.id, resource.title, message.searchable_text()])?;
        Ok(())
    }

    pub fn interrupt_messages(&self, resource_id: &str) -> Result<Vec<Message>, JamError> {
        let resource = self.resource(resource_id)?;
        let conversation = self.conversation(resource_id, Cursor::default())?;
        let mut changed = Vec::new();
        for mut message in conversation.messages {
            let mut interrupted = false;
            for block in &mut message.blocks {
                if let MessageBlock::Tool { status, detail, .. } = block
                    && status == "running"
                {
                    *status = "failed".into();
                    detail.push_str(" · Interrupted");
                    interrupted = true;
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
        if query.provider_id.as_deref().is_some_and(|id| id != "mock") {
            return Ok(Vec::new());
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
                WHERE search_fts MATCH ?1
                  AND (?2 IS NULL OR r.project_id=?2)
                  AND (?3 IS NULL OR json_extract(r.data,'$.pinned')=?3)
            ), ranked AS (
                SELECT *, row_number() OVER (PARTITION BY resource_id ORDER BY score) AS hit_rank
                FROM hits
            )
            SELECT resource_data,session_data,excerpt FROM ranked
            WHERE hit_rank=1 ORDER BY score,resource_id LIMIT 50",
        )?;
        let rows = stmt.query_map(
            params![tokens.join(" AND "), query.project_id, query.pinned],
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

fn bounded_snippet(text: String) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 4096
        })
        .collect()
}
