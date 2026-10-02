use crate::{
    JamError,
    asset_dir::{AssetDir, asset_uuid},
};
use std::path::{Path, PathBuf};

pub const MAX_IMAGE: usize = 8 * 1024 * 1024;
pub const MAX_THUMBNAIL: usize = 256 * 1024;
const JPEG: [u8; 3] = [255, 216, 255];

/// Snapshot images and thumbnails, in the shared owned-directory store.
pub struct SnapshotAssets {
    dir: AssetDir,
}
impl SnapshotAssets {
    pub fn new(parent: &Path) -> Self {
        Self {
            dir: AssetDir::new(parent.join("snapshots"), "snapshot"),
        }
    }
    fn name(id: &str, thumbnail: bool) -> Result<String, JamError> {
        asset_uuid(id, "snapshot").ok_or_else(|| JamError::invalid("Invalid snapshot ID."))?;
        Ok(format!("{id}{}.jpg", if thumbnail { "-thumb" } else { "" }))
    }
    pub fn write(&self, id: &str, image: &[u8], thumbnail: &[u8]) -> Result<(), JamError> {
        if image.len() > MAX_IMAGE
            || thumbnail.len() > MAX_THUMBNAIL
            || !image.starts_with(&JPEG)
            || !thumbnail.starts_with(&JPEG)
        {
            return Err(JamError::invalid("Invalid or oversized snapshot image."));
        }
        let (full, thumb) = (Self::name(id, false)?, Self::name(id, true)?);
        self.dir.create(&full, image)?;
        self.dir.create(&thumb, thumbnail).inspect_err(|_| {
            let _ = self.dir.remove(&full);
        })
    }
    /// The full image's file, for a provider that reads images from disk.
    /// Only a snapshot the reader explicitly sent is ever passed on.
    pub(crate) fn image_path(&self, id: &str) -> Result<PathBuf, JamError> {
        self.dir.path(&Self::name(id, false)?)
    }
    pub fn read(&self, id: &str, thumbnail: bool) -> Result<Vec<u8>, JamError> {
        let limit = if thumbnail { MAX_THUMBNAIL } else { MAX_IMAGE };
        self.dir.read(&Self::name(id, thumbnail)?, limit)
    }
    /// Recover only names produced by this store after a crash between writing
    /// files and committing metadata. Unknown files/directories remain untouched.
    pub(crate) fn recover(
        &self,
        known: &std::collections::HashSet<String>,
    ) -> Result<(), JamError> {
        for name in self.dir.names()? {
            let Some(stem) = name.strip_suffix(".jpg") else {
                continue;
            };
            let id = stem.strip_suffix("-thumb").unwrap_or(stem);
            if asset_uuid(id, "snapshot").is_some() && !known.contains(id) {
                self.delete(id)?;
            }
        }
        Ok(())
    }
    pub fn delete(&self, id: &str) -> Result<(), JamError> {
        for thumbnail in [false, true] {
            self.dir.remove(&Self::name(id, thumbnail)?)?;
        }
        Ok(())
    }
}
