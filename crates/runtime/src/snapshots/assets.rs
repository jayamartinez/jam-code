use crate::JamError;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_IMAGE: usize = 8 * 1024 * 1024;
pub const MAX_THUMBNAIL: usize = 256 * 1024;
pub struct SnapshotAssets {
    root: PathBuf,
}
fn io_error(_: std::io::Error) -> JamError {
    JamError::new("unavailable", "JAM snapshot storage is unavailable.")
}
impl SnapshotAssets {
    pub fn new(parent: &Path) -> Self {
        Self {
            root: parent.join("snapshots"),
        }
    }
    fn root(&self) -> Result<(), JamError> {
        match fs::symlink_metadata(&self.root) {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => Ok(()),
            Ok(_) => Err(JamError::invalid(
                "Snapshot storage must be a JAM-owned directory, not a link.",
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                #[cfg_attr(not(unix), allow(unused_mut))]
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&self.root).map_err(io_error)
            }
            Err(e) => Err(io_error(e)),
        }
    }
    fn path(&self, id: &str, thumbnail: bool) -> Result<PathBuf, JamError> {
        let uuid = id
            .strip_prefix("snapshot-")
            .ok_or_else(|| JamError::invalid("Invalid snapshot ID."))?;
        if uuid::Uuid::parse_str(uuid).is_err() || uuid.len() != 36 {
            return Err(JamError::invalid("Invalid snapshot ID."));
        }
        self.root()?;
        Ok(self
            .root
            .join(format!("{id}{}.jpg", if thumbnail { "-thumb" } else { "" })))
    }
    pub fn write(&self, id: &str, image: &[u8], thumbnail: &[u8]) -> Result<(), JamError> {
        if image.len() > MAX_IMAGE
            || thumbnail.len() > MAX_THUMBNAIL
            || !image.starts_with(&[255, 216, 255])
            || !thumbnail.starts_with(&[255, 216, 255])
        {
            return Err(JamError::invalid("Invalid or oversized snapshot image."));
        }
        let mut created = Vec::new();
        for (is_thumb, bytes) in [(false, image), (true, thumbnail)] {
            let path = self.path(id, is_thumb)?;
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let result = (|| {
                let mut file = options.open(&path)?;
                created.push(path);
                file.write_all(bytes)?;
                file.sync_all()
            })();
            if let Err(e) = result {
                for path in created {
                    let _ = fs::remove_file(path);
                }
                return Err(io_error(e));
            }
        }
        Ok(())
    }
    /// The full image's file, for a provider that reads images from disk.
    /// Only a snapshot the reader explicitly sent is ever passed on.
    pub(crate) fn image_path(&self, id: &str) -> Result<PathBuf, JamError> {
        self.path(id, false)
    }
    pub fn read(&self, id: &str, thumbnail: bool) -> Result<Vec<u8>, JamError> {
        let path = self.path(id, thumbnail)?;
        let meta = fs::symlink_metadata(&path).map_err(io_error)?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(JamError::invalid("Invalid snapshot asset."));
        }
        let limit = if thumbnail { MAX_THUMBNAIL } else { MAX_IMAGE };
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
            .map_err(io_error)?
            .take(limit as u64 + 1)
            .read_to_end(&mut data)
            .map_err(io_error)?;
        if data.len() > limit {
            return Err(JamError::invalid("Snapshot asset exceeds its size limit."));
        }
        Ok(data)
    }
    /// Recover only names produced by this store after a crash between writing
    /// files and committing metadata. Unknown files/directories remain untouched.
    pub(crate) fn recover(
        &self,
        known: &std::collections::HashSet<String>,
    ) -> Result<(), JamError> {
        self.root()?;
        for entry in fs::read_dir(&self.root).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(stem) = name.strip_suffix(".jpg") else {
                continue;
            };
            let id = stem.strip_suffix("-thumb").unwrap_or(stem);
            if self.path(id, false).is_ok() && !known.contains(id) {
                self.delete(id)?;
            }
        }
        Ok(())
    }
    pub fn delete(&self, id: &str) -> Result<(), JamError> {
        for thumbnail in [false, true] {
            let path = self.path(id, thumbnail)?;
            // unlink removes a link itself, never its target. No recursive deletion.
            match fs::remove_file(path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(io_error(e)),
            }
        }
        Ok(())
    }
}
