//! The native file chooser for chat attachments: the Windows file dialog or
//! the macOS open panel, attached to JAM's window.
//!
//! The chooser is the grant. The interface asks for it and gets back staged
//! attachments by opaque ID; it never names a path, and no path is returned
//! to it. Each chosen file goes straight from the operating system's dialog
//! to the runtime, which copies it into JAM's own storage or refuses it.
//!
//! A paste is the other way in: the reader put the bytes on the clipboard
//! and pasted them into a chat, so the interface hands over those bytes and
//! nothing is read from disk.

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
///
/// The window is taken as a `Window`: a `WebviewWindow` exists only while the
/// window has one webview, and an open Browser pane is a second one.
#[tauri::command]
pub async fn attach_files(
    window: tauri::Window,
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

/// The header that names a pasted file, percent-encoded.
const NAME_HEADER: &str = "x-jam-name";

/// Stages what the reader pasted into a chat: the request's body is the
/// file's bytes, sent raw rather than as JSON, and no path is involved. The
/// runtime applies the same limits as to a chosen file.
#[tauri::command]
pub async fn attach_pasted(
    request: tauri::ipc::Request<'_>,
    host: State<'_, Host>,
) -> Result<ContextItem, JamError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(JamError::invalid("A pasted file is sent as bytes."));
    };
    if bytes.len() > limits().file_bytes {
        return Err(JamError::invalid("The file is too large to attach."));
    }
    let name = request
        .headers()
        .get(NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(percent_decode)
        .unwrap_or_default();
    let (runtime, bytes) = (host.runtime.clone(), bytes.clone());
    tauri::async_runtime::spawn_blocking(move || runtime.import_pasted_attachment(&name, &bytes))
        .await
        .map_err(|_| JamError::new("internal", "JAM Code could not attach the file."))?
}

/// `%XX` escapes back to text; anything malformed is kept as it was written.
/// The runtime cleans and bounds the name before it is shown or stored.
fn percent_decode(text: &str) -> String {
    let raw = text.as_bytes();
    let mut bytes = Vec::with_capacity(raw.len());
    let mut at = 0;
    while at < raw.len() {
        let escaped = (raw[at] == b'%')
            .then(|| raw.get(at + 1..at + 3))
            .flatten()
            .and_then(|hex| std::str::from_utf8(hex).ok())
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                bytes.push(byte);
                at += 3;
            }
            None => {
                bytes.push(raw[at]);
                at += 1;
            }
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn pasted_names_are_decoded_and_malformed_escapes_kept() {
        assert_eq!(percent_decode("caf%C3%A9%20menu.png"), "café menu.png");
        assert_eq!(percent_decode("100%.txt"), "100%.txt");
        assert_eq!(percent_decode("a%zzb%4"), "a%zzb%4");
    }
}
