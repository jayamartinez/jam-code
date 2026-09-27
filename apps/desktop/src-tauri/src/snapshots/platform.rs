//! The only unsafe Rust in Snapshots: narrow, owned C ABI to Apple's APIs.
//! No provider, storage, destination or Send logic belongs here.
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod mac {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use jam_runtime::{
        JamError,
        snapshots::{CapturedWindow, WindowCaptureBackend},
    };
    use serde::Deserialize;
    use std::{
        collections::HashMap,
        ffi::{CStr, c_char},
        sync::{
            Mutex, OnceLock,
            atomic::{AtomicU64, Ordering},
            mpsc,
        },
        time::Duration,
    };
    type Reply = Result<NativeCapture, JamError>;
    static PENDING: OnceLock<Mutex<HashMap<u64, mpsc::SyncSender<Reply>>>> = OnceLock::new();
    static TOKEN: AtomicU64 = AtomicU64::new(1);
    unsafe extern "C" {
        fn jam_snapshot_show_window(window: *mut std::ffi::c_void);
        fn jam_snapshot_pair_start(callback: extern "C" fn()) -> i32;
        fn jam_snapshot_pair_stop();
        fn jam_snapshot_hotkey_start(
            key_code: u32,
            modifiers: u32,
            callback: extern "C" fn(),
        ) -> i32;
        fn jam_snapshot_hotkey_stop();
        fn jam_snapshot_screen_recording() -> bool;
        fn jam_snapshot_request_screen_recording();
        fn jam_snapshot_open_screen_recording_settings();
        fn jam_snapshot_capture(token: u64, callback: extern "C" fn(u64, *const c_char));
        fn jam_snapshot_feedback(
            bytes: *const u8,
            length: usize,
            flash: bool,
            sound: bool,
            clipboard: bool,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
        );
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Payload {
        image: String,
        thumbnail: String,
        width: u32,
        height: u32,
        application: String,
        window_title: String,
        frame: [f64; 4],
    }
    pub struct NativeCapture {
        pub window: CapturedWindow,
    }
    fn decode(text: &str) -> Reply {
        let value: serde_json::Value = serde_json::from_str(text)?;
        if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
            return Err(JamError::new("unavailable", error));
        }
        let data: Payload = serde_json::from_value(value)?;
        let decode = |s: &str| {
            STANDARD
                .decode(s)
                .map_err(|_| JamError::new("internal", "Invalid native image encoding."))
        };
        Ok(NativeCapture {
            window: CapturedWindow {
                bounds: data.frame,
                image: decode(&data.image)?,
                thumbnail: decode(&data.thumbnail)?,
                width: data.width,
                height: data.height,
                application: data.application,
                window_title: data.window_title,
            },
        })
    }
    extern "C" fn completed(token: u64, json: *const c_char) {
        if json.is_null() {
            return;
        }
        // SAFETY: our ObjC producer passes a live NUL-terminated UTF-8 string
        // for exactly this synchronous callback. Copy/parse before returning.
        let result = unsafe { CStr::from_ptr(json) }
            .to_str()
            .map_err(|_| JamError::new("internal", "Invalid native capture response."))
            .and_then(decode);
        if let Some(sender) = PENDING.get().and_then(|p| p.lock().ok()?.remove(&token)) {
            let _ = sender.try_send(result);
        }
    }
    fn capture() -> Reply {
        let token = TOKEN.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::sync_channel(1);
        PENDING
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| JamError::new("internal", "Capture unavailable."))?
            .insert(token, tx);
        // SAFETY: callback is static, token is a value; native dispatches UI
        // access to the main thread and owns all image/string lifetimes.
        unsafe {
            jam_snapshot_capture(token, completed);
        }
        let result = rx
            .recv_timeout(Duration::from_secs(15))
            .unwrap_or_else(|_| {
                Err(JamError::new(
                    "unavailable",
                    "Window capture timed out. Retry after checking macOS permissions.",
                ))
            });
        if let Ok(mut pending) = PENDING.get().expect("initialized").lock() {
            pending.remove(&token);
        }
        result
    }
    pub fn capture_window() -> Result<CapturedWindow, JamError> {
        MacCaptureBackend.capture_active_window()
    }
    pub struct MacCaptureBackend;
    impl WindowCaptureBackend for MacCaptureBackend {
        fn capture_active_window(&self) -> Result<CapturedWindow, JamError> {
            capture().map(|r| r.window)
        }
    }
    pub fn show_window(window: &tauri::WebviewWindow) {
        if let Ok(pointer) = window.ns_window() {
            // SAFETY: the live Tauri window owns the NSWindow and this function
            // is called only on the main thread. Native code retains no pointer.
            unsafe {
                jam_snapshot_show_window(pointer);
            }
        }
    }
    /// Stops the shortcut listener; exactly one runs at a time. All
    /// lifecycle/feedback callers are Tauri main-thread closures.
    pub fn stop() {
        unsafe {
            jam_snapshot_pair_stop();
            jam_snapshot_hotkey_stop();
        }
    }
    pub fn start_pair(callback: extern "C" fn()) -> i32 {
        unsafe { jam_snapshot_pair_start(callback) }
    }
    /// Carbon key code and modifier mask, from [`super::hotkey`].
    pub fn start_hotkey(key_code: u32, modifiers: u32, callback: extern "C" fn()) -> i32 {
        unsafe { jam_snapshot_hotkey_start(key_code, modifiers, callback) }
    }
    pub fn screen_recording() -> bool {
        unsafe { jam_snapshot_screen_recording() }
    }
    pub fn request_screen_recording() {
        unsafe { jam_snapshot_request_screen_recording() }
    }
    pub fn open_screen_recording_settings() {
        unsafe { jam_snapshot_open_screen_recording_settings() }
    }
    pub fn feedback(image: &[u8], frame: [f64; 4], flash: bool, sound: bool, clipboard: bool) {
        // SAFETY: bytes remain borrowed for the call; native copies clipboard
        // data synchronously. The delayed flash owns its NSPanel independently.
        unsafe {
            jam_snapshot_feedback(
                image.as_ptr(),
                image.len(),
                flash,
                sound,
                clipboard,
                frame[0],
                frame[1],
                frame[2],
                frame[3],
            );
        }
    }
}
#[cfg(target_os = "macos")]
pub use mac::*;
/// Whether this platform has a capture backend and shortcut listeners.
pub const SUPPORTED: bool = cfg!(target_os = "macos");

#[cfg(not(target_os = "macos"))]
mod unsupported {
    use jam_runtime::{
        JamError,
        snapshots::{CapturedWindow, WindowCaptureBackend},
    };
    /// Windows deliberately reports unavailable until a native backend is implemented.
    pub struct WindowsCaptureBackend;
    impl WindowCaptureBackend for WindowsCaptureBackend {
        fn capture_active_window(&self) -> Result<CapturedWindow, JamError> {
            Err(JamError::new(
                "unavailable",
                "Snapshots are not implemented on this platform yet.",
            ))
        }
    }
    pub fn capture_window() -> Result<CapturedWindow, JamError> {
        WindowsCaptureBackend.capture_active_window()
    }
    pub fn show_window(window: &tauri::WebviewWindow) {
        let _ = window.show();
    }
    pub fn stop() {}
    pub fn start_pair(_: extern "C" fn()) -> i32 {
        3
    }
    pub fn start_hotkey(_: u32, _: u32, _: extern "C" fn()) -> i32 {
        3
    }
    pub fn screen_recording() -> bool {
        false
    }
    pub fn request_screen_recording() {}
    pub fn open_screen_recording_settings() {}
    pub fn feedback(_: &[u8], _: [f64; 4], _: bool, _: bool, _: bool) {}
}
#[cfg(not(target_os = "macos"))]
pub use unsupported::*;
