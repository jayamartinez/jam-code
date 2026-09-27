use jam_runtime::{
    Runtime,
    protocol::Request,
    snapshots::{CapturedWindow, SnapshotAssets, SnapshotSettings, timestamp_ms},
};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};
struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("jam-snapshot-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&p).unwrap();
        Self(p)
    }
    fn open(&self) -> Arc<Runtime> {
        Runtime::open_demo(self.0.join("test.sqlite")).unwrap()
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn req(r: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, jam_runtime::JamError> {
    r.request(Request {
        protocol_version: 1,
        method: method.into(),
        params,
    })
}
// Asset-store tests use a tiny opaque JPEG-shaped payload; no platform capture is simulated.
fn capture() -> CapturedWindow {
    CapturedWindow {
        bounds: [0.0; 4],
        image: vec![255, 216, 255, 217],
        thumbnail: vec![255, 216, 255, 217],
        width: 640,
        height: 480,
        application: "Harmless test app".into(),
        window_title: "Test window".into(),
    }
}
#[test]
fn captures_persist_as_context_without_messages_and_no_agent_uses_inbox() {
    let s = Sandbox::new();
    let r = s.open();
    let before = req(
        &r,
        "conversation.get",
        json!({"resourceId":"conv-pane-lifetime"}),
    )
    .unwrap();
    let inbox = r.store_snapshot(capture()).unwrap();
    assert!(inbox.resource_id.is_none());
    assert_eq!(inbox.context.asset_id.as_deref(), Some(inbox.id.as_str()));
    assert_eq!(inbox.context.label, "Snapshot · Harmless test app");
    assert_eq!((inbox.width, inbox.height), (640, 480));
    assert!(inbox.captured_at > 0);
    req(
        &r,
        "snapshot.focus",
        json!({"resourceId":"conv-pane-lifetime"}),
    )
    .unwrap();
    assert!(req(&r, "snapshot.focus", json!({"resourceId":"does-not-exist"})).is_err());
    let staged = r.store_snapshot(capture()).unwrap();
    assert_eq!(staged.resource_id.as_deref(), Some("conv-pane-lifetime"));
    assert_eq!(
        before["messages"],
        req(
            &r,
            "conversation.get",
            json!({"resourceId":"conv-pane-lifetime"})
        )
        .unwrap()["messages"]
    );
    drop(r);
    let reopened = s.open();
    assert_eq!(
        req(&reopened, "snapshot.list", json!({})).unwrap()["snapshots"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        reopened.snapshot_destination().unwrap().as_deref(),
        Some("conv-pane-lifetime")
    );
}
#[tokio::test]
async fn explicit_send_is_atomic_deduplicated_and_retained() {
    let s = Sandbox::new();
    let r = s.open();
    req(
        &r,
        "snapshot.focus",
        json!({"resourceId":"conv-pane-lifetime"}),
    )
    .unwrap();
    let snapshot = r.store_snapshot(capture()).unwrap();
    let updated = req(
        &r,
        "snapshot.stage",
        json!({"id":snapshot.id,"resourceId":"conv-pane-lifetime","note":"Inspect the toolbar"}),
    )
    .unwrap();
    let mut forged = updated["context"].clone();
    forged["label"] = json!("untrusted client label");
    let turn = json!({"resourceId":"conv-pane-lifetime","text":"","context":[forged],"requestId":"snapshot-send-1"});
    let receipt = req(&r, "turn.start", turn.clone()).unwrap();
    assert_eq!(receipt, req(&r, "turn.start", turn).unwrap());
    assert_eq!(
        r.cleanup_snapshots(timestamp_ms() + 31 * 86_400_000, false)
            .unwrap(),
        0
    );
    assert!(
        req(&r, "snapshot.list", json!({})).unwrap()["snapshots"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let conversation = req(
        &r,
        "conversation.get",
        json!({"resourceId":"conv-pane-lifetime"}),
    )
    .unwrap();
    let users: Vec<_> = conversation["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["blocks"][0]["items"][0]["assetId"] == snapshot.id)
        .collect();
    assert_eq!(users.len(), 1);
    assert_eq!(
        users[0]["blocks"][0]["items"][0]["label"],
        snapshot.context.label
    );
    assert_eq!(
        users[0]["blocks"][0]["items"][0]["source"]["selection"],
        "Inspect the toolbar"
    );
    assert!(req(&r, "snapshot.remove", json!({"id":snapshot.id})).is_err());
    r.shutdown().await.unwrap();
}
#[test]
fn retention_disabled_settings_and_safe_paths() {
    let s = Sandbox::new();
    let r = s.open();
    let snapshot = r.store_snapshot(capture()).unwrap();
    assert_eq!(
        r.cleanup_snapshots(snapshot.captured_at + 7 * 86_400_000 - 1, false)
            .unwrap(),
        0
    );
    assert_eq!(
        r.cleanup_snapshots(snapshot.captured_at + 7 * 86_400_000, false)
            .unwrap(),
        1
    );
    assert!(
        !s.0.join("snapshots")
            .join(format!("{}.jpg", snapshot.id))
            .exists()
    );
    let mut settings = SnapshotSettings {
        enabled: false,
        ..Default::default()
    };
    req(
        &r,
        "snapshot.settings.update",
        serde_json::to_value(&settings).unwrap(),
    )
    .unwrap();
    assert!(r.store_snapshot(capture()).is_err());
    settings.retention_days = 0;
    assert!(
        req(
            &r,
            "snapshot.settings.update",
            serde_json::to_value(&settings).unwrap()
        )
        .is_err()
    );
    let assets = SnapshotAssets::new(&s.0);
    let outside = s.0.join("keep.txt");
    std::fs::write(&outside, b"untouched").unwrap();
    assert!(assets.delete("../../keep.txt").is_err());
    assert_eq!(std::fs::read(&outside).unwrap(), b"untouched");
}
#[cfg(unix)]
#[test]
fn links_are_not_followed_and_files_are_private() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let s = Sandbox::new();
    let r = s.open();
    let record = r.store_snapshot(capture()).unwrap();
    let image = s.0.join("snapshots").join(format!("{}.jpg", record.id));
    assert_eq!(
        std::fs::metadata(&image).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let outside = s.0.join("outside.jpg");
    std::fs::write(&outside, b"private outside file").unwrap();
    std::fs::remove_file(&image).unwrap();
    symlink(&outside, &image).unwrap();
    assert!(
        req(
            &r,
            "snapshot.asset",
            json!({"id":record.id,"thumbnail":false})
        )
        .is_err()
    );
    req(&r, "snapshot.remove", json!({"id":record.id})).unwrap();
    assert_eq!(std::fs::read(&outside).unwrap(), b"private outside file");
    std::fs::remove_dir(s.0.join("snapshots")).unwrap();
    symlink(&s.0, s.0.join("snapshots")).unwrap();
    assert!(r.store_snapshot(capture()).is_err());
}
#[test]
fn destinations_notes_and_clear_are_explicit() {
    let s = Sandbox::new();
    let r = s.open();
    let snapshot = r.store_snapshot(capture()).unwrap();
    assert!(
        req(
            &r,
            "snapshot.stage",
            json!({"id":snapshot.id,"resourceId":"unknown","note":""})
        )
        .is_err()
    );
    assert!(
        req(
            &r,
            "snapshot.stage",
            json!({"id":snapshot.id,"resourceId":null,"note":"x".repeat(2001)})
        )
        .is_err()
    );
    let staged = req(
        &r,
        "snapshot.stage",
        json!({"id":snapshot.id,"resourceId":"conv-pane-lifetime","note":"Optional note"}),
    )
    .unwrap();
    assert_eq!(staged["context"]["source"]["selection"], "Optional note");
    let removed = req(
        &r,
        "snapshot.stage",
        json!({"id":snapshot.id,"resourceId":null,"note":""}),
    )
    .unwrap();
    assert!(removed["resourceId"].is_null());
    assert_eq!(
        req(&r, "snapshot.cleanup", json!({"all":true})).unwrap()["removed"],
        1
    );
}

#[test]
fn crash_orphans_are_recovered_without_touching_unknown_files() {
    let s = Sandbox::new();
    let r = s.open();
    let keep = r.store_snapshot(capture()).unwrap();
    let orphan = format!("snapshot-{}", uuid::Uuid::new_v4());
    let assets = SnapshotAssets::new(&s.0);
    assets
        .write(&orphan, &[255, 216, 255, 217], &[255, 216, 255, 217])
        .unwrap();
    let unknown = s.0.join("snapshots/notes.txt");
    std::fs::write(&unknown, b"keep").unwrap();
    r.recover_snapshot_assets().unwrap();
    assert!(assets.read(&keep.id, false).is_ok());
    assert!(assets.read(&orphan, false).is_err());
    assert!(unknown.exists());
    // A collision never deletes an existing asset.
    assert!(
        assets
            .write(&keep.id, &[255, 216, 255, 217], &[255, 216, 255, 217])
            .is_err()
    );
    assert!(assets.read(&keep.id, false).is_ok());
}
