use crate::JamError;
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

pub struct Output {
    pub bytes: Vec<u8>,
    pub success: bool,
    pub truncated: bool,
}
/// Direct invocation; no shell, pager, external diff, textconv, or inherited Git routing.
/// Drain a bounded capture on a reader thread and kill on overflow/deadline.
pub fn run(root: &Path, args: &[&str], limit: usize) -> Result<Output, JamError> {
    run_within(root, args, limit, DEADLINE)
}
const DEADLINE: Duration = Duration::from_secs(15);
/// `run` with its own deadline, for the rare command that writes a checkout.
pub fn run_within(
    root: &Path,
    args: &[&str],
    limit: usize,
    deadline: Duration,
) -> Result<Output, JamError> {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args([
            "--no-pager",
            "--literal-pathspecs",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=",
            "-c",
            "diff.external=",
            "-c",
            "core.quotePath=false",
        ])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|_| {
        JamError::new(
            "unavailable",
            "Git could not start. Install Git and check the project folder.",
        )
    })?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let overflow = Arc::new(AtomicBool::new(false));
    let flag = overflow.clone();
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            let size = stdout.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            let remaining = limit.saturating_sub(bytes.len());
            bytes.extend_from_slice(&buffer[..size.min(remaining)]);
            if size > remaining {
                flag.store(true, Ordering::Release);
            }
        }
        Ok::<_, std::io::Error>(bytes)
    });
    let start = Instant::now();
    let mut timed_out = false;
    let mut exited = None;
    let status = loop {
        if exited.is_none() {
            exited = child
                .try_wait()
                .map_err(|_| JamError::new("git_failed", "Could not wait for Git."))?;
        }
        if reader.is_finished()
            && let Some(status) = exited
        {
            break status;
        }
        if overflow.load(Ordering::Acquire) || start.elapsed() > deadline {
            timed_out = !overflow.load(Ordering::Acquire);
            #[cfg(unix)]
            if let Some(pid) = rustix::process::Pid::from_raw(child.id() as i32) {
                let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
            }
            #[cfg(windows)]
            if exited.is_none() {
                crate::process_tree::terminate(child.id());
            }
            let _ = child.kill();
            let status = match exited {
                Some(status) => status,
                None => child
                    .wait()
                    .map_err(|_| JamError::new("git_failed", "Could not stop Git."))?,
            };
            // A filter descendant must not hold this request forever. Unix
            // group termination closes its pipe; Windows ends the live tree.
            let drain_deadline = Instant::now() + Duration::from_millis(200);
            while !reader.is_finished() && Instant::now() < drain_deadline {
                thread::sleep(Duration::from_millis(5));
            }
            if !reader.is_finished() {
                return Err(JamError::new(
                    "git_timeout",
                    "Git output did not close after termination.",
                ));
            }
            break status;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let bytes = reader
        .join()
        .ok()
        .and_then(Result::ok)
        .ok_or_else(|| JamError::new("git_failed", "Could not read Git output."))?;
    if timed_out {
        return Err(JamError::new(
            "git_timeout",
            format!(
                "Git exceeded the {} second limit. Try again.",
                deadline.as_secs()
            ),
        ));
    }
    Ok(Output {
        bytes,
        success: status.success(),
        truncated: overflow.load(Ordering::Acquire),
    })
}
pub fn checked(root: &Path, args: &[&str], limit: usize) -> Result<Output, JamError> {
    let output = run(root, args, limit)?;
    if !output.success && !output.truncated {
        return Err(JamError::new(
            "git_failed",
            "Git could not complete the operation. Check repository permissions, conflicts, and index locks, then refresh.",
        ));
    }
    Ok(output)
}
