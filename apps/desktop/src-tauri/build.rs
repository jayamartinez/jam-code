fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let mut build = cc::Build::new();
        build
            .file("src/snapshots/macos.m")
            .flag("-fobjc-arc")
            .flag("-fblocks");
        // `@available` compiles to ___isPlatformVersionAtLeast when the
        // deployment target predates the checked version (release bundles
        // target an older macOS than the build machine). That symbol lives in
        // clang's runtime, which Rust's -nodefaultlibs link leaves out.
        let resources = build
            .get_compiler()
            .to_command()
            .arg("--print-resource-dir")
            .output()
            .expect("the C compiler reports its resource directory");
        let resources = String::from_utf8_lossy(&resources.stdout);
        println!(
            "cargo:rustc-link-search=native={}/lib/darwin",
            resources.trim()
        );
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
        build.compile("jam_snapshots");
        for framework in ["AppKit", "ScreenCaptureKit", "ImageIO", "CoreGraphics"] {
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
