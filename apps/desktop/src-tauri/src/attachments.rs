//! The native file chooser for chat attachments: the Windows file dialog or
//! the macOS open panel, attached to JAM's window.
//!
//! The chooser is the grant. The interface asks for it and gets back staged
//! attachments by opaque ID; it never names a path, and no path is returned
//! to it. Each chosen file goes straight from the operating system's dialog
//! to the runtime, which copies it into JAM's own storage or refuses it.

use crate::Host;
use jam_runtime::{JamError, attachments::limits, protocol::ContextItem};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
pub struct Refused {
    /// The file's name only, for the message that says why.
    name: String,
    reason: String,
}

#[derive(Serialize)]
pub struct Attached {
    attached: Vec<ContextItem>,
    refused: Vec<Refused>,
}

/// `room` is how many more context items the composer can stage. A cancelled
/// chooser attaches nothing and is not an error.
#[tauri::command]
pub async fn attach_files(
    window: tauri::WebviewWindow,
    host: State<'_, Host>,
    room: usize,
) -> Result<Attached, JamError> {
    let chosen = rfd::AsyncFileDialog::new()
        .set_title("Attach files")
        .set_parent(&window)
        .pick_files()
        .await
        .unwrap_or_default();
    let room = room.min(limits().files_per_pick);
    let runtime = host.runtime.clone();
    // Reading and copying files is blocking work.
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = Attached {
            attached: Vec::new(),
            refused: Vec::new(),
        };
        for file in chosen {
            let path = file.path();
            let refuse = |reason: String| Refused {
                name: jam_runtime::attachments::display_name(path),
                reason,
            };
            if result.attached.len() >= room {
                result.refused.push(refuse(
                    "There is no room for more context in this message.".into(),
                ));
                continue;
            }
            match runtime.import_attachment(path) {
                Ok(item) => result.attached.push(item),
                Err(error) => result.refused.push(refuse(error.message)),
            }
        }
        result
    })
    .await
    .map_err(|_| JamError::new("internal", "JAM Code could not attach the files."))
}
