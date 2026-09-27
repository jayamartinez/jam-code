//! Locating a provider's installed CLI. JAM never installs, updates or
//! authenticates a provider; it only finds what the user already has.
//!
//! An app started from the Dock or Finder inherits a minimal PATH, so the
//! search also asks the user's login shell for its PATH once, and checks the
//! standard per-user install directories. An explicit path from Settings
//! always wins and is never silently replaced by a different executable.
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Source {
    Override,
    Detected,
}

#[derive(Debug, Clone)]
pub(crate) struct Found {
    pub path: PathBuf,
    pub source: Source,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Missing {
    /// The configured override does not name a runnable file.
    InvalidOverride,
    /// Nothing was found on PATH or in the standard locations.
    NotFound,
}

/// Finds `names` (without extensions) or validates `override_path`.
pub(crate) fn locate(names: &[&str], override_path: Option<&str>) -> Result<Found, Missing> {
    if let Some(path) = override_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = crate::terminal::expand_home_path(path);
        return if is_executable(&path) {
            Ok(Found {
                path,
                source: Source::Override,
            })
        } else {
            Err(Missing::InvalidOverride)
        };
    }
    let directories = std::env::split_paths(&search_path()).collect::<Vec<_>>();
    for directory in &directories {
        for name in names {
            for candidate in candidates(directory, name) {
                if is_executable(&candidate) {
                    return Ok(Found {
                        path: candidate,
                        source: Source::Detected,
                    });
                }
            }
        }
    }
    Err(Missing::NotFound)
}

fn candidates(directory: &Path, name: &str) -> Vec<PathBuf> {
    if cfg!(windows) {
        ["exe", "cmd", "bat"]
            .iter()
            .map(|extension| directory.join(format!("{name}.{extension}")))
            .collect()
    } else {
        vec![directory.join(name)]
    }
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    true
}

/// The PATH provider processes run with: the login shell's PATH, then JAM's
/// own, then standard per-user install locations. Computed once.
pub(crate) fn search_path() -> OsString {
    static PATH: OnceLock<OsString> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut directories: Vec<PathBuf> = Vec::new();
        let mut push = |path: PathBuf| {
            if !path.as_os_str().is_empty() && !directories.contains(&path) {
                directories.push(path);
            }
        };
        if let Some(login) = login_shell_path() {
            std::env::split_paths(&login).for_each(&mut push);
        }
        if let Some(own) = std::env::var_os("PATH") {
            std::env::split_paths(&own).for_each(&mut push);
        }
        standard_directories().into_iter().for_each(push);
        std::env::join_paths(directories).unwrap_or_default()
    })
    .clone()
}

fn standard_directories() -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(home) = std::env::home_dir() {
        for relative in [
            ".local/bin",
            ".claude/local",
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            ".cargo/bin",
            "bin",
        ] {
            directories.push(home.join(relative));
        }
    }
    #[cfg(unix)]
    for absolute in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        directories.push(PathBuf::from(absolute));
    }
    #[cfg(windows)]
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root);
            directories.push(root.join("npm"));
            directories.push(root.join("Programs").join("claude"));
        }
    }
    directories
}

#[cfg(unix)]
fn login_shell_path() -> Option<OsString> {
    use std::io::Read;
    const MARK: &str = "__JAM_PATH__";
    let shell = crate::terminal::ShellSpec::detect().ok()?;
    let name = shell.name();
    // fish and POSIX shells both accept -l -i -c; the marker survives any
    // banner an interactive profile prints.
    if !matches!(
        name.as_str(),
        "zsh" | "bash" | "fish" | "sh" | "ksh" | "dash"
    ) {
        return None;
    }
    let script = format!("printf '{MARK}%s{MARK}' \"$PATH\"");
    let mut child = std::process::Command::new(&shell.program)
        .args(["-l", "-i", "-c", &script])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stdout.take(256 * 1024).read_to_string(&mut text);
        text
    });
    let deadline = std::time::Instant::now() + Duration::from_secs(4);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(20))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let text = reader.join().ok()?;
    let start = text.find(MARK)? + MARK.len();
    let end = start + text[start..].find(MARK)?;
    let path = text[start..end].trim();
    (!path.is_empty()).then(|| OsString::from(path))
}

#[cfg(not(unix))]
fn login_shell_path() -> Option<OsString> {
    None
}

/// Runs `<program> <args>` briefly and returns the first version-looking
/// token of its output, such as `2.1.283` or `0.157.0`.
pub(crate) async fn version(program: &Path, args: &[&str]) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(8),
        tokio::process::Command::new(program)
            .args(args)
            .env("PATH", search_path())
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    parse_version(&String::from_utf8_lossy(&output.stdout))
}

pub(crate) fn parse_version(text: &str) -> Option<String> {
    text.split(|c: char| c.is_whitespace() || c == '(' || c == ')' || c == ',')
        .map(|token| token.trim_start_matches('v'))
        .find(|token| {
            let mut parts = token.split('.');
            parts.clone().count() >= 2
                && parts.all(|part| {
                    let digits = part.split(['-', '+']).next().unwrap_or(part);
                    !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
                })
        })
        .map(str::to_owned)
}

/// Compares dotted numeric versions; unknown parts compare as zero.
pub(crate) fn at_least(version: &str, minimum: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .split(['-', '+'])
            .next()
            .unwrap_or(value)
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parse(version), parse(minimum));
    for index in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(index).copied().unwrap_or(0),
            b.get(index).copied().unwrap_or(0),
        );
        if x != y {
            return x > y;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_are_parsed_from_cli_output() {
        assert_eq!(
            parse_version("2.1.283 (Claude Code)").as_deref(),
            Some("2.1.283")
        );
        assert_eq!(
            parse_version("codex-cli 0.157.0").as_deref(),
            Some("0.157.0")
        );
        assert_eq!(
            parse_version("v1.2.3-beta.1").as_deref(),
            Some("1.2.3-beta.1")
        );
        assert_eq!(parse_version("no version here"), None);
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(at_least("0.157.0", "0.150.0"));
        assert!(at_least("2.1.10", "2.1.9"));
        assert!(!at_least("0.99.9", "0.100.0"));
        assert!(at_least("1.0", "1.0.0"));
    }

    #[test]
    fn an_invalid_override_is_reported_not_replaced() {
        assert_eq!(
            locate(&["sh"], Some("/definitely/not/here/claude")).unwrap_err(),
            Missing::InvalidOverride
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_valid_override_is_used_verbatim() {
        let found = locate(&["nothing"], Some("/bin/sh")).unwrap();
        assert_eq!(found.path, PathBuf::from("/bin/sh"));
        assert_eq!(found.source, Source::Override);
    }
}
