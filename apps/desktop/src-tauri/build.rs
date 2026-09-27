fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "jam_request",
            "jam_subscribe",
            "jam_unsubscribe",
            "jam_terminal_attach",
            "jam_terminal_detach",
            "browser_attach",
            "browser_bounds",
            "browser_navigate",
            "browser_action",
            "browser_close",
        ]),
    ))
    .expect("could not build the desktop application metadata");
}
