mod platform;
use crate::{Host, lifecycle};
use jam_runtime::{
    JamError,
    protocol::Request,
    snapshots::{
        AfterCapture, Shortcut,
        gesture::{DoubleShift, GestureEvent},
        timestamp_ms,
    },
};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

static APP: OnceLock<AppHandle> = OnceLock::new();
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    state: String,
    message: String,
    latest_id: Option<String>,
}
pub struct SnapshotHost {
    status: Mutex<Status>,
    gesture: Mutex<DoubleShift>,
    capturing: AtomicBool,
    retention: std::sync::Arc<tokio::sync::Notify>,
}
impl Default for SnapshotHost {
    fn default() -> Self {
        Self {
            status: Mutex::new(Status {
                state: "unavailable".into(),
                message: "Snapshot shortcut is starting.".into(),
                latest_id: None,
            }),
            gesture: Mutex::new(DoubleShift::default()),
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
extern "C" fn key(kind: i32, ms: u64) {
    let Some(app) = APP.get() else {
        return;
    };
    let host = app.state::<SnapshotHost>();
    let Ok(mut gesture) = host.gesture.lock() else {
        return;
    };
    if ms == 0 {
        gesture.reset();
        return;
    }
    let event = match kind {
        1 => GestureEvent::ShiftDown,
        2 => GestureEvent::ShiftUp,
        _ => GestureEvent::Other,
    };
    let trigger = gesture.event(event, ms);
    drop(gesture);
    if trigger {
        capture(app);
    }
}
pub fn register(app: &AppHandle) {
    platform::stop();
    if let Ok(mut gesture) = app.state::<SnapshotHost>().gesture.lock() {
        gesture.reset();
    }
    let settings = app.state::<Host>().runtime.snapshot_settings();
    match settings {
        Ok(s) if !s.enabled => status(app, "disabled", "Snapshots are disabled."),
        Ok(s) if s.shortcut != Shortcut::DoubleShift => {
            status(app, "unavailable", "This shortcut type is not implemented.")
        }
        Ok(_) => match platform::start(key) {
            0 => status(
                app,
                "registered",
                "Shift Shift is active. App-local shortcuts (including JetBrains Search Everywhere) may also fire; macOS cannot enumerate those conflicts.",
            ),
            1 => status(
                app,
                "unavailable",
                "Allow Input Monitoring for JAM in System Settings, then click Retry shortcut.",
            ),
            3 => status(
                app,
                "unavailable",
                "Snapshots are not implemented on this platform yet.",
            ),
            _ => status(
                app,
                "unavailable",
                "macOS could not register the passive shortcut listener. Check Input Monitoring, then retry.",
            ),
        },
        Err(_) => status(app, "unavailable", "Snapshot settings could not be loaded."),
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
                Err(error) => status(&handle, "unavailable", &error.message),
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
    .title("jam — Snapshot staged")
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
                "status" => {}
                "retry" => register(&handle),
                "permissions" => {
                    platform::permissions();
                    register(&handle);
                }
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
    ]
    .contains(&method)
    {
        changed(app);
    }
}
