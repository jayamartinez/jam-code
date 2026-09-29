//! The native folder chooser: the Windows folder picker or the macOS open
//! panel, attached to JAM's window. The shared client reaches it only through
//! `DesktopServices.pickDirectory`; it returns the chosen folder's path, which
//! the runtime then checks before it becomes a project.

use jam_runtime::JamError;

#[tauri::command]
pub async fn pick_directory(window: tauri::WebviewWindow) -> Result<Option<String>, JamError> {
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title("Open a project folder")
        .set_parent(&window)
        .pick_folder()
        .await
    else {
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
