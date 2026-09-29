//! Typed text arrives as typed. On macOS, WebKit applies the system's smart
//! quotes, dashes and text replacement to every text field, which breaks
//! commands and code written into the composer (a `"` becomes `“`). These
//! defaults are scoped to JAM Code's own preferences and are read by WebKit
//! when a web view is created, so this runs before the window exists.

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
pub fn keep_typed_text() {
    unsafe extern "C" {
        fn jam_disable_text_substitution();
    }
    // SAFETY: takes no arguments and only writes this app's user defaults.
    unsafe { jam_disable_text_substitution() }
}

#[cfg(not(target_os = "macos"))]
pub fn keep_typed_text() {}
