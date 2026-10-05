mod platform;
use crate::{Host, lifecycle};
use jam_runtime::{
    JamError,
    protocol::Request,
    snapshots::{AfterCapture, Shortcut, timestamp_ms},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

static APP: OnceLock<AppHandle> = OnceLock::new();
/// What the Settings page shows. `message` is empty while everything works;
/// it explains only a problem the user can act on.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `disabled`, `registered`, `needsPermission` or `unavailable`.
    state: String,
    message: String,
    latest_id: Option<String>,
    /// The one macOS permission Snapshots needs. JAM never listens to key
    /// events, so Input Monitoring is never involved.
    screen_recording: bool,
}
pub struct SnapshotHost {
    status: Mutex<Status>,
    capturing: AtomicBool,
    retention: std::sync::Arc<tokio::sync::Notify>,
}
impl Default for SnapshotHost {
    fn default() -> Self {
        Self {
            status: Mutex::new(Status {
                state: "disabled".into(),
                message: String::new(),
                latest_id: None,
                screen_recording: false,
            }),
            capturing: AtomicBool::new(false),
            retention: Default::default(),
        }
    }
}
fn changed(app: &AppHandle) {
    app.state::<SnapshotHost>().retention.notify_one();
    let _ = app.emit_to("main", "snapshots-changed", ());
    let _ = app.emit_to("snapshot-toast", "snapshots-changed", ());
}
fn status(app: &AppHandle, state: &str, message: &str) {
    if let Ok(mut status) = app.state::<SnapshotHost>().status.lock() {
        status.state = state.into();
        status.message = message.into();
    }
    changed(app);
}
/// Both Shift keys or a key combination: the shortcut itself is the trigger.
extern "C" fn trigger() {
    if let Some(app) = APP.get() {
        capture(app);
    }
}
/// Carbon key code and modifier mask for one of the offered key combinations.
fn hotkey(accelerator: &str) -> Option<(u32, u32)> {
    let mut modifiers = 0;
    let mut key = None;
    for part in accelerator.split('+') {
        match part {
            "Command" => modifiers |= 1 << 8,
            "Shift" => modifiers |= 1 << 9,
            "Option" => modifiers |= 1 << 11,
            "Control" => modifiers |= 1 << 12,
            // ANSI digit key codes, kVK_ANSI_0 … kVK_ANSI_9.
            digit => {
                key = Some(match digit {
                    "0" => 29,
                    "1" => 18,
                    "2" => 19,
                    "3" => 20,
                    "4" => 21,
                    "5" => 23,
                    "6" => 22,
                    "7" => 26,
                    "8" => 28,
                    "9" => 25,
                    _ => return None,
                })
            }
        }
    }
    Some((key?, modifiers))
}
/// Starts the one listener the settings ask for, and only when every
/// permission that shortcut needs is granted.
pub fn register(app: &AppHandle) {
    platform::stop();
    let settings = app.state::<Host>().runtime.snapshot_settings();
    let screen = platform::screen_recording();
    if let Ok(mut status) = app.state::<SnapshotHost>().status.lock() {
        status.screen_recording = screen;
    }
    let started = |code: i32, taken: &str| match code {
        0 => ("registered", String::new()),
        3 => (
            "unavailable",
            "Snapshots are not available on this platform yet.".into(),
        ),
        _ => ("unavailable", taken.to_string()),
    };
    let (state, message) = match settings {
        Err(_) => (
            "unavailable",
            "Snapshot settings could not be loaded.".to_string(),
        ),
        Ok(_) if !platform::SUPPORTED => (
            "unavailable",
            "Snapshots are not available on this platform yet.".into(),
        ),
        Ok(s) if !s.enabled => ("disabled", String::new()),
        Ok(_) if !screen => (
            "needsPermission",
            "Snapshots need Screen Recording to capture a window.".into(),
        ),
        Ok(s) => match &s.shortcut {
            Shortcut::BothShift => started(
                platform::start_pair(trigger),
                "macOS could not start the Shift shortcut.",
            ),
            Shortcut::KeyCombination { accelerator } => match hotkey(accelerator) {
                Some((key_code, modifiers)) => started(
                    platform::start_hotkey(key_code, modifiers, trigger),
                    "Another app already uses this shortcut. Choose a different one.",
                ),
                None => ("unavailable", "Choose one of the offered shortcuts.".into()),
            },
        },
    };
    status(app, state, &message);
}
/// Re-checks Screen Recording, for when JAM regains focus after System Settings.
fn refresh(app: &AppHandle) {
    let current = app
        .state::<SnapshotHost>()
        .status
        .lock()
        .ok()
        .map(|s| s.screen_recording);
    if current != Some(platform::screen_recording()) {
        register(app);
    }
}
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    register(app);
    let runtime = app.state::<Host>().runtime.clone();
    let notify = app.state::<SnapshotHost>().retention.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let recovery = runtime.clone();
        let _ =
            tauri::async_runtime::spawn_blocking(move || recovery.recover_snapshot_assets()).await;
        loop {
            let runtime = runtime.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let removed = runtime.cleanup_snapshots(timestamp_ms(), false)?;
                Ok::<_, JamError>((removed, runtime.next_snapshot_expiry()?))
            })
            .await;
            match result {
                Ok(Ok((removed, next))) => {
                    if removed > 0 {
                        let _ = app.emit_to("main", "snapshots-changed", ());
                        let _ = app.emit_to("snapshot-toast", "snapshots-changed", ());
                    }
                    if let Some(delay) = next {
                        tokio::select! { _=tokio::time::sleep(delay)=>{}, _=notify.notified()=>{} }
                    } else {
                        notify.notified().await;
                    }
                }
                // A storage error must not create a tight retry loop.
                _ => notify.notified().await,
            }
        }
    });
}
pub fn stop() {
    platform::stop();
}

fn capture(app: &AppHandle) {
    let host = app.state::<SnapshotHost>();
    if host.capturing.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = app.state::<Host>().runtime.clone();
        let result = (|| {
            let settings = runtime.snapshot_settings()?;
            if !settings.enabled {
                return Err(JamError::new("unavailable", "Snapshots are disabled."));
            }
            let destination = runtime.snapshot_destination()?;
            runtime.cleanup_snapshots(timestamp_ms(), false)?;
            let captured = platform::capture_window()?;
            let frame = captured.bounds;
            let clipboard = if settings.copy_to_clipboard
                || settings.after_capture == AfterCapture::Clipboard
            {
                captured.image.clone()
            } else {
                Vec::new()
            };
            let snapshot = runtime.store_snapshot_for(captured, destination)?;
            Ok((snapshot, settings, clipboard, frame))
        })();
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            handle
                .state::<SnapshotHost>()
                .capturing
                .store(false, Ordering::Release);
            match result {
                Ok((snapshot, settings, image, frame)) => {
                    if let Ok(mut state) = handle.state::<SnapshotHost>().status.lock() {
                        state.latest_id = Some(snapshot.id.clone());
                    }
                    platform::feedback(
                        &image,
                        frame,
                        settings.flash,
                        settings.sound,
                        settings.copy_to_clipboard
                            || settings.after_capture == AfterCapture::Clipboard,
                    );
                    changed(&handle);
                    if settings.toast {
                        show_toast(&handle);
                    }
                }
                Err(error) => {
                    // A revoked permission shows as setup again; anything else
                    // is reported beside a shortcut that still works.
                    register(&handle);
                    if let Ok(mut status) = handle.state::<SnapshotHost>().status.lock()
                        && status.state == "registered"
                    {
                        status.message = error.message;
                    }
                    changed(&handle);
                }
            }
        });
    });
}
fn show_toast(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("snapshot-toast") {
        platform::show_window(&window);
        return;
    }
    let builder = WebviewWindowBuilder::new(
        app,
        "snapshot-toast",
        WebviewUrl::App("index.html#snapshot-toast".into()),
    )
    .title("JAM Code — Snapshot staged")
    .inner_size(400.0, 322.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false);
    if let Ok(window) = builder.build() {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size().to_logical::<f64>(scale);
            let position = monitor.position().to_logical::<f64>(scale);
            let _ = window.set_position(tauri::LogicalPosition::new(
                position.x + size.width - 420.0,
                position.y + 40.0,
            ));
        }
        platform::show_window(&window);
    }
}

#[tauri::command]
pub async fn snapshot_host(
    action: String,
    id: Option<String>,
    app: AppHandle,
) -> Result<Status, JamError> {
    if id.as_ref().is_some_and(|s| s.len() > 128) {
        return Err(JamError::invalid("Invalid snapshot ID."));
    }
    let handle = app.clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            match action.as_str() {
                "status" => refresh(&handle),
                "retry" => register(&handle),
                "requestScreenRecording" => {
                    platform::request_screen_recording();
                    register(&handle);
                }
                "openScreenRecordingSettings" => platform::open_screen_recording_settings(),
                "capture" => capture(&handle),
                "dismiss" => {
                    if let Some(w) = handle.get_webview_window("snapshot-toast") {
                        let _ = w.hide();
                    }
                }
                "open" => {
                    let payload = json!({"id":id});
                    lifecycle::show(&handle);
                    let _ = handle.emit_to("main", "snapshot-open", payload);
                    if let Some(w) = handle.get_webview_window("snapshot-toast") {
                        let _ = w.hide();
                    }
                }
                _ => return Err(JamError::invalid("Unknown snapshot host action.")),
            }
            handle
                .state::<SnapshotHost>()
                .status
                .lock()
                .map(|s| s.clone())
                .map_err(|_| JamError::new("internal", "Snapshot status unavailable."))
        })();
        let _ = tx.send(result);
    })
    .map_err(|_| JamError::new("unavailable", "Desktop event loop is unavailable."))?;
    rx.await
        .map_err(|_| JamError::new("unavailable", "Desktop event loop stopped."))?
}
/// Toast gets this narrow allowlist, never the main webview's general runtime IPC.
#[tauri::command]
pub async fn snapshot_toast_request(
    request: Value,
    host: State<'_, Host>,
    app: AppHandle,
) -> Result<Value, JamError> {
    let request: Request = serde_json::from_value(request)?;
    if ![
        "snapshot.list",
        "snapshot.asset",
        "snapshot.stage",
        "snapshot.remove",
        "workspace.get",
    ]
    .contains(&request.method.as_str())
    {
        return Err(JamError::invalid(
            "This command is not available from the snapshot toast.",
        ));
    }
    let method = request.method.clone();
    let runtime = host.runtime.clone();
    let result = tauri::async_runtime::spawn_blocking(move || runtime.request(request))
        .await
        .map_err(|_| JamError::new("internal", "Snapshot request failed."))?;
    if result.is_ok() {
        after_request(&app, &method);
    }
    result
}
pub fn after_request(app: &AppHandle, method: &str) {
    if method == "snapshot.settings.update" {
        let app = app.clone();
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || register(&handle));
    }
    if [
        "snapshot.stage",
        "snapshot.remove",
        "snapshot.cleanup",
        "snapshot.settings.update",
        "turn.start",
        // A queued or steered message takes its snapshots out of the inbox,
        // and removing a queued one returns them.
        "turn.steer",
        "queue.add",
        "queue.remove",
        "queue.send",
    ]
    .contains(&method)
    {
        changed(app);
    }
}

#[cfg(test)]
mod tests {
    use super::hotkey;
    use jam_runtime::snapshots::KEY_COMBINATIONS;

    #[test]
    fn every_offered_combination_maps_to_a_hotkey() {
        for accelerator in KEY_COMBINATIONS {
            assert!(hotkey(accelerator).is_some(), "{accelerator}");
        }
        // kVK_ANSI_2 with cmdKey | shiftKey.
        assert_eq!(hotkey("Command+Shift+2"), Some((19, (1 << 8) | (1 << 9))));
        assert_eq!(hotkey("Command+Shift+Q"), None);
        assert_eq!(hotkey("Command+Shift"), None);
    }
}
