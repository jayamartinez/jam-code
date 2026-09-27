fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("src/snapshots/macos.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("jam_snapshots");
        for framework in [
            "AppKit",
            "ScreenCaptureKit",
            "ImageIO",
            "CoreGraphics",
            "Carbon",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rerun-if-changed=src/snapshots/macos.m");
    }

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
            "snapshot_host",
            "snapshot_toast_request",
        ]),
    ))
    .expect("could not build the desktop application metadata");
}
