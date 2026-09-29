//! Ending a child together with everything it started, on Windows.
//!
//! Unix children run in their own process group, which one signal ends.
//! Windows has no equivalent, so a provider's shell commands and MCP servers
//! would outlive `TerminateProcess` on the provider itself. The system
//! `taskkill /T` walks the live process tree from the child's PID and ends
//! all of it, without unsafe code. It must run while the child is still
//! alive: once its parent has exited, an orphan is no longer reachable.
use std::{
    os::windows::process::CommandExt,
    path::PathBuf,
    process::{Command, Stdio},
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Forcefully ends `pid` and its descendants. Waits for `taskkill` so the
/// tree is gone before the caller reports the child as stopped.
pub(crate) fn terminate(pid: u32) {
    // An absolute path: never a `taskkill` found in a project folder.
    let program = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("taskkill.exe"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\taskkill.exe"));
    let _ = Command::new(program)
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}
