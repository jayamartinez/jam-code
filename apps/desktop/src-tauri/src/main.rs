#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod browser;
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
            bridge::jam_unsubscribe,
            browser::browser_attach,
            browser::browser_bounds,
            browser::browser_navigate,
            browser::browser_action,
            browser::browser_close
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let runtime = Runtime::open_demo(data_dir.join("jam-demo.sqlite"))?;
            app.manage(browser::BrowserHost::default());
            app.manage(Host {
                runtime,
                quitting: AtomicBool::new(false),
                can_exit: AtomicBool::new(false),
            });
            let config = tauri::utils::config::WindowConfig {
                label: "main".into(),
                url: WebviewUrl::default(),
                title: "jam — local workspace".into(),
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
            // centred the lights at ~15pt; JAM's 44pt titlebar row is centred
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
            #[cfg(not(windows))]
            let _ = window;
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
