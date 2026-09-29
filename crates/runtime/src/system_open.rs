//! Hands a project file or a local address to the operating system: reveal
//! the file in Finder or Explorer, or open a local server in the default
//! browser. Both only follow an explicit click in the interface, never
//! provider output on its own, and neither goes through a shell.
use crate::JamError;
use std::{
    path::Path,
    process::{Command, Stdio},
};

/// Reveals a regular file inside the project folder.
pub(crate) fn reveal(root: &Path, path: &str) -> Result<(), JamError> {
    let target = crate::native_files::scoped_file(root, path)?;
    #[cfg(target_os = "macos")]
    let command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&target);
        command
    };
    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt;
        // Explorer parses its own command line: it wants `/select,"path"`
        // with backslashes, not the whole argument quoted as Rust would.
        // Windows file names cannot contain `"`, so the quoting is exact.
        let target: std::path::PathBuf = target.components().collect();
        let mut command = Command::new("explorer.exe");
        command.raw_arg(format!("/select,\"{}\"", target.display()));
        command
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let command = {
        // Most Linux file managers cannot select a file; open its folder.
        let mut command = Command::new("xdg-open");
        command.arg(target.parent().unwrap_or(root));
        command
    };
    launch(command, "Could not show the file in the file manager.")
}

/// Opens a local address (a development server) in the default browser.
pub(crate) fn open_local_url(url: &str) -> Result<(), JamError> {
    if !is_local_url(url) {
        return Err(JamError::invalid(
            "Only http addresses on this computer open in the browser.",
        ));
    }
    open_in_browser(url)
}

/// JAM Code's own pages on GitHub (issues, documentation).
pub const PROJECT_PAGES: &str = "https://github.com/jayamartinez/jam-code/";

/// Opens one of JAM Code's own GitHub pages in the default browser: the
/// only external address the app opens by itself. The query must already be
/// percent-encoded, so nothing in it can read as an option.
pub fn open_project_page(url: &str) -> Result<(), JamError> {
    let valid = url.starts_with(PROJECT_PAGES)
        && url.len() <= 4096
        && url
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._~:/?#[]@!$&'()*+,;=%".contains(&b));
    if !valid {
        return Err(JamError::invalid("Only JAM Code's own pages open here."));
    }
    open_in_browser(url)
}

fn open_in_browser(url: &str) -> Result<(), JamError> {
    #[cfg(target_os = "macos")]
    let command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(windows)]
    let command = {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler").arg(url);
        command
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    launch(command, "Could not open the browser.")
}

/// `http(s)://` on localhost, 127.0.0.1, [::1] or 0.0.0.0, with an optional
/// port and path, and nothing a platform opener could read as an option.
pub(crate) fn is_local_url(url: &str) -> bool {
    if url.len() > 2048 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Some(rest) = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
    else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.contains('@') {
        return false;
    }
    let host = if let Some(bracketed) = authority.strip_prefix('[') {
        match bracketed.split_once(']') {
            Some((host, port)) if port.is_empty() || valid_port(port) => host,
            _ => return false,
        }
    } else {
        match authority.split_once(':') {
            Some((host, port)) if valid_port(&format!(":{port}")) => host,
            Some(_) => return false,
            None => authority,
        }
    };
    matches!(
        host.to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | "0.0.0.0"
    )
}

fn valid_port(port: &str) -> bool {
    port.strip_prefix(':').is_some_and(|digits| {
        !digits.is_empty() && digits.len() <= 5 && digits.bytes().all(|b| b.is_ascii_digit())
    })
}

fn launch(mut command: Command, failure: &str) -> Result<(), JamError> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| JamError::new("unavailable", failure))?;
    // The opener exits at once; reap it without blocking the request.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_local_url;

    #[test]
    fn only_local_http_addresses_open() {
        for url in [
            "http://localhost:5173/",
            "http://127.0.0.1:3000/app?x=1",
            "https://localhost",
            "http://[::1]:8080/",
            "http://0.0.0.0:4173",
        ] {
            assert!(is_local_url(url), "{url}");
        }
        for url in [
            "https://example.com",
            "http://localhost.example.com",
            "http://user@localhost:5173",
            "http://localhost:abc",
            "file:///etc/passwd",
            "http://localhost:5173/ -a",
            "javascript:alert(1)",
            "-R http://localhost",
        ] {
            assert!(!is_local_url(url), "{url}");
        }
    }
}
