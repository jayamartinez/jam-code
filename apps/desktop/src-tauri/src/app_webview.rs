//! JAM's own interface is an app, not a web page: the WebView's browser
//! shortcuts (Ctrl+F find, F12 and Ctrl+Shift+I devtools, Ctrl+R reload,
//! Ctrl+P print, zoom, the link status bar, swipe back) are turned off for it.
//! Keys JAM handles itself still reach the page; editing keys stay native.
//! Browser pages keep their defaults. WKWebView binds none of these on macOS.

#[cfg(windows)]
#[allow(unsafe_code)]
pub fn make_app_like(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings6,
    };
    use windows_core::Interface;

    window.with_webview(|webview| {
        // SAFETY: the controller belongs to this live webview and these calls
        // run on its UI thread, which `with_webview` guarantees.
        let applied = unsafe {
            (|| -> windows_core::Result<()> {
                let settings = webview.controller().CoreWebView2()?.Settings()?;
                settings.SetIsZoomControlEnabled(false)?;
                settings.SetIsStatusBarEnabled(false)?;
                settings
                    .cast::<ICoreWebView2Settings3>()?
                    .SetAreBrowserAcceleratorKeysEnabled(false)?;
                settings
                    .cast::<ICoreWebView2Settings6>()?
                    .SetIsSwipeNavigationEnabled(false)?;
                Ok(())
            })()
        };
        if let Err(error) = applied {
            eprintln!("Unable to turn off browser shortcuts: {error}");
        }
    })
}

#[cfg(not(windows))]
pub fn make_app_like(_window: &tauri::WebviewWindow) -> tauri::Result<()> {
    Ok(())
}
