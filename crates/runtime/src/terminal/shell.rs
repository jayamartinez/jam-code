//! Shell selection. Kept separate so a Settings preference can later replace
//! the detected default without touching process ownership.
use crate::error::JamError;
use std::path::{Path, PathBuf};

/// The program a terminal starts and the arguments it starts with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
}

impl ShellSpec {
    pub fn new(
        program: impl Into<PathBuf>,
        args: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        Self {
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }

    /// A short display name: `zsh`, `bash`, `pwsh`, `cmd`.
    pub fn name(&self) -> String {
        self.program
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "shell".into())
    }

    /// The user's normal shell on this machine. Nothing here names a
    /// machine-specific path beyond each platform's standard locations.
    pub fn detect() -> Result<Self, JamError> {
        detect().ok_or_else(|| {
            JamError::new("unavailable", "No usable shell was found on this computer.")
        })
    }
}

#[cfg(unix)]
fn detect() -> Option<ShellSpec> {
    let from_env = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_file());
    let program = from_env.or_else(|| {
        // macOS has defaulted to zsh since 10.15; most Linux systems ship bash.
        ["/bin/zsh", "/bin/bash", "/usr/bin/bash", "/bin/sh"]
            .into_iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())
    })?;
    // A login shell reads the profile that sets PATH. Without it, an app
    // started from the Dock or Finder would give the shell a minimal PATH.
    let login = matches!(
        program.file_name().and_then(|name| name.to_str()),
        Some("zsh" | "bash" | "fish" | "sh" | "ksh" | "dash" | "tcsh" | "csh")
    );
    Some(ShellSpec::new(
        program,
        if login { vec!["-l"] } else { vec![] },
    ))
}

#[cfg(windows)]
fn detect() -> Option<ShellSpec> {
    // PowerShell 7 when installed, then Windows PowerShell, then cmd.
    if let Some(pwsh) = find_on_path("pwsh.exe") {
        return Some(ShellSpec::new(pwsh, ["-NoLogo"]));
    }
    if let Some(root) = std::env::var_os("SystemRoot") {
        let powershell = Path::new(&root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe");
        if powershell.is_file() {
            return Some(ShellSpec::new(powershell, ["-NoLogo"]));
        }
    }
    let cmd = std::env::var_os("ComSpec")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| find_on_path("cmd.exe"))?;
    Some(ShellSpec::new(cmd, Vec::<String>::new()))
}

#[cfg(windows)]
fn find_on_path(program: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|directory| directory.join(program))
        .find(|candidate| candidate.is_file())
}

/// The home directory, when the platform reports one.
pub(crate) fn home() -> Option<PathBuf> {
    std::env::home_dir().filter(|path| path.is_dir())
}

/// `~/code/jam` for display. The absolute path stays authoritative.
pub(crate) fn display_path(path: &Path) -> String {
    if let Some(home) = home()
        && let Ok(rest) = path.strip_prefix(&home)
    {
        let separator = std::path::MAIN_SEPARATOR;
        return if rest.as_os_str().is_empty() {
            "~".into()
        } else {
            format!("~{separator}{}", rest.display())
        };
    }
    path.display().to_string()
}

/// Expands a leading `~/` in a recorded project folder.
pub(crate) fn expand_home(path: &str) -> PathBuf {
    match (path.strip_prefix("~/"), home()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_from_the_program() {
        assert_eq!(ShellSpec::new("/bin/zsh", ["-l"]).name(), "zsh");
        assert_eq!(ShellSpec::new("pwsh.exe", ["-NoLogo"]).name(), "pwsh");
    }

    #[test]
    fn a_shell_is_detected() {
        let shell = ShellSpec::detect().expect("every supported platform has a shell");
        assert!(shell.program.is_file());
    }
}
