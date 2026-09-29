//! A provider child process speaking newline-delimited JSON over stdio.
//!
//! The runtime owns it: no view, subscription or React lifetime can end it.
//! Dropping the handle, an explicit `kill` or JAM shutdown terminates the whole
//! process group, so tools the agent started do not outlive it. Stdout lines
//! and stderr are bounded; stderr keeps only a short tail for diagnostics and
//! is never logged wholesale.
use crate::error::JamError;
use std::{
    ffi::OsString,
    path::PathBuf,
    process::Stdio,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{mpsc, oneshot, watch},
};

/// One stdout line may carry a whole transcript item, including inline image
/// data a provider echoes back. Larger lines are dropped and reported.
pub(crate) const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
const STDERR_TAIL_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone)]
pub(crate) struct LaunchSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: Option<PathBuf>,
    /// Added to the inherited environment. Never provider credentials.
    pub env: Vec<(OsString, OsString)>,
    /// Removed from the inherited environment.
    pub env_remove: Vec<OsString>,
}

impl LaunchSpec {
    pub fn new(program: PathBuf) -> Self {
        Self {
            program,
            args: Vec::new(),
            cwd: None,
            env: Vec::new(),
            env_remove: Vec::new(),
        }
    }
    pub fn arg(mut self, arg: impl Into<OsString>) -> Self {
        self.args.push(arg.into());
        self
    }
    pub fn args<I: IntoIterator<Item = S>, S: Into<OsString>>(mut self, args: I) -> Self {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }
    pub fn env(mut self, key: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.env.push((key.into(), value.into()));
        self
    }
    pub fn cwd(mut self, cwd: Option<PathBuf>) -> Self {
        self.cwd = cwd;
        self
    }
}

#[derive(Debug)]
pub(crate) enum Output {
    Line(String),
    /// A line exceeded `MAX_LINE_BYTES` or was not UTF-8; its content is gone.
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Exit {
    pub code: Option<i32>,
    /// True when JAM itself terminated the process.
    pub killed: bool,
}

/// The owned child. Dropping it terminates the process group.
pub(crate) struct StdioChild {
    writer: mpsc::Sender<Vec<u8>>,
    exit: watch::Receiver<Option<Exit>>,
    stderr: Arc<Mutex<Vec<u8>>>,
    kill: Mutex<Option<oneshot::Sender<()>>>,
    pid: Option<u32>,
}

impl StdioChild {
    pub fn spawn(spec: &LaunchSpec) -> Result<(Self, mpsc::Receiver<Output>), JamError> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        for key in &spec.env_remove {
            command.env_remove(key);
        }
        for (key, value) in &spec.env {
            command.env(key, value);
        }
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        {
            // No console window flashes for a background agent.
            command.creation_flags(crate::CREATE_NO_WINDOW);
        }
        let mut child = command.spawn().map_err(|error| {
            JamError::new(
                "provider_unavailable",
                match error.kind() {
                    std::io::ErrorKind::NotFound => {
                        "The provider executable was not found. Check its path in Settings → Providers."
                            .to_string()
                    }
                    std::io::ErrorKind::PermissionDenied => {
                        "The provider executable is not runnable. Check its path and permissions."
                            .to_string()
                    }
                    _ => format!("The provider could not start: {}.", error.kind()),
                },
            )
        })?;
        let pid = child.id();
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr_pipe = child.stderr.take().expect("piped stderr");
        let mut stdin = child.stdin.take().expect("piped stdin");

        let (lines_tx, lines_rx) = mpsc::channel(256);
        tokio::spawn(read_lines(stdout, lines_tx));

        let stderr = Arc::new(Mutex::new(Vec::new()));
        tokio::spawn(read_tail(stderr_pipe, Arc::clone(&stderr)));

        let (writer, mut outgoing) = mpsc::channel::<Vec<u8>>(64);
        tokio::spawn(async move {
            while let Some(mut line) = outgoing.recv().await {
                line.push(b'\n');
                if stdin.write_all(&line).await.is_err() || stdin.flush().await.is_err() {
                    break;
                }
            }
            // Dropping stdin closes the pipe: a clean end of input.
        });

        let (exit_tx, exit) = watch::channel(None);
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            let status = tokio::select! {
                status = child.wait() => status.ok().map(|status| (status.code(), false)),
                _ = kill_rx => {
                    terminate_tree(pid).await;
                    let _ = child.start_kill();
                    child.wait().await.ok().map(|status| (status.code(), true))
                }
            };
            let (code, killed) = status.unwrap_or((None, true));
            // The group may still hold tools the agent started.
            #[cfg(unix)]
            if !killed {
                terminate_tree(pid).await;
            }
            let _ = exit_tx.send(Some(Exit { code, killed }));
        });

        Ok((
            Self {
                writer,
                exit,
                stderr,
                kill: Mutex::new(Some(kill_tx)),
                pid,
            },
            lines_rx,
        ))
    }

    /// Queues one JSON line on stdin.
    pub async fn send(&self, value: &serde_json::Value) -> Result<(), JamError> {
        let line = serde_json::to_vec(value)?;
        self.writer
            .send(line)
            .await
            .map_err(|_| JamError::new("provider_exited", "The provider process has exited."))
    }

    pub fn exited(&self) -> Option<Exit> {
        self.exit.borrow().clone()
    }

    /// Resolves once the process has exited, for any reason.
    #[cfg_attr(not(test), allow(dead_code))]
    pub async fn wait(&self) -> Exit {
        let mut exit = self.exit.clone();
        loop {
            if let Some(exit) = exit.borrow_and_update().clone() {
                return exit;
            }
            if exit.changed().await.is_err() {
                return Exit {
                    code: None,
                    killed: true,
                };
            }
        }
    }

    /// Terminates the process group. Idempotent.
    pub fn kill(&self) {
        if let Ok(mut kill) = self.kill.lock()
            && let Some(kill) = kill.take()
        {
            let _ = kill.send(());
        }
    }

    /// Terminates the process group before returning, for shutdown, where
    /// JAM may exit before the background task that `kill` signals runs.
    /// Blocks briefly on Windows; call it off the async threads.
    pub fn kill_now(&self) {
        if self.exited().is_none() {
            #[cfg(unix)]
            if let Some(pid) = self
                .pid
                .and_then(|pid| rustix::process::Pid::from_raw(pid as i32))
            {
                let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
            }
            #[cfg(windows)]
            if let Some(pid) = self.pid {
                crate::process_tree::terminate(pid);
            }
        }
        self.kill();
    }

    /// The last line of stderr, bounded for display. Provider stderr can echo
    /// arbitrary content, so it only ever appears in a local error message.
    pub fn stderr_summary(&self) -> Option<String> {
        let tail = self.stderr.lock().ok()?;
        let text = String::from_utf8_lossy(&tail);
        let line = text.lines().rev().find(|line| !line.trim().is_empty())?;
        Some(line.trim().chars().take(300).collect())
    }
}

impl Drop for StdioChild {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Ends the child and everything it started: its process group on Unix,
/// its live process tree on Windows (see `process_tree`).
async fn terminate_tree(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid.and_then(|pid| rustix::process::Pid::from_raw(pid as i32)) {
        let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
    }
    #[cfg(windows)]
    if let Some(pid) = pid {
        let _ = tokio::task::spawn_blocking(move || crate::process_tree::terminate(pid)).await;
    }
    #[cfg(not(any(unix, windows)))]
    let _ = pid;
}

async fn read_lines(mut stdout: impl AsyncRead + Unpin, lines: mpsc::Sender<Output>) {
    let mut pending: Vec<u8> = Vec::new();
    let mut discarding = false;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let size = match stdout.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(size) => size,
        };
        let mut chunk = &buffer[..size];
        while let Some(newline) = chunk.iter().position(|byte| *byte == b'\n') {
            let (head, rest) = chunk.split_at(newline);
            chunk = &rest[1..];
            let output = if discarding {
                discarding = false;
                pending.clear();
                Output::Unreadable
            } else {
                pending.extend_from_slice(head);
                let line = std::mem::take(&mut pending);
                match String::from_utf8(line) {
                    Ok(line) if line.trim().is_empty() => continue,
                    Ok(line) => Output::Line(line),
                    Err(_) => Output::Unreadable,
                }
            };
            if lines.send(output).await.is_err() {
                return;
            }
        }
        if !discarding {
            pending.extend_from_slice(chunk);
            if pending.len() > MAX_LINE_BYTES {
                pending = Vec::new();
                discarding = true;
            }
        }
    }
}

async fn read_tail(mut stderr: impl AsyncRead + Unpin, tail: Arc<Mutex<Vec<u8>>>) {
    let mut buffer = [0u8; 4096];
    loop {
        let size = match stderr.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(size) => size,
        };
        let Ok(mut tail) = tail.lock() else { break };
        tail.extend_from_slice(&buffer[..size]);
        if tail.len() > STDERR_TAIL_BYTES {
            let excess = tail.len() - STDERR_TAIL_BYTES;
            tail.drain(..excess);
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lines_are_framed_and_the_group_is_killed() {
        let spec = LaunchSpec::new("/bin/sh".into()).args([
            "-c",
            "printf '{\"a\":1}\\n\\n{\"b\":' ; printf '2}\\n'; echo oops >&2; sleep 30",
        ]);
        let (child, mut lines) = StdioChild::spawn(&spec).unwrap();
        let first = lines.recv().await.unwrap();
        assert!(matches!(first, Output::Line(ref l) if l == "{\"a\":1}"));
        let second = lines.recv().await.unwrap();
        assert!(matches!(second, Output::Line(ref l) if l == "{\"b\":2}"));
        child.kill();
        let exit = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .unwrap();
        assert!(exit.killed);
        assert_eq!(child.stderr_summary().as_deref(), Some("oops"));
    }

    #[tokio::test]
    async fn stdin_lines_reach_the_child() {
        let spec = LaunchSpec::new("/bin/sh".into()).args(["-c", "read line; echo \"$line\""]);
        let (child, mut lines) = StdioChild::spawn(&spec).unwrap();
        child.send(&serde_json::json!({"ping":true})).await.unwrap();
        let echoed = lines.recv().await.unwrap();
        assert!(matches!(echoed, Output::Line(ref l) if l == "{\"ping\":true}"));
        let exit = child.wait().await;
        assert_eq!(exit.code, Some(0));
        assert!(!exit.killed);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// A command the agent started must end with the provider, as Unix
    /// process-group termination guarantees there.
    #[tokio::test]
    async fn killing_the_child_ends_its_descendants() {
        let dir = std::env::temp_dir().join(format!("jam-tree-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let marker = dir.join("marker.txt");
        let script = dir.join("tree.cmd");
        // The grandchild writes the marker after about two seconds unless it
        // was ended with the provider.
        std::fs::write(
            &script,
            "@echo off\r\nstart \"\" /b cmd /c \"ping -n 3 127.0.0.1 >nul & echo survived>\"%~dp0marker.txt\"\"\r\nping -n 30 127.0.0.1 >nul\r\n",
        )
        .unwrap();
        let spec = LaunchSpec::new("cmd.exe".into())
            .arg("/c")
            .arg(script.as_os_str());
        let (child, _lines) = StdioChild::spawn(&spec).unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        child.kill();
        let exit = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait())
            .await
            .unwrap();
        assert!(exit.killed);
        tokio::time::sleep(std::time::Duration::from_secs(4)).await;
        let survived = marker.exists();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!survived, "a descendant outlived the provider process");
    }
}
