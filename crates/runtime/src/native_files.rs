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
    let root = canonical(&path)
        .map_err(|_| JamError::new("not_found", "The project's first folder is unavailable."))?;
    if !root.is_dir() {
        return Err(JamError::invalid("The project path must be a directory."));
    }
    Ok(Some(root))
}

/// `canonicalize`, without the verbatim `\\?\` prefix Windows adds when the
/// ordinary path names the same file. Providers, Git and Explorer report and
/// expect ordinary paths, and the prefix must not reach the interface.
pub(crate) fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    path.canonicalize().map(simplified)
}

#[cfg(windows)]
fn simplified(path: PathBuf) -> PathBuf {
    use std::path::{Component, Prefix};
    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path;
    };
    let ordinary = match prefix.kind() {
        Prefix::VerbatimDisk(drive) => format!("{}:", drive as char),
        Prefix::VerbatimUNC(server, share) => match (server.to_str(), share.to_str()) {
            (Some(server), Some(share)) => format!(r"\\{server}\{share}"),
            _ => return path,
        },
        _ => return path,
    };
    let rest = components.as_path();
    // Win32 path parsing would reinterpret these, so they stay verbatim.
    let reinterpreted = rest.components().any(|component| {
        let std::path::Component::Normal(name) = component else {
            return false;
        };
        let Some(name) = name.to_str() else {
            return true;
        };
        let stem = name
            .split('.')
            .next()
            .unwrap_or(name)
            .trim_end()
            .to_ascii_uppercase();
        name.ends_with(['.', ' '])
            || matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && stem.as_bytes()[3].is_ascii_digit())
    });
    let Some(rest) = rest.to_str() else {
        return path;
    };
    let candidate = format!("{ordinary}{rest}");
    if reinterpreted || candidate.len() >= 260 {
        return path;
    }
    PathBuf::from(candidate)
}

#[cfg(not(windows))]
fn simplified(path: PathBuf) -> PathBuf {
    path
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

/// The absolute path of a regular file inside the project folder, checked
/// the same way reads are.
pub(crate) fn scoped_file(root: &Path, path: &str) -> Result<PathBuf, JamError> {
    validate_path(path)?;
    let file = open_scoped(root, path)?;
    if !file.metadata().is_ok_and(|metadata| metadata.is_file()) {
        return Err(JamError::invalid("Only regular files can be shown."));
    }
    Ok(root.join(path))
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
    let resolved =
        canonical(&target).map_err(|_| JamError::new("not_found", "File is unavailable."))?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err(JamError::invalid(
            "Only regular project files can be opened.",
        ));
    }
    std::fs::File::open(resolved)
        .map_err(|_| JamError::new("unavailable", "File could not be opened."))
}

#[cfg(all(test, windows))]
mod tests {
    use super::simplified;
    use std::path::PathBuf;

    #[test]
    fn verbatim_prefixes_are_dropped_only_when_equivalent() {
        let plain = |s: &str| simplified(PathBuf::from(s));
        assert_eq!(
            plain(r"\\?\C:\Users\a b\café"),
            PathBuf::from(r"C:\Users\a b\café")
        );
        assert_eq!(
            plain(r"\\?\UNC\server\share\dir"),
            PathBuf::from(r"\\server\share\dir")
        );
        assert_eq!(plain(r"C:\already"), PathBuf::from(r"C:\already"));
        for kept in [
            r"\\?\C:\dir\con",
            r"\\?\C:\dir\nul.txt",
            r"\\?\C:\trailing.",
            r"\\?\C:\com1",
        ] {
            assert_eq!(plain(kept), PathBuf::from(kept), "{kept}");
        }
        let long = format!(r"\\?\C:\{}", "a".repeat(300));
        assert_eq!(plain(&long), PathBuf::from(&long));
    }
}
