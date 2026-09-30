//! Keys macOS would otherwise keep from JAM's page. Menu key equivalents run
//! before a web view sees a key, and AppKit reads ⌘. as "cancel", so JAM's own
//! shortcuts for them (Close tab ⌘W, focus mode ⌘.) never reached the page.
//! Windows has no menu bar and no such key, so nothing here exists there.

use serde::Serialize;
use std::sync::OnceLock;
use tauri::{
    AppHandle, Emitter, Manager, Wry,
    menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
};

const CLOSE_WINDOW: &str = "close-window";

/// The standard app menu without a ⌘W item: ⌘W closes a tab in JAM, and the
/// window closes (hides) with ⇧⌘W, as in tabbed Mac apps. Edit keeps its
/// native items, which the web view needs for copy, paste and undo.
pub fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        CLOSE_WINDOW,
                        "Close Window",
                        true,
                        Some("Cmd+Shift+W"),
                    )?,
                ],
            )?,
        ],
    )
}

pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    if event.id() == CLOSE_WINDOW
        && let Some(window) = app.get_window("main")
    {
        // Closing is intercepted and hides the window; sessions keep running.
        let _ = window.close();
    }
}

/// The modifiers held with a forwarded key, as the page's KeyboardEvent names them.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForwardedKey {
    shift_key: bool,
    ctrl_key: bool,
    alt_key: bool,
}

static APP: OnceLock<AppHandle> = OnceLock::new();

#[allow(unsafe_code)]
unsafe extern "C" {
    fn jam_forward_command_period(callback: extern "C" fn(bool, bool, bool));
}

extern "C" fn emit_command_period(shift_key: bool, ctrl_key: bool, alt_key: bool) {
    if let Some(app) = APP.get() {
        let key = ForwardedKey {
            shift_key,
            ctrl_key,
            alt_key,
        };
        let _ = app.emit_to("main", "command-period", key);
    }
}

/// Sends ⌘. in JAM's window to the page, which handles it as a key press.
#[allow(unsafe_code)]
pub fn forward_command_period(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    // SAFETY: installs one AppKit event monitor on the main thread; the
    // callback only reads the stored handle and emits an event.
    unsafe { jam_forward_command_period(emit_command_period) }
}
