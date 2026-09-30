use crate::Host;
use std::sync::atomic::Ordering;
use tauri::{
    App, AppHandle, Manager, RunEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub fn show(app: &AppHandle) {
    // `get_webview_window` stops finding "main" once Browser views are added
    // to it as child webviews, so the window is looked up directly.
    if let Some(window) = app.get_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit(app: &AppHandle) {
    let host = app.state::<Host>();
    if host.quitting.swap(true, Ordering::AcqRel) {
        return;
    }
    crate::snapshots::stop();
    let runtime = std::sync::Arc::clone(&host.runtime);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = runtime.shutdown().await {
            eprintln!("Runtime shutdown: {error}");
        }
        app.state::<Host>().can_exit.store(true, Ordering::Release);
        app.exit(0);
    });
}

/// The tray's own icon, without a badge.
pub fn tray_image() -> tauri::Result<tauri::image::Image<'static>> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))
}

pub fn install_tray(app: &App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show jam", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit jam", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    TrayIconBuilder::with_id("jam")
        .icon(tray_image()?)
        .tooltip("JAM Code")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    match event {
        RunEvent::ExitRequested { api, .. }
            if !app.state::<Host>().can_exit.load(Ordering::Acquire) =>
        {
            api.prevent_exit();
            quit(app);
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show(app),
        _ => {}
    }
}
