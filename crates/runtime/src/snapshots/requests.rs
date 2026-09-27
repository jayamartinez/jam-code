use super::*;
use crate::commands::{parse, validate_id};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Focus {
    resource_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Id {
    id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Stage {
    id: String,
    resource_id: Option<String>,
    note: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    id: String,
    thumbnail: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Cleanup {
    all: bool,
}
impl Runtime {
    pub(crate) fn snapshot_request(&self, method: &str, params: Value) -> Result<Value, JamError> {
        match method {
            "snapshot.list" => {
                let _: Empty = parse(params)?;
                let state = self.lock()?;
                let mut stmt = state.store.connection.prepare(
                    "SELECT data FROM snapshots WHERE sent=0 ORDER BY captured_at DESC LIMIT 500",
                )?;
                let records = stmt
                    .query_map([], |r| r.get::<_, String>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                let snapshots = records
                    .iter()
                    .map(|s| serde_json::from_str::<Snapshot>(s))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(json!({"snapshots":snapshots}))
            }
            "snapshot.settings.get" => {
                let _: Empty = parse(params)?;
                Ok(serde_json::to_value(self.snapshot_settings()?)?)
            }
            "snapshot.settings.update" => {
                let settings: SnapshotSettings = parse(params)?;
                settings.validate()?;
                self.lock()?.store.connection.execute("INSERT INTO metadata(key,value) VALUES ('snapshot_settings',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&settings)?])?;
                Ok(serde_json::to_value(settings)?)
            }
            "snapshot.focus" => {
                let input: Focus = parse(params)?;
                validate_id(&input.resource_id)?;
                let state = self.lock()?;
                let resource = state.store.resource(&input.resource_id)?;
                if resource.kind != "conversation" || resource.session_id.is_none() {
                    return Err(JamError::invalid(
                        "Snapshot destination must be an agent conversation.",
                    ));
                }
                state.store.connection.execute("INSERT INTO metadata(key,value) VALUES ('snapshot_last_conversation',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[input.resource_id])?;
                Ok(json!({"accepted":true}))
            }
            "snapshot.stage" => {
                // This command uses an explicit null destination to move to the inbox.
                // The generic parser rejects all nulls, so deserialize this narrow shape here.
                if params.get("resourceId").is_none() {
                    return Err(JamError::invalid(
                        "A destination or explicit null is required.",
                    ));
                }
                let input: Stage = serde_json::from_value(params)?;
                validate_id(&input.id)?;
                if input.note.encode_utf16().count() > 2000 {
                    return Err(JamError::invalid("Snapshot note is too long."));
                }
                let state = self.lock()?;
                if let Some(id) = &input.resource_id {
                    validate_id(id)?;
                    let resource = state.store.resource(id)?;
                    if resource.kind != "conversation" || resource.session_id.is_none() {
                        return Err(JamError::invalid("Choose an agent conversation."));
                    }
                }
                let mut snapshot = state.store.snapshot(&input.id)?;
                if snapshot.sent {
                    return Err(JamError::new("conflict", "This snapshot was already sent."));
                }
                snapshot.resource_id = input.resource_id;
                snapshot.note = input.note;
                snapshot.context.source.selection = if snapshot.note.is_empty() {
                    None
                } else {
                    Some(snapshot.note.clone())
                };
                state.store.save_snapshot(&snapshot)?;
                Ok(serde_json::to_value(snapshot)?)
            }
            "snapshot.remove" => {
                let input: Id = parse(params)?;
                validate_id(&input.id)?;
                let state = self.lock()?;
                let snapshot = state.store.snapshot(&input.id)?;
                if snapshot.sent {
                    return Err(JamError::new(
                        "conflict",
                        "An attached snapshot belongs to conversation history.",
                    ));
                }
                self.snapshots.assets.delete(&input.id)?;
                state
                    .store
                    .connection
                    .execute("DELETE FROM snapshots WHERE id=?1", [input.id])?;
                Ok(json!({"accepted":true}))
            }
            "snapshot.asset" => {
                let input: Asset = parse(params)?;
                validate_id(&input.id)?;
                let state = self.lock()?;
                state.store.snapshot(&input.id)?;
                let bytes = self.snapshots.assets.read(&input.id, input.thumbnail)?;
                Ok(json!({"dataUrl":format!("data:image/jpeg;base64,{}",STANDARD.encode(bytes))}))
            }
            "snapshot.cleanup" => {
                let input: Cleanup = parse(params)?;
                Ok(json!({"removed":self.cleanup_snapshots(timestamp_ms(),input.all)?}))
            }
            _ => Err(JamError::new("unknown_method", "Unknown snapshot request.")),
        }
    }
    pub fn recover_snapshot_assets(&self) -> Result<(), JamError> {
        let state = self.lock()?;
        let mut stmt = state.store.connection.prepare("SELECT id FROM snapshots")?;
        let known = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<std::collections::HashSet<_>, _>>()?;
        self.snapshots.assets.recover(&known)
    }
    pub fn next_snapshot_expiry(&self) -> Result<Option<std::time::Duration>, JamError> {
        let state = self.lock()?;
        let oldest: Option<i64> = state.store.connection.query_row(
            "SELECT min(captured_at) FROM snapshots WHERE sent=0",
            [],
            |r| r.get(0),
        )?;
        let days = i64::from(state.store.snapshot_settings()?.retention_days);
        Ok(
            oldest.map(|at| {
                std::time::Duration::from_millis(
                    (at + days * 86_400_000 - timestamp_ms()).max(0) as u64
                )
            }),
        )
    }
    /// One-shot expiry scheduling, startup, capture and explicit cleanup; no idle polling.
    pub fn cleanup_snapshots(&self, now: i64, all: bool) -> Result<usize, JamError> {
        let state = self.lock()?;
        let cutoff = now - i64::from(state.store.snapshot_settings()?.retention_days) * 86_400_000;
        let mut stmt = state
            .store
            .connection
            .prepare("SELECT id FROM snapshots WHERE sent=0 AND (?1 OR captured_at <= ?2)")?;
        let ids = stmt
            .query_map(params![all, cutoff], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for id in &ids {
            self.snapshots.assets.delete(id)?;
            state
                .store
                .connection
                .execute("DELETE FROM snapshots WHERE id=?1", [id])?;
        }
        Ok(ids.len())
    }
}
