//! The native folder chooser: the Windows folder picker or the macOS open
//! panel, attached to JAM's window. The shared client reaches it only through
//! `DesktopServices.pickDirectory`; it returns the chosen folder's path, which
//! the runtime then checks before it becomes a project.

use jam_runtime::JamError;

/// `start` opens the chooser in that folder, to swap a project folder for a
/// nearby one. A folder that no longer exists is ignored. The window is a
/// `Window` so the chooser also opens while a Browser pane's webview exists.
#[tauri::command]
pub async fn pick_directory(
    window: tauri::Window,
    start: Option<String>,
) -> Result<Option<String>, JamError> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Open a project folder")
        .set_parent(&window);
    if let Some(start) = start
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_dir())
    {
        dialog = dialog.set_directory(start);
    }
    let Some(folder) = dialog.pick_folder().await else {
        return Ok(None);
    };
    folder
        .path()
        .to_str()
        .map(|path| Some(path.to_string()))
        .ok_or_else(|| {
            JamError::invalid("JAM Code can't use that folder because its name isn't valid text.")
        })
}
