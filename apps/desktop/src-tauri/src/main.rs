#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod lifecycle;

use jam_runtime::Runtime;
use std::sync::{Arc, atomic::AtomicBool};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) struct Host {
    runtime: Arc<Runtime>,
    quitting: AtomicBool,
    can_exit: AtomicBool,
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            lifecycle::show(app)
        }))
        .invoke_handler(tauri::generate_handler![
            bridge::jam_request,
            bridge::jam_subscribe,
            bridge::jam_unsubscribe
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let runtime = Runtime::open_demo(data_dir.join("jam-demo.sqlite"))?;
            app.manage(Host {
                runtime,
                quitting: AtomicBool::new(false),
                can_exit: AtomicBool::new(false),
            });
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("jam — local workspace")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .decorations(false);
            #[cfg(target_os = "macos")]
            let window = window
                .decorations(true)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
            window.build()?;
            // Startup fails visibly if the reopen path cannot be created; never hide an unreachable app.
            lifecycle::install_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("Unable to hide JAM window: {error}");
                }
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window.state::<Host>().runtime.detach_clients();
            }
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started
                && let Some(host) = webview.try_state::<Host>()
            {
                let _ = host.runtime.detach_clients();
            }
        })
        .build(tauri::generate_context!())
        .expect("JAM could not initialize its desktop host");
    app.run(lifecycle::on_run_event);
}
