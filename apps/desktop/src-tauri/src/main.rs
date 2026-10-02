#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_webview;
mod attachments;
mod attention;
mod bridge;
mod browser;
mod feedback;
mod folders;
mod lifecycle;
#[cfg(target_os = "macos")]
mod mac_keys;
mod snapshots;
mod text_input;

use jam_runtime::Runtime;
use std::sync::{Arc, atomic::AtomicBool};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) struct Host {
    runtime: Arc<Runtime>,
    quitting: AtomicBool,
    can_exit: AtomicBool,
}

fn main() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(mac_keys::menu)
        .on_menu_event(mac_keys::on_menu_event);
    let app = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            lifecycle::show(app)
        }))
        .invoke_handler(tauri::generate_handler![
            bridge::jam_request,
            bridge::jam_subscribe,
            bridge::jam_unsubscribe,
            bridge::jam_terminal_attach,
            bridge::jam_terminal_detach,
            browser::browser_attach,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_action,
            browser::browser_close,
            snapshots::snapshot_host,
            snapshots::snapshot_toast_request,
            folders::pick_directory,
            attachments::attach_files,
            attachments::attach_pasted,
            feedback::open_feedback,
            attention::set_attention_badge,
            attention::notify
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            // `JAM_DEMO=1` opens a separate demo database with sample
            // projects and the demo provider, for development and
            // demonstrations. It never touches the user's history.
            let runtime = if std::env::var_os("JAM_DEMO").is_some_and(|value| value == "1") {
                let demo_dir = data_dir.join("demo");
                std::fs::create_dir_all(&demo_dir)?;
                Runtime::open_demo(demo_dir.join("demo.sqlite"))?
            } else {
                Runtime::open_user_data(&data_dir)?
            };
            text_input::keep_typed_text();
            #[cfg(target_os = "macos")]
            mac_keys::forward_command_period(app.handle());
            app.manage(browser::BrowserHost::default());
            app.manage(snapshots::SnapshotHost::default());
            app.manage(Host {
                runtime,
                quitting: AtomicBool::new(false),
                can_exit: AtomicBool::new(false),
            });
            let config = tauri::utils::config::WindowConfig {
                label: "main".into(),
                url: WebviewUrl::default(),
                title: "JAM Code".into(),
                width: 1440.0,
                height: 900.0,
                min_width: Some(960.0),
                min_height: Some(640.0),
                decorations: false,
                ..Default::default()
            };
            // macOS keeps its real traffic lights over JAM's custom titlebar.
            // `traffic_light_position.y` is not "distance from the top": the
            // titlebar container becomes `button height + y` and the buttons
            // keep their own offset inside it. Measured on screen, y = 16
            // centered the lights at ~15pt; JAM's 44pt titlebar row is centered
            // at 22pt, so y = 23 aligns them with the tab row and the sidebar
            // header controls. x = 18 is the design's left inset.
            //
            // It must be set on the window, which is why the window is built
            // from a config: Browser needs Tauri's multi-webview support, and
            // with it every webview (JAM's own too) is a child view, which
            // ignores the builder's per-webview `traffic_light_position`.
            #[cfg(target_os = "macos")]
            let config = tauri::utils::config::WindowConfig {
                decorations: true,
                title_bar_style: tauri::TitleBarStyle::Overlay,
                hidden_title: true,
                traffic_light_position: Some(tauri::utils::config::LogicalPosition {
                    x: 18.0,
                    y: 23.0,
                }),
                ..config
            };
            let window = WebviewWindowBuilder::from_config(app, &config)?.build()?;
            // For the same reason Windows no longer attaches its edge-resize
            // handler to the undecorated window at creation; re-asserting
            // resizability attaches it. Not yet verified on Windows.
            #[cfg(windows)]
            window.set_resizable(true)?;
            app_webview::make_app_like(&window)?;
            // Startup fails visibly if the reopen path cannot be created; never hide an unreachable app.
            lifecycle::install_tray(app)?;
            snapshots::install(app.handle());
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
            // This hook sees every webview, including Browser pages; only the
            // JAM interface reloading detaches its clients.
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Started
                && let Some(host) = webview.try_state::<Host>()
            {
                let _ = host.runtime.detach_clients();
                browser::detach_all(webview.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("JAM could not initialize its desktop host");
    app.run(lifecycle::on_run_event);
}
