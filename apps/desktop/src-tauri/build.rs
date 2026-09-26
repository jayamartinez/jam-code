fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "jam_request",
            "jam_subscribe",
            "jam_unsubscribe",
        ]),
    ))
    .expect("could not build the desktop application metadata");
}
