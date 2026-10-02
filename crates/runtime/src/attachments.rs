//! Files the reader attaches to a chat.
//!
//! An attachment is a file outside the project that the reader chose in the
//! operating system's own file chooser. That is a different grant from a
//! project file: it covers that one file, once. So the runtime copies it
//! into its own `attachments` folder at that moment, gives the copy an
//! opaque ID, and never reads the original again or records where it was.
//! Everything after that — staging, sending, the transcript, the provider —
//! is about the copy.
//!
//! Delivery is the same for every agent, present and future: the copy's path
//! goes into the turn's text, and the agent opens it with its own tools. That
//! needs nothing from a provider's protocol, so any file can be attached. An
//! adapter may additionally send what its provider takes natively; today
//! that is images. JAM never parses, converts or truncates a file.
//!
//! Lifetime follows ownership. A staged copy sits in the store's root and is
//! temporary: it is removed with its chip, when it is older than the
//! retention limit, and at the next start (staged context is client state and
//! does not survive one). When it is sent it moves into its conversation's
//! own folder, the only folder that conversation's agent is pointed at, and
//! is removed only when that conversation is deleted.
use crate::{
    JamError, Runtime,
    asset_dir::{AssetDir, asset_uuid},
    commands::{parse, validate_id},
    protocol::{AttachmentInfo, AttachmentKind, ContextItem, ContextKind, ContextSource},
    runtime::new_id,
    snapshots::timestamp_ms,
    storage::Store,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::Read,
    path::{Path, PathBuf},
};

/// Limits shared with the client through one fixture, so the two cannot
/// accept different things.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentLimits {
    /// Files one use of the chooser may attach.
    pub files_per_pick: usize,
    /// Largest image sent natively; a larger one is attached as a file.
    pub image_bytes: usize,
    /// Largest file, and so the most that is ever read from a chosen file.
    pub file_bytes: usize,
    /// Most natively sent image bytes in one Send.
    pub turn_image_bytes: usize,
    /// Most attachment bytes in one Send.
    pub turn_bytes: usize,
    /// Longest displayed file name.
    pub name_utf16: usize,
    /// Most attachments waiting to be sent at once.
    pub unsent_files: usize,
    /// How long an unsent attachment is kept.
    pub unsent_hours: i64,
}

/// How much of a text attachment its preview shows.
const TEXT_PREVIEW_BYTES: usize = 256 * 1024;

pub fn limits() -> &'static AttachmentLimits {
    static LIMITS: std::sync::OnceLock<AttachmentLimits> = std::sync::OnceLock::new();
    LIMITS.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/attachment-limits.json"
        ))
        .expect("the attachment limits fixture is valid")
    })
}

/// The stored record. The reader's original path is deliberately not in it.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Attachment {
    pub id: String,
    pub name: String,
    pub media_type: String,
    pub kind: AttachmentKind,
    /// The file's size; the copy is byte for byte the same.
    pub bytes: u64,
    /// The copy's extension, so an agent or a provider that opens it sees its type.
    pub extension: String,
    pub created_at: i64,
    pub sent: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
}

impl Attachment {
    fn file_name(&self) -> String {
        format!("{}.{}", self.id, self.extension)
    }
    /// How the attachment appears in staged context and in the transcript.
    pub fn context(&self) -> ContextItem {
        ContextItem {
            id: self.id.clone(),
            kind: ContextKind::Attachment,
            label: self.name.clone(),
            source: ContextSource {
                resource_id: None,
                uri: None,
                selection: None,
            },
            asset_id: Some(self.id.clone()),
            attachment: Some(AttachmentInfo {
                name: self.name.clone(),
                media_type: self.media_type.clone(),
                kind: self.kind,
                bytes: self.bytes,
            }),
        }
    }
}

/// An attachment as a provider adapter sees it: JAM's copy, by path.
#[derive(Clone, Debug)]
pub struct AttachedFile {
    pub name: String,
    pub media_type: String,
    pub path: PathBuf,
}

pub struct AttachmentStore {
    /// Staged copies live here; each conversation's sent copies in a folder.
    dir: AssetDir,
}

impl AttachmentStore {
    pub fn new(parent: &Path) -> Self {
        Self {
            dir: AssetDir::new(parent.join("attachments"), "attachment"),
        }
    }

    /// The folder holding what one conversation sent. A conversation ID is an
    /// opaque identifier, and anything that is not one names no folder.
    fn conversation(&self, resource_id: &str) -> Result<AssetDir, JamError> {
        self.dir.folder(resource_id)
    }

    /// That folder, for the agent to read from, once something is in it.
    pub(crate) fn conversation_dir(&self, resource_id: &str) -> Option<PathBuf> {
        let folder = self.conversation(resource_id).ok()?;
        folder.exists().then(|| folder.root().to_path_buf())
    }

    /// Where the copy is now: its conversation's folder once sent, else the
    /// root. A send that was interrupted between the two is found either way.
    fn home(&self, attachment: &Attachment) -> Result<AssetDir, JamError> {
        if let Some(resource_id) = &attachment.resource_id {
            let folder = self.conversation(resource_id)?;
            if folder.has(&attachment.file_name()) {
                return Ok(folder);
            }
        }
        Ok(self.dir.clone())
    }

    pub(crate) fn read(&self, attachment: &Attachment) -> Result<Vec<u8>, JamError> {
        self.home(attachment)?
            .read(&attachment.file_name(), attachment.bytes as usize)
    }

    /// The type the interface may render the whole copy as: a raster image or
    /// a PDF, by its first bytes.
    fn viewable_type(&self, attachment: &Attachment) -> Result<Option<&'static str>, JamError> {
        let head = self
            .home(attachment)?
            .read_prefix(&attachment.file_name(), 16)?;
        Ok(image_type(&head)
            .map(|(media_type, _)| media_type)
            .or_else(|| head.starts_with(b"%PDF-").then_some("application/pdf")))
    }

    /// The start of the copy as text, when it is text: UTF-8 without a NUL.
    /// The second value says whether the file continues past what is shown.
    fn text_preview(&self, attachment: &Attachment) -> Result<Option<(String, bool)>, JamError> {
        let head = self
            .home(attachment)?
            .read_prefix(&attachment.file_name(), TEXT_PREVIEW_BYTES)?;
        let truncated = attachment.bytes > head.len() as u64;
        let text = match std::str::from_utf8(&head) {
            Ok(text) => text,
            // A character cut in half by the limit is not a sign of binary.
            Err(error) if truncated && error.error_len().is_none() => {
                std::str::from_utf8(&head[..error.valid_up_to()]).unwrap_or_default()
            }
            Err(_) => return Ok(None),
        };
        Ok((!text.contains('\0')).then(|| (text.to_owned(), truncated)))
    }

    /// The copy's folder and file name, to show it in the file manager.
    fn location(&self, attachment: &Attachment) -> Result<(PathBuf, String), JamError> {
        let home = self.home(attachment)?;
        Ok((home.root().to_path_buf(), attachment.file_name()))
    }

    pub(crate) fn path(&self, attachment: &Attachment) -> Result<PathBuf, JamError> {
        self.home(attachment)?.path(&attachment.file_name())
    }

    /// Removes the copy wherever it is, and its folder when that was the last.
    pub(crate) fn remove(&self, attachment: &Attachment) -> Result<(), JamError> {
        self.dir.remove(&attachment.file_name())?;
        if let Some(resource_id) = &attachment.resource_id {
            let folder = self.conversation(resource_id)?;
            if folder.exists() {
                folder.remove(&attachment.file_name())?;
                folder.remove_if_empty();
            }
        }
        Ok(())
    }

    /// Moves staged copies into their conversation's folder as they are sent.
    /// All of them move or none do.
    pub(crate) fn claim(&self, attachments: &[Attachment]) -> Result<(), JamError> {
        for (index, attachment) in attachments.iter().enumerate() {
            let moved = attachment
                .resource_id
                .as_deref()
                .ok_or_else(|| JamError::invalid("An attachment has no conversation."))
                .and_then(|resource_id| self.conversation(resource_id))
                .and_then(|folder| self.dir.move_to(&attachment.file_name(), &folder));
            if let Err(error) = moved {
                self.release(&attachments[..index]);
                return Err(error);
            }
        }
        Ok(())
    }

    /// Undoes `claim` when the Send it was for did not happen.
    pub(crate) fn release(&self, attachments: &[Attachment]) {
        for attachment in attachments {
            let Some(folder) = attachment
                .resource_id
                .as_deref()
                .and_then(|resource_id| self.conversation(resource_id).ok())
            else {
                continue;
            };
            if folder.has(&attachment.file_name()) {
                let _ = folder.move_to(&attachment.file_name(), &self.dir);
            }
            folder.remove_if_empty();
        }
    }
}

/// PNG, JPEG, GIF or WebP by content, never by the name a file was given.
fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

/// The extension a copy keeps: the chosen file's own when it is a short,
/// plain one, since that is how an agent's tools tell a PDF from a log.
fn file_extension(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .filter(|extension| {
            (1..=10).contains(&extension.len())
                && extension.chars().all(|c| c.is_ascii_alphanumeric())
        })
        .unwrap_or_else(|| "bin".into())
}

/// A display type for common extensions. It is a label, not a promise: the
/// agent reads the file itself.
fn media_type(extension: &str) -> &'static str {
    match extension {
        "pdf" => "application/pdf",
        "json" => "application/json",
        "zip" => "application/zip",
        "csv" => "text/csv",
        "md" | "markdown" => "text/markdown",
        "html" | "htm" => "text/html",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/yaml",
        "txt" | "log" | "text" => "text/plain",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// What a chosen file is: an image JAM can also send natively, or a file.
fn classify(bytes: &[u8], name: &str) -> (AttachmentKind, &'static str, String) {
    match image_type(bytes) {
        // A larger image is still attached, as a file the agent can open.
        Some((media_type, extension)) if bytes.len() <= limits().image_bytes => {
            (AttachmentKind::Image, media_type, extension.into())
        }
        Some((media_type, extension)) => (AttachmentKind::File, media_type, extension.into()),
        None => {
            let extension = file_extension(name);
            (AttachmentKind::File, media_type(&extension), extension)
        }
    }
}

/// "512 KB", "25 MB": limits in the words an error uses.
fn size_label(bytes: usize) -> String {
    if bytes >= 1024 * 1024 {
        format!("{} MB", bytes / (1024 * 1024))
    } else {
        format!("{} KB", bytes / 1024)
    }
}

/// A file name safe to display and to put in a prompt: the last path
/// component only, without control or bidirectional-override characters,
/// and bounded while keeping its extension.
pub fn display_name(path: &Path) -> String {
    let raw = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let clean: String = raw
        .chars()
        .filter(|c| {
            !c.is_control()
                && !matches!(c, '/' | '\\')
                && !matches!(*c as u32, 0x200e | 0x200f | 0x202a..=0x202e | 0x2066..=0x2069)
        })
        .collect();
    let clean = clean.trim().trim_matches('.').trim();
    if clean.is_empty() {
        return "attachment".into();
    }
    let limit = limits().name_utf16;
    if clean.encode_utf16().count() <= limit {
        return clean.to_owned();
    }
    // Keep a short extension; cut the stem.
    let (stem, extension) = match clean.rsplit_once('.') {
        Some((stem, extension)) if extension.encode_utf16().count() <= 12 => {
            (stem, format!(".{extension}"))
        }
        _ => (clean, String::new()),
    };
    let room = limit.saturating_sub(extension.encode_utf16().count() + 1);
    let mut units = 0;
    let stem: String = stem
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= room
        })
        .collect();
    format!("{stem}…{extension}")
}

/// Reads a chosen file. A folder, a link, a device or anything else that is
/// not a regular file is refused, and so is a file larger than an attachment
/// may be, before it is read.
fn read_chosen(path: &Path) -> Result<Vec<u8>, JamError> {
    let unreadable = || JamError::new("unavailable", "JAM Code could not read the file.");
    let meta = std::fs::symlink_metadata(path).map_err(|_| unreadable())?;
    if meta.file_type().is_symlink() {
        return Err(JamError::invalid(
            "That is a link. Choose the file it points to.",
        ));
    }
    if meta.is_dir() {
        return Err(JamError::invalid("Folders can't be attached."));
    }
    if !meta.is_file() {
        return Err(JamError::invalid("Only regular files can be attached."));
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options.open(path).map_err(|_| unreadable())?;
    // Checked again on the handle that is read, not only on the name.
    let meta = file.metadata().map_err(|_| unreadable())?;
    if !meta.is_file() {
        return Err(JamError::invalid("Only regular files can be attached."));
    }
    let cap = limits().file_bytes;
    if meta.len() > cap as u64 {
        return Err(too_large());
    }
    let mut data = Vec::new();
    file.take(cap as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|_| unreadable())?;
    within_limits(&data)?;
    Ok(data)
}

fn too_large() -> JamError {
    JamError::invalid(format!(
        "The file is too large. Attachments can be at most {}.",
        size_label(limits().file_bytes)
    ))
}

/// What every attachment's bytes must be, however they arrived.
fn within_limits(bytes: &[u8]) -> Result<(), JamError> {
    if bytes.len() > limits().file_bytes {
        return Err(too_large());
    }
    if bytes.is_empty() {
        return Err(JamError::invalid("The file is empty."));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Id {
    id: String,
}

impl Runtime {
    /// Copies a file the reader chose into JAM's own storage and stages it.
    ///
    /// This is not reachable through `request`: only the desktop host calls
    /// it, with a path the operating system's file chooser returned. A client
    /// can therefore never make the runtime read a path of its choosing.
    pub fn import_attachment(&self, path: &Path) -> Result<ContextItem, JamError> {
        let bytes = read_chosen(path)?;
        self.stage_attachment(display_name(path), &bytes)
    }

    /// Stages bytes the reader pasted into a chat: a copied image or file.
    ///
    /// Like `import_attachment`, only the desktop host calls this. It reads
    /// nothing from disk: the bytes are the paste itself, and `name` is only
    /// what the attachment is called.
    pub fn import_pasted_attachment(
        &self,
        name: &str,
        bytes: &[u8],
    ) -> Result<ContextItem, JamError> {
        within_limits(bytes)?;
        self.stage_attachment(display_name(Path::new(name)), bytes)
    }

    fn stage_attachment(&self, name: String, bytes: &[u8]) -> Result<ContextItem, JamError> {
        // The file is classified and copied before the database is locked,
        // so a large file never holds up another request.
        let (kind, media_type, extension) = classify(bytes, &name);
        let attachment = Attachment {
            id: new_id("attachment"),
            name,
            media_type: media_type.into(),
            kind,
            bytes: bytes.len() as u64,
            extension,
            created_at: timestamp_ms(),
            sent: false,
            resource_id: None,
        };
        self.attachments
            .dir
            .create(&attachment.file_name(), bytes)?;
        let recorded = (|| {
            let state = self.lock()?;
            state.store.expire_attachments(&self.attachments)?;
            let waiting: i64 = state.store.connection.query_row(
                "SELECT count(*) FROM attachments WHERE sent=0",
                [],
                |row| row.get(0),
            )?;
            if waiting >= limits().unsent_files as i64 {
                return Err(JamError::new(
                    "unavailable",
                    "Too many attachments are waiting to be sent. Send or remove some first.",
                ));
            }
            state.store.save_attachment(&attachment)
        })();
        // A copy without a record is never left behind.
        if let Err(error) = recorded {
            let _ = self.attachments.remove(&attachment);
            return Err(error);
        }
        Ok(attachment.context())
    }

    pub(crate) fn attachment_request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Value, JamError> {
        let input: Id = parse(params)?;
        validate_id(&input.id)?;
        let state = self.lock()?;
        match method {
            // Removing a staged attachment's chip. One that was sent belongs
            // to its conversation's history and goes only with it.
            "attachment.remove" => {
                let Some(attachment) = state.store.attachment(&input.id)? else {
                    // Already cleaned up: the chip may go either way.
                    return Ok(json!({"accepted": true}));
                };
                if attachment.sent {
                    return Err(JamError::new(
                        "conflict",
                        "A sent attachment belongs to its conversation's history.",
                    ));
                }
                state.store.delete_attachment(&attachment.id)?;
                self.attachments.remove(&attachment)?;
                Ok(json!({"accepted": true}))
            }
            // An image or a PDF, whole, for its preview. Addressed by ID only
            // and decided by content, never by name or by the recorded type:
            // nothing else is ever handed to the interface to render.
            "attachment.asset" => {
                let attachment = state
                    .store
                    .attachment(&input.id)?
                    .ok_or_else(|| JamError::new("not_found", "Attachment not found."))?;
                let Some(media_type) = self.attachments.viewable_type(&attachment)? else {
                    return Err(JamError::invalid(
                        "Only an image or a PDF attachment is shown this way.",
                    ));
                };
                let bytes = self.attachments.read(&attachment)?;
                Ok(json!({
                    "dataUrl": format!("data:{media_type};base64,{}", STANDARD.encode(bytes))
                }))
            }
            // The start of a text attachment, for its preview. Anything that
            // is not text has none; the file manager can still show it.
            "attachment.text" => {
                let attachment = state
                    .store
                    .attachment(&input.id)?
                    .ok_or_else(|| JamError::new("not_found", "Attachment not found."))?;
                match self.attachments.text_preview(&attachment)? {
                    Some((text, truncated)) => Ok(json!({"text": text, "truncated": truncated})),
                    None => Err(JamError::invalid(
                        "This attachment is not text and has no preview here.",
                    )),
                }
            }
            // Shows JAM's own copy in Finder or Explorer, after an explicit
            // click. It selects the file; it never opens or runs it.
            "attachment.reveal" => {
                let attachment = state
                    .store
                    .attachment(&input.id)?
                    .ok_or_else(|| JamError::new("not_found", "Attachment not found."))?;
                let (folder, name) = self.attachments.location(&attachment)?;
                drop(state);
                crate::system_open::reveal(&folder, &name)?;
                Ok(json!({"revealed": true}))
            }
            _ => Err(JamError::new(
                "unknown_method",
                "Unknown attachment request.",
            )),
        }
    }

    /// At start: nothing is staged any more (staged context is client state),
    /// so every unsent attachment goes, and so does any file a crash left
    /// without a record. Files and folders JAM did not name are left alone.
    pub(crate) fn recover_attachments(&self) -> Result<(), JamError> {
        let state = self.lock()?;
        for attachment in state.store.attachments("sent=0", ())? {
            state.store.delete_attachment(&attachment.id)?;
            let _ = self.attachments.remove(&attachment);
        }
        let known: std::collections::HashSet<String> = state
            .store
            .attachments("1=1", ())?
            .iter()
            .map(Attachment::file_name)
            .collect();
        let ours = |name: &str| {
            name.split_once('.')
                .is_some_and(|(id, _)| asset_uuid(id, "attachment").is_some())
        };
        let sweep = |dir: &AssetDir| -> Result<(), JamError> {
            for name in dir.names()? {
                if ours(&name) && !known.contains(&name) {
                    dir.remove(&name)?;
                }
            }
            Ok(())
        };
        sweep(&self.attachments.dir)?;
        for folder in self.attachments.dir.folders()? {
            if let Ok(folder) = self.attachments.dir.folder(&folder) {
                sweep(&folder)?;
                folder.remove_if_empty();
            }
        }
        Ok(())
    }
}

impl Store {
    pub(crate) fn attachment(&self, id: &str) -> Result<Option<Attachment>, JamError> {
        let data: Option<String> = self
            .connection
            .query_row("SELECT data FROM attachments WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()?;
        data.map(|data| serde_json::from_str(&data).map_err(Into::into))
            .transpose()
    }

    pub(crate) fn attachments(
        &self,
        filter: &str,
        values: impl rusqlite::Params,
    ) -> Result<Vec<Attachment>, JamError> {
        let mut statement = self.connection.prepare(&format!(
            "SELECT data FROM attachments WHERE {filter} ORDER BY created_at"
        ))?;
        let rows = statement
            .query_map(values, |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.iter()
            .map(|data| serde_json::from_str(data).map_err(Into::into))
            .collect()
    }

    pub(crate) fn save_attachment(&self, attachment: &Attachment) -> Result<(), JamError> {
        self.connection.execute(
            "INSERT INTO attachments(id,created_at,sent,resource_id,data) VALUES (?1,?2,?3,?4,?5)
             ON CONFLICT(id) DO UPDATE SET sent=excluded.sent,resource_id=excluded.resource_id,data=excluded.data",
            params![
                attachment.id,
                attachment.created_at,
                attachment.sent,
                attachment.resource_id,
                serde_json::to_string(attachment)?
            ],
        )?;
        Ok(())
    }

    pub(crate) fn delete_attachment(&self, id: &str) -> Result<(), JamError> {
        self.connection
            .execute("DELETE FROM attachments WHERE id=?1", [id])?;
        Ok(())
    }

    /// Removes unsent attachments past the retention limit: chips that were
    /// abandoned without being removed. Runs when the next file is attached,
    /// so nothing polls.
    fn expire_attachments(&self, files: &AttachmentStore) -> Result<(), JamError> {
        let cutoff = timestamp_ms() - limits().unsent_hours * 3_600_000;
        for attachment in self.attachments("sent=0 AND created_at<=?1", [cutoff])? {
            self.delete_attachment(&attachment.id)?;
            let _ = files.remove(&attachment);
        }
        Ok(())
    }

    /// Resolves the attachments in a Send against the store: each must be one
    /// this runtime imported and has not sent yet. The client's own copy of
    /// the item is replaced by the stored record, so a name, type or size it
    /// claims is never trusted. With `commit`, they become the conversation's.
    pub(crate) fn send_attachments(
        &self,
        context: &mut [ContextItem],
        resource_id: &str,
        commit: bool,
    ) -> Result<Vec<Attachment>, JamError> {
        let limits = limits();
        let mut sent: Vec<Attachment> = Vec::new();
        for item in context {
            if !matches!(item.kind, ContextKind::Attachment) {
                continue;
            }
            let id = item
                .asset_id
                .as_deref()
                .ok_or_else(|| JamError::invalid("An attachment needs its asset ID."))?;
            let mut attachment = self.attachment(id)?.ok_or_else(|| {
                JamError::invalid(format!(
                    "{} is no longer available. Attach it again.",
                    item.label
                ))
            })?;
            if attachment.sent || sent.iter().any(|other| other.id == attachment.id) {
                return Err(JamError::invalid(format!(
                    "{} was already sent. Attach it again to send it once more.",
                    attachment.name
                )));
            }
            *item = attachment.context();
            attachment.sent = true;
            attachment.resource_id = Some(resource_id.to_owned());
            if commit {
                self.save_attachment(&attachment)?;
            }
            sent.push(attachment);
        }
        let total: u64 = sent.iter().map(|attachment| attachment.bytes).sum();
        let images: u64 = sent
            .iter()
            .filter(|attachment| attachment.kind == AttachmentKind::Image)
            .map(|attachment| attachment.bytes)
            .sum();
        if total > limits.turn_bytes as u64 || images > limits.turn_image_bytes as u64 {
            return Err(JamError::invalid(format!(
                "Attachments in one message can total at most {}, with at most {} of images. Remove some.",
                size_label(limits.turn_bytes),
                size_label(limits.turn_image_bytes)
            )));
        }
        Ok(sent)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_move_into_their_conversations_folder_all_or_none() {
        let root = std::env::temp_dir().join(format!("jam-claim-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store = AttachmentStore::new(&root);
        let staged = |name: &str| {
            let attachment = Attachment {
                id: new_id("attachment"),
                name: name.into(),
                media_type: "text/plain".into(),
                kind: AttachmentKind::File,
                bytes: 4,
                extension: "txt".into(),
                created_at: 0,
                sent: true,
                resource_id: Some("conversation-1".into()),
            };
            store.dir.create(&attachment.file_name(), b"data").unwrap();
            attachment
        };
        let (first, second) = (staged("a.txt"), staged("b.txt"));
        let folder = root.join("attachments").join("conversation-1");

        store.claim(&[first.clone(), second.clone()]).unwrap();
        assert!(
            folder.join(first.file_name()).exists() && folder.join(second.file_name()).exists()
        );
        assert_eq!(store.path(&first).unwrap(), folder.join(first.file_name()));
        assert_eq!(store.read(&second).unwrap(), b"data");
        assert_eq!(
            store.conversation_dir("conversation-1"),
            Some(folder.clone())
        );

        // A Send that did not happen puts them back and leaves no folder.
        store.release(&[first.clone(), second.clone()]);
        assert!(!folder.exists());
        assert_eq!(store.conversation_dir("conversation-1"), None);
        assert_eq!(
            store.path(&first).unwrap(),
            root.join("attachments").join(first.file_name())
        );

        // If one cannot move, none stay moved.
        let missing = Attachment {
            id: new_id("attachment"),
            ..second.clone()
        };
        assert!(store.claim(&[first.clone(), missing]).is_err());
        assert!(!folder.exists());
        assert!(root.join("attachments").join(first.file_name()).exists());

        // A conversation ID that is not a plain identifier names no folder.
        let hostile = Attachment {
            resource_id: Some("../../elsewhere".into()),
            ..first.clone()
        };
        assert!(store.claim(std::slice::from_ref(&hostile)).is_err());
        assert_eq!(store.conversation_dir("../../elsewhere"), None);
        assert!(root.join("attachments").join(first.file_name()).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn images_are_recognized_by_content_not_by_name() {
        assert_eq!(
            image_type(b"\x89PNG\r\n\x1a\nrest"),
            Some(("image/png", "png"))
        );
        assert_eq!(
            image_type(&[0xff, 0xd8, 0xff, 0xe0]),
            Some(("image/jpeg", "jpg"))
        );
        assert_eq!(image_type(b"GIF89a..."), Some(("image/gif", "gif")));
        assert_eq!(
            image_type(b"RIFF\0\0\0\0WEBPVP8 "),
            Some(("image/webp", "webp"))
        );
        assert_eq!(image_type(b"%PDF-1.7"), None);
        assert_eq!(image_type(b"RIFF\0\0\0\0WAVE"), None);
    }

    #[test]
    fn any_file_is_attached_and_only_small_raster_images_are_sent_natively() {
        assert_eq!(
            classify(b"%PDF-1.7", "spec.pdf"),
            (AttachmentKind::File, "application/pdf", "pdf".into())
        );
        assert_eq!(
            classify(b"12 passed", "Test Output.LOG"),
            (AttachmentKind::File, "text/plain", "log".into())
        );
        assert_eq!(
            classify(b"PK\x03\x04", "bundle.zip"),
            (AttachmentKind::File, "application/zip", "zip".into())
        );
        // A PNG is an image whatever it is called, and keeps a `.png` copy.
        assert_eq!(
            classify(b"\x89PNG\r\n\x1a\n", "misnamed.txt"),
            (AttachmentKind::Image, "image/png", "png".into())
        );
        // An SVG is markup, not a raster image: a file, never a native image.
        assert_eq!(classify(b"<svg/>", "logo.svg").0, AttachmentKind::File);
        // An image too large to send natively is still attached, as a file.
        let mut large = b"\x89PNG\r\n\x1a\n".to_vec();
        large.resize(limits().image_bytes + 1, 0);
        assert_eq!(
            classify(&large, "huge.png"),
            (AttachmentKind::File, "image/png", "png".into())
        );
    }

    #[test]
    fn a_copy_keeps_only_a_short_plain_extension() {
        assert_eq!(file_extension("notes.MD"), "md");
        assert_eq!(file_extension("archive.tar.gz"), "gz");
        assert_eq!(file_extension("Makefile"), "bin");
        assert_eq!(file_extension("weird.ex e"), "bin");
        assert_eq!(file_extension("evil.../../x"), "bin");
        assert_eq!(file_extension("long.abcdefghijkl"), "bin");
        assert_eq!(media_type("weird"), "application/octet-stream");
    }

    #[test]
    fn display_names_are_one_bounded_plain_component() {
        let name = |path: &str| display_name(Path::new(path));
        assert_eq!(name("/tmp/café résumé.txt"), "café résumé.txt");
        assert_eq!(name("/tmp/evil\u{202e}gnp.exe"), "evilgnp.exe");
        assert_eq!(name("/tmp/tab\there\n.log"), "tabhere.log");
        assert_eq!(name("/tmp/..."), "attachment");
        let long = format!("/tmp/{}.log", "x".repeat(400));
        let bounded = name(&long);
        assert!(bounded.encode_utf16().count() <= limits().name_utf16);
        assert!(bounded.ends_with("….log"));
        // Only the last component is ever used.
        #[cfg(windows)]
        assert_eq!(name(r"C:\Users\someone\Downloads\error.log"), "error.log");
        assert_eq!(name("/home/someone/secret/dir/error.log"), "error.log");
    }
}
