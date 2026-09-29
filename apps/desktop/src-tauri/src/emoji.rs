//! The operating system's emoji picker: the Windows emoji panel (Win + .) or
//! the macOS Character Viewer. The client focuses a field first; the picker
//! types the chosen emoji into it, so JAM never ships its own emoji list.

#[tauri::command]
pub fn open_emoji_picker(window: tauri::WebviewWindow) {
    // The picker types into the focused window.
    let _ = window.set_focus();
    platform::open();
}

#[cfg(windows)]
#[allow(unsafe_code)]
mod platform {
    #[link(name = "user32")]
    unsafe extern "system" {
        fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
    }
    const VK_LWIN: u8 = 0x5B;
    const VK_OEM_PERIOD: u8 = 0xBE;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    /// Windows has no API for the emoji panel; its shortcut is the supported
    /// way to open it.
    pub fn open() {
        // SAFETY: `keybd_event` takes plain integers and only queues input.
        unsafe {
            keybd_event(VK_LWIN, 0, 0, 0);
            keybd_event(VK_OEM_PERIOD, 0, 0, 0);
            keybd_event(VK_OEM_PERIOD, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod platform {
    unsafe extern "C" {
        fn jam_open_character_palette();
    }
    pub fn open() {
        // SAFETY: takes no arguments; dispatches to the main thread itself.
        unsafe { jam_open_character_palette() }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    pub fn open() {}
}
