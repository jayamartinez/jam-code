//! A JAM-owned directory of binary assets in the application-data folder.
//!
//! Snapshots and chat attachments both keep files here. Everything that
//! makes that safe lives in one place: the directory is created private and
//! must be a real directory, never a link; files are addressed by names the
//! store builds from an opaque `<prefix>-<uuid>` ID, never by a caller's
//! path; a file is created only if it does not exist; and a read never
//! follows a link and never returns more than its limit.
use crate::JamError;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
};

#[derive(Clone)]
pub(crate) struct AssetDir {
    root: PathBuf,
    /// What the directory holds, for messages: "snapshot" or "attachment".
    label: &'static str,
}

/// The UUID of an opaque asset ID of the form `<prefix>-<uuid>`.
pub(crate) fn asset_uuid<'a>(id: &'a str, prefix: &str) -> Option<&'a str> {
    let uuid = id.strip_prefix(prefix)?.strip_prefix('-')?;
    (uuid.len() == 36 && uuid::Uuid::parse_str(uuid).is_ok()).then_some(uuid)
}

impl AssetDir {
    pub fn new(root: PathBuf, label: &'static str) -> Self {
        Self { root, label }
    }

    fn unavailable(&self) -> JamError {
        JamError::new(
            "unavailable",
            format!("JAM {} storage is unavailable.", self.label),
        )
    }

    fn ensure(&self) -> Result<(), JamError> {
        match fs::symlink_metadata(&self.root) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(()),
            Ok(_) => Err(JamError::invalid(format!(
                "{} storage must be a JAM-owned directory, not a link.",
                capitalized(self.label)
            ))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                #[cfg_attr(not(unix), allow(unused_mut))]
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&self.root).map_err(|_| self.unavailable())
            }
            Err(_) => Err(self.unavailable()),
        }
    }

    /// A private folder inside this one, for assets that belong together
    /// (one conversation's attachments). Its name is a plain identifier, never
    /// a path. Nothing is created until a file is put in it.
    pub fn folder(&self, name: &str) -> Result<AssetDir, JamError> {
        let plain = !name.is_empty()
            && name.len() <= 128
            && name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'));
        if !plain {
            return Err(JamError::invalid(format!("Invalid {} folder.", self.label)));
        }
        self.ensure()?;
        Ok(AssetDir::new(self.root.join(name), self.label))
    }

    /// Whether the directory exists as a real directory.
    pub fn exists(&self) -> bool {
        fs::symlink_metadata(&self.root)
            .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
    }

    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    /// Whether a regular file of this name is here. Does not create anything.
    pub fn has(&self, name: &str) -> bool {
        !name.contains(['/', '\\', ':'])
            && !name.contains("..")
            && fs::symlink_metadata(self.root.join(name)).is_ok_and(|meta| meta.is_file())
    }

    /// Moves a file into another folder of the same store, never over a file
    /// that is already there.
    pub fn move_to(&self, name: &str, target: &AssetDir) -> Result<(), JamError> {
        let from = self.path(name)?;
        let to = target.path(name)?;
        if fs::symlink_metadata(&to).is_ok() {
            return Err(self.unavailable());
        }
        fs::rename(from, to).map_err(|_| self.unavailable())
    }

    /// Removes the directory itself when nothing is left in it. Never recursive.
    pub fn remove_if_empty(&self) {
        let _ = fs::remove_dir(&self.root);
    }

    /// The names of the folders in the directory.
    pub fn folders(&self) -> Result<Vec<String>, JamError> {
        self.ensure()?;
        let mut names = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| self.unavailable())? {
            let entry = entry.map_err(|_| self.unavailable())?;
            let real = entry
                .file_type()
                .is_ok_and(|kind| kind.is_dir() && !kind.is_symlink());
            if let (true, Some(name)) = (real, entry.file_name().to_str()) {
                names.push(name.to_owned());
            }
        }
        Ok(names)
    }

    /// The file for a name the store itself built. Names with a path
    /// separator or a parent reference are refused, whoever built them.
    pub fn path(&self, name: &str) -> Result<PathBuf, JamError> {
        if name.is_empty() || name.contains(['/', '\\', ':']) || name.contains("..") {
            return Err(JamError::invalid(format!("Invalid {} asset.", self.label)));
        }
        self.ensure()?;
        Ok(self.root.join(name))
    }

    /// Writes a new file. An existing file of that name is never replaced.
    pub fn create(&self, name: &str, bytes: &[u8]) -> Result<(), JamError> {
        let path = self.path(name)?;
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        // A name that is taken fails here, before anything of ours exists.
        let mut file = options.open(&path).map_err(|_| self.unavailable())?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| {
                // Only the partial file this call created is cleaned up.
                drop(file);
                let _ = fs::remove_file(&path);
                self.unavailable()
            })
    }

    /// Reads a regular file of at most `limit` bytes without following a link.
    pub fn read(&self, name: &str, limit: usize) -> Result<Vec<u8>, JamError> {
        let path = self.path(name)?;
        let meta = fs::symlink_metadata(&path).map_err(|_| self.unavailable())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(JamError::invalid(format!("Invalid {} asset.", self.label)));
        }
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let mut data = Vec::new();
        options
            .open(path)
            .map_err(|_| self.unavailable())?
            .take(limit as u64 + 1)
            .read_to_end(&mut data)
            .map_err(|_| self.unavailable())?;
        if data.len() > limit {
            return Err(JamError::invalid(format!(
                "{} asset exceeds its size limit.",
                capitalized(self.label)
            )));
        }
        Ok(data)
    }

    /// Reads at most the first `limit` bytes of a regular file, for a preview
    /// of something larger. Never follows a link.
    pub fn read_prefix(&self, name: &str, limit: usize) -> Result<Vec<u8>, JamError> {
        let path = self.path(name)?;
        let meta = fs::symlink_metadata(&path).map_err(|_| self.unavailable())?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(JamError::invalid(format!("Invalid {} asset.", self.label)));
        }
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let mut data = Vec::new();
        options
            .open(path)
            .map_err(|_| self.unavailable())?
            .take(limit as u64)
            .read_to_end(&mut data)
            .map_err(|_| self.unavailable())?;
        Ok(data)
    }

    /// Removes one file. `unlink` removes a link itself, never its target,
    /// and nothing is ever removed recursively. A missing file is fine.
    pub fn remove(&self, name: &str) -> Result<(), JamError> {
        match fs::remove_file(self.path(name)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(self.unavailable()),
        }
    }

    /// The names of the files in the directory, for recovery after a crash
    /// between writing a file and committing its record.
    pub fn names(&self) -> Result<Vec<String>, JamError> {
        self.ensure()?;
        let mut names = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|_| self.unavailable())? {
            let entry = entry.map_err(|_| self.unavailable())?;
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_owned());
            }
        }
        Ok(names)
    }
}

fn capitalized(label: &str) -> String {
    let mut letters = label.chars();
    letters
        .next()
        .map(|first| first.to_uppercase().collect::<String>() + letters.as_str())
        .unwrap_or_default()
}
