//! Runtime-owned snapshot metadata, staged destinations, and private assets.
mod assets;
pub mod gesture;
mod requests;
use crate::{
    JamError, Runtime,
    protocol::{ContextItem, ContextKind, ContextSource},
    runtime::new_id,
};
pub use assets::SnapshotAssets;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotSettings {
    pub enabled: bool,
    pub shortcut: Shortcut,
    pub capture_mode: CaptureMode,
    pub after_capture: AfterCapture,
    pub flash: bool,
    pub sound: bool,
    pub toast: bool,
    pub copy_to_clipboard: bool,
    pub retention_days: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Shortcut {
    /// Left and right Shift held together. Read from the modifier state, so
    /// it needs no keyboard permission.
    BothShift,
    /// Two taps of one Shift key. Hearing taps means listening to key events,
    /// which macOS gates behind Input Monitoring.
    DoubleShift,
    /// An ordinary global hotkey from [`KEY_COMBINATIONS`].
    KeyCombination { accelerator: String },
}
/// The key combinations JAM offers. A fixed list: each is free of macOS's own
/// screenshot shortcuts (⌘⇧3/4/5) and needs no permission to register.
pub const KEY_COMBINATIONS: [&str; 3] = ["Command+Shift+2", "Control+Shift+2", "Option+Shift+2"];
impl Shortcut {
    pub fn needs_input_monitoring(&self) -> bool {
        matches!(self, Self::DoubleShift)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CaptureMode {
    ActiveWindow,
    Region,
    FullScreen,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AfterCapture {
    Stage,
    Save,
    Clipboard,
}
impl Default for SnapshotSettings {
    fn default() -> Self {
        // Off until the user turns it on and grants what it needs.
        Self {
            enabled: false,
            shortcut: Shortcut::BothShift,
            capture_mode: CaptureMode::ActiveWindow,
            after_capture: AfterCapture::Stage,
            flash: true,
            sound: true,
            toast: true,
            copy_to_clipboard: false,
            retention_days: 7,
        }
    }
}
impl SnapshotSettings {
    pub fn validate(&self) -> Result<(), JamError> {
        if ![1, 7, 30].contains(&self.retention_days) {
            return Err(JamError::invalid("Choose retention of 1, 7 or 30 days."));
        }
        if self.capture_mode != CaptureMode::ActiveWindow {
            return Err(JamError::new(
                "unavailable",
                "Only Active window capture is implemented.",
            ));
        }
        if let Shortcut::KeyCombination { accelerator } = &self.shortcut
            && !KEY_COMBINATIONS.contains(&accelerator.as_str())
        {
            return Err(JamError::invalid("Choose one of the offered shortcuts."));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub captured_at: i64,
    pub application: String,
    pub window_title: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
    pub resource_id: Option<String>,
    pub note: String,
    pub sent: bool,
    pub context: ContextItem,
}
/// Encoded one-shot output of a platform backend. Never a caller-provided path.
pub struct CapturedWindow {
    pub bounds: [f64; 4],
    pub image: Vec<u8>,
    pub thumbnail: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub application: String,
    pub window_title: String,
}
pub trait WindowCaptureBackend: Send + Sync {
    fn capture_active_window(&self) -> Result<CapturedWindow, JamError>;
}

pub struct SnapshotManager {
    pub(crate) assets: SnapshotAssets,
}
impl SnapshotManager {
    pub fn new(parent: &Path) -> Self {
        Self {
            assets: SnapshotAssets::new(parent),
        }
    }
}
pub fn timestamp_ms() -> i64 {
    (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

/// Snapshot preferences are a product setting, stored beside Appearance.
const SETTINGS_KEY: &str = "snapshots";

impl crate::storage::Store {
    pub(crate) fn snapshot_settings(&self) -> Result<SnapshotSettings, JamError> {
        self.setting(SETTINGS_KEY)?
            .map(|s| serde_json::from_str(&s).map_err(Into::into))
            .unwrap_or_else(|| Ok(SnapshotSettings::default()))
    }
    pub(crate) fn save_snapshot_settings(
        &self,
        settings: &SnapshotSettings,
    ) -> Result<(), JamError> {
        self.save_setting(
            SETTINGS_KEY,
            &serde_json::to_string(settings)?,
            &crate::runtime::now(),
        )
    }
    pub(crate) fn snapshot(&self, id: &str) -> Result<Snapshot, JamError> {
        let data: Option<String> = self
            .connection
            .query_row("SELECT data FROM snapshots WHERE id=?1", [id], |r| r.get(0))
            .optional()?;
        serde_json::from_str(
            &data.ok_or_else(|| JamError::new("not_found", "Snapshot not found."))?,
        )
        .map_err(Into::into)
    }
    pub(crate) fn save_snapshot(&self, snapshot: &Snapshot) -> Result<(), JamError> {
        self.connection.execute("INSERT INTO snapshots(id,captured_at,sent,data) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET sent=excluded.sent,data=excluded.data",params![snapshot.id,snapshot.captured_at,snapshot.sent,serde_json::to_string(snapshot)?])?;
        Ok(())
    }
    pub(crate) fn attach_snapshots(
        &self,
        context: &mut [ContextItem],
        resource_id: &str,
        attach: bool,
    ) -> Result<(), JamError> {
        for item in context {
            if !matches!(item.kind, ContextKind::Snapshot) {
                continue;
            }
            let mut snapshot = self.snapshot(
                item.asset_id
                    .as_deref()
                    .ok_or_else(|| JamError::invalid("Snapshot asset is required."))?,
            )?;
            if snapshot.sent || snapshot.resource_id.as_deref() != Some(resource_id) {
                return Err(JamError::invalid(
                    "Snapshot is not staged in this conversation.",
                ));
            }
            *item = snapshot.context.clone();
            snapshot.sent = true;
            if attach {
                self.save_snapshot(&snapshot)?;
            }
        }
        Ok(())
    }
}
impl Runtime {
    pub fn snapshot_settings(&self) -> Result<SnapshotSettings, JamError> {
        self.lock()?.store.snapshot_settings()
    }
    /// Called only by the host after a deliberate capture. It cannot start a turn.
    pub fn snapshot_destination(&self) -> Result<Option<String>, JamError> {
        let state = self.lock()?;
        let settings = state.store.snapshot_settings()?;
        let last: Option<String> = state
            .store
            .connection
            .query_row(
                "SELECT value FROM metadata WHERE key='snapshot_last_conversation'",
                [],
                |r| r.get(0),
            )
            .optional()?;
        let resource_id = last.filter(|id| {
            settings.after_capture == AfterCapture::Stage
                && state
                    .store
                    .resource(id)
                    .is_ok_and(|r| r.kind == "conversation" && r.session_id.is_some())
        });
        Ok(resource_id)
    }
    pub fn store_snapshot(&self, capture: CapturedWindow) -> Result<Snapshot, JamError> {
        let destination = self.snapshot_destination()?;
        self.store_snapshot_for(capture, destination)
    }
    pub fn store_snapshot_for(
        &self,
        capture: CapturedWindow,
        resource_id: Option<String>,
    ) -> Result<Snapshot, JamError> {
        if capture.width == 0
            || capture.height == 0
            || capture.width > 4096
            || capture.height > 4096
        {
            return Err(JamError::invalid("Invalid capture dimensions."));
        }
        let state = self.lock()?;
        let settings = state.store.snapshot_settings()?;
        if !settings.enabled {
            return Err(JamError::new("unavailable", "Snapshots are disabled."));
        }
        let count: i64 = state.store.connection.query_row(
            "SELECT count(*) FROM snapshots WHERE sent=0",
            [],
            |r| r.get(0),
        )?;
        if count >= 500 {
            return Err(JamError::new(
                "unavailable",
                "Snapshot storage is full. Clear temporary snapshots in Settings.",
            ));
        }
        let id = new_id("snapshot");
        let application: String = capture.application.chars().take(128).collect();
        let title: String = capture.window_title.chars().take(256).collect();
        let context = ContextItem {
            id: id.clone(),
            kind: ContextKind::Snapshot,
            label: format!("Snapshot · {application}"),
            source: ContextSource {
                resource_id: None,
                uri: None,
                selection: None,
            },
            asset_id: Some(id.clone()),
        };
        let record = Snapshot {
            id: id.clone(),
            captured_at: timestamp_ms(),
            application,
            window_title: title,
            width: capture.width,
            height: capture.height,
            bytes: capture.image.len() + capture.thumbnail.len(),
            resource_id,
            note: String::new(),
            sent: false,
            context,
        };
        self.snapshots
            .assets
            .write(&id, &capture.image, &capture.thumbnail)?;
        if let Err(e) = state.store.save_snapshot(&record) {
            let _ = self.snapshots.assets.delete(&id);
            return Err(e);
        }
        Ok(record)
    }
}
