use crate::{
    JamError,
    protocol::{FileContents, Project},
};
use std::path::{Path, PathBuf};
pub(crate) fn project_folder(project: &Project) -> Result<Option<PathBuf>, JamError> {
    let Some(path) = project.paths.first() else {
        return Ok(None);
    };
    let path = if let Some(suffix) = path.strip_prefix("~/") {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| JamError::new("unavailable", "Home directory is unavailable."))?
            .join(suffix)
    } else {
        PathBuf::from(path)
    };
    let root = path
        .canonicalize()
        .map_err(|_| JamError::new("not_found", "The project's first folder is unavailable."))?;
    if !root.is_dir() {
        return Err(JamError::invalid("The project path must be a directory."));
    }
    Ok(Some(root))
}
/// Reject traversal, platform prefixes and repository metadata.
/// Literal Git pathspec mode also protects valid names like `:(glob)*`.
pub(crate) fn validate_path(path: &str) -> Result<(), JamError> {
    crate::files::validate_path(path)?;
    if path.is_empty()
        || Path::new(path).is_absolute()
        || path.contains('\\')
        || path.split('/').any(|p| p.eq_ignore_ascii_case(".git"))
        || path.as_bytes().get(1) == Some(&b':')
    {
        return Err(JamError::invalid("Unsupported repository-relative path."));
    }
    Ok(())
}

const MAX_FILE_BYTES: usize = 256 * 1024;
/// Bounded read, confined to an existing project directory. Symlinks are
/// rejected, including ancestors, so a repository cannot expose outside files.
pub(crate) fn read_scoped_bytes(
    root: &std::path::Path,
    path: &str,
    limit: usize,
) -> Result<Vec<u8>, JamError> {
    use std::io::Read;
    validate_path(path)?;
    let file = open_scoped(root, path)?;
    if !file
        .metadata()
        .map_err(|_| JamError::new("unavailable", "File metadata unavailable."))?
        .is_file()
    {
        return Err(JamError::invalid("Only regular files can be opened."));
    }
    let mut bytes = vec![];
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| JamError::new("unavailable", "File could not be read."))?;
    Ok(bytes)
}
pub(crate) fn read_native(
    project_id: &str,
    root: &std::path::Path,
    path: &str,
) -> Result<FileContents, JamError> {
    let bytes = read_scoped_bytes(root, path, MAX_FILE_BYTES)?;
    if bytes.contains(&0) {
        return Err(JamError::new(
            "unavailable",
            "Binary files cannot be opened in the text editor.",
        ));
    }
    let truncated = bytes.len() > MAX_FILE_BYTES;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FILE_BYTES)]).into_owned();
    Ok(FileContents {
        project_id: project_id.into(),
        path: path.into(),
        language: crate::files::language_for(path).into(),
        text,
        truncated,
        writable: false,
        status: None,
        demo: false,
    })
}

#[cfg(unix)]
fn open_scoped(root: &Path, path: &str) -> Result<std::fs::File, JamError> {
    use rustix::fs::{Mode, OFlags, open, openat};
    let flags = OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK;
    let unavailable = |_| {
        JamError::new(
            "unavailable",
            "Only regular files inside the project can be opened; symlinks are unsupported.",
        )
    };
    let mut fd = open(root, flags | OFlags::DIRECTORY, Mode::empty()).map_err(unavailable)?;
    let mut parts = path.split('/').peekable();
    while let Some(part) = parts.next() {
        let flags = if parts.peek().is_some() {
            flags | OFlags::DIRECTORY
        } else {
            flags
        };
        fd = openat(&fd, part, flags, Mode::empty()).map_err(unavailable)?;
    }
    Ok(fd.into())
}
#[cfg(not(unix))]
fn open_scoped(root: &Path, path: &str) -> Result<std::fs::File, JamError> {
    let mut target = root.to_path_buf();
    for part in path.split('/') {
        target.push(part);
        let metadata = std::fs::symlink_metadata(&target)
            .map_err(|_| JamError::new("not_found", "File is unavailable."))?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            // Reparse points include junctions as well as symbolic links.
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(JamError::new(
                    "unavailable",
                    "Reparse points are unsupported.",
                ));
            }
        }
        if metadata.file_type().is_symlink() {
            return Err(JamError::new("unavailable", "Symlinks are unsupported."));
        }
    }
    let resolved = target
        .canonicalize()
        .map_err(|_| JamError::new("not_found", "File is unavailable."))?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err(JamError::invalid(
            "Only regular project files can be opened.",
        ));
    }
    std::fs::File::open(resolved)
        .map_err(|_| JamError::new("unavailable", "File could not be opened."))
}
