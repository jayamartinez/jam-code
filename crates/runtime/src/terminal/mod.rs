//! Terminal sessions: real pseudo-terminals owned by the runtime.
//!
//! A terminal *resource* has a stable ID and may outlive any number of shell
//! processes; each shell start is a *session* with its own ID. Views attach to
//! a resource to receive output and detach when they unmount. Neither attaching
//! nor detaching affects the process: only `terminal.kill`, the shell exiting
//! on its own, or runtime shutdown ends it.
//!
//! Output never travels through the workspace event stream. Each attachment has
//! its own sink, so a chunk of output reaches the views of that terminal and
//! nothing else, and never causes a workspace reread.
mod output;
mod requests;
mod shell;

pub use shell::ShellSpec;

use crate::error::JamError;
use output::{Replay, Utf8Stream};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, MutexGuard, mpsc},
    time::Duration,
};

/// Output kept for views that attach later.
pub const REPLAY_LIMIT: usize = 512 * 1024;
/// Unacknowledged output per attachment before the reader pauses. Pausing the
/// reader lets the PTY apply backpressure to the program, as a real terminal
/// does, instead of queueing unbounded output for a view that cannot keep up.
pub const HIGH_WATER: usize = 256 * 1024;
pub const MAX_RUNNING: usize = 32;
pub const MAX_ATTACHMENTS: usize = 64;
const READ_CHUNK: usize = 16 * 1024;
/// After the shell exits, how long to wait for its remaining output.
const DRAIN_GRACE: Duration = Duration::from_millis(750);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Running,
    Exited,
}

/// Where a terminal's working directory came from, so a view can say so.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CwdSource {
    Project,
    Requested,
    Home,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    /// This shell process. A restart in the same resource gets a new ID.
    pub id: String,
    pub resource_id: String,
    pub project_id: String,
    /// Absolute working directory the shell started in.
    pub cwd: String,
    /// The same directory for display, with the home directory as `~`.
    pub cwd_label: String,
    pub cwd_source: CwdSource,
    pub shell: String,
    pub title: String,
    pub status: TerminalStatus,
    pub created_at: String,
    pub cols: u16,
    pub rows: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_signal: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    /// The shell ended because someone asked for it to be terminated.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub terminated: bool,
}

/// Delivered to one attached view, in order.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TerminalEvent {
    /// First event of every attachment: current state and recent output.
    #[serde(rename_all = "camelCase")]
    Snapshot {
        attachment_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        terminal: Option<TerminalSession>,
        data: String,
    },
    /// Output; acknowledge `seq` once it has been rendered.
    Output { seq: u64, data: String },
    /// The session started, changed size or ended.
    Session { terminal: TerminalSession },
}

/// Receives an attachment's events. It must not block or call back into the
/// runtime; it returns false once the receiving view has gone away.
pub type TerminalSink = Box<dyn Fn(TerminalEvent) -> bool + Send + Sync>;

pub(crate) struct Spawn {
    pub resource_id: String,
    pub project_id: String,
    pub cwd: PathBuf,
    pub cwd_source: CwdSource,
    pub cols: u16,
    pub rows: u16,
    pub created_at: String,
    pub session_id: String,
}

struct Attachment {
    sink: TerminalSink,
    seq: u64,
    unacked: VecDeque<(u64, usize)>,
    unacked_bytes: usize,
}

struct Live {
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

struct EntryState {
    session: Option<TerminalSession>,
    live: Option<Live>,
    replay: Replay,
    attachments: HashMap<String, Attachment>,
    /// Increments per shell start so a previous shell's threads stand down.
    generation: u64,
    /// `terminal.kill` was requested for the current shell.
    kill_requested: bool,
}

struct Entry {
    state: Mutex<EntryState>,
    flow: Condvar,
}

impl Entry {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(EntryState {
                session: None,
                live: None,
                replay: Replay::new(REPLAY_LIMIT),
                attachments: HashMap::new(),
                generation: 0,
                kill_requested: false,
            }),
            flow: Condvar::new(),
        })
    }

    fn lock(&self) -> Result<MutexGuard<'_, EntryState>, JamError> {
        self.state.lock().map_err(|_| poisoned())
    }
}

impl EntryState {
    fn broadcast(&mut self, event: impl Fn() -> TerminalEvent) {
        self.attachments
            .retain(|_, attachment| (attachment.sink)(event()));
    }

    fn broadcast_output(&mut self, data: &str) {
        self.attachments.retain(|_, attachment| {
            attachment.seq += 1;
            let delivered = (attachment.sink)(TerminalEvent::Output {
                seq: attachment.seq,
                data: data.to_string(),
            });
            if delivered {
                attachment.unacked.push_back((attachment.seq, data.len()));
                attachment.unacked_bytes += data.len();
            }
            delivered
        });
    }

    fn backlogged(&self) -> bool {
        self.attachments
            .values()
            .any(|attachment| attachment.unacked_bytes > HIGH_WATER)
    }
}

#[derive(Default)]
struct Registry {
    entries: HashMap<String, Arc<Entry>>,
    /// Attachment ID → resource ID.
    attachments: HashMap<String, String>,
    closed: bool,
}

/// Owns every terminal process. Created empty: no PTY exists until a user
/// explicitly creates or starts a terminal.
#[derive(Default)]
pub(crate) struct TerminalManager {
    registry: Mutex<Registry>,
    shell: Mutex<Option<ShellSpec>>,
}

fn poisoned() -> JamError {
    JamError::new(
        "internal",
        "Terminal state is unavailable after an internal failure.",
    )
}

fn not_running() -> JamError {
    JamError::new("conflict", "This terminal's shell is not running.")
}

impl TerminalManager {
    fn registry(&self) -> Result<MutexGuard<'_, Registry>, JamError> {
        self.registry.lock().map_err(|_| poisoned())
    }

    fn entry(&self, resource_id: &str) -> Result<Option<Arc<Entry>>, JamError> {
        Ok(self.registry()?.entries.get(resource_id).cloned())
    }

    /// Replaces the detected default shell. `None` restores detection.
    pub fn set_shell(&self, shell: Option<ShellSpec>) -> Result<(), JamError> {
        *self.shell.lock().map_err(|_| poisoned())? = shell;
        Ok(())
    }

    fn shell(&self) -> Result<ShellSpec, JamError> {
        match self.shell.lock().map_err(|_| poisoned())?.clone() {
            Some(shell) => Ok(shell),
            None => ShellSpec::detect(),
        }
    }

    pub fn get(&self, resource_id: &str) -> Result<Option<TerminalSession>, JamError> {
        match self.entry(resource_id)? {
            Some(entry) => Ok(entry.lock()?.session.clone()),
            None => Ok(None),
        }
    }

    pub fn list(&self, project_id: Option<&str>) -> Result<Vec<TerminalSession>, JamError> {
        let entries: Vec<_> = self.registry()?.entries.values().cloned().collect();
        let mut sessions = Vec::new();
        for entry in entries {
            if let Some(session) = entry.lock()?.session.clone()
                && project_id.is_none_or(|id| id == session.project_id)
            {
                sessions.push(session);
            }
        }
        sessions.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        Ok(sessions)
    }

    fn unique_title(
        &self,
        project_id: &str,
        resource_id: &str,
        base: &str,
    ) -> Result<String, JamError> {
        let entries: Vec<_> = self
            .registry()?
            .entries
            .iter()
            .filter(|(id, _)| id.as_str() != resource_id)
            .map(|(_, entry)| Arc::clone(entry))
            .collect();
        let mut taken = Vec::new();
        for entry in entries {
            let state = entry.lock()?;
            if let (Some(session), Some(_)) = (&state.session, &state.live)
                && session.project_id == project_id
            {
                taken.push(session.title.clone());
            }
        }
        if !taken.iter().any(|title| title == base) {
            return Ok(base.to_string());
        }
        Ok((2..)
            .map(|number| format!("{base} {number}"))
            .find(|title| !taken.contains(title))
            .unwrap_or_else(|| base.to_string()))
    }

    fn running(&self) -> Result<usize, JamError> {
        let entries: Vec<_> = self.registry()?.entries.values().cloned().collect();
        let mut count = 0;
        for entry in entries {
            count += usize::from(entry.lock()?.live.is_some());
        }
        Ok(count)
    }

    /// Starts a shell for a resource, replacing an ended session's output.
    pub fn start(&self, spawn: Spawn) -> Result<TerminalSession, JamError> {
        if self.running()? >= MAX_RUNNING {
            return Err(JamError::new(
                "unavailable",
                format!("At most {MAX_RUNNING} terminals can run at once."),
            ));
        }
        let entry = {
            let mut registry = self.registry()?;
            if registry.closed {
                return Err(JamError::new("unavailable", "JAM is shutting down."));
            }
            Arc::clone(
                registry
                    .entries
                    .entry(spawn.resource_id.clone())
                    .or_insert_with(Entry::new),
            )
        };
        if entry.lock()?.live.is_some() {
            return Err(JamError::new(
                "conflict",
                "This terminal's shell is already running.",
            ));
        }

        let shell = self.shell()?;
        // A restart keeps its name; a new terminal gets one no running
        // terminal in the project is using, so tabs and lists tell them apart.
        let previous = entry
            .lock()?
            .session
            .as_ref()
            .map(|session| session.title.clone());
        let title = match previous {
            Some(title) => title,
            None => self.unique_title(&spawn.project_id, &spawn.resource_id, &shell.name())?,
        };
        let failed = |error: &dyn std::fmt::Display| {
            JamError::new(
                "unavailable",
                format!("The shell could not be started: {error}"),
            )
        };
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: spawn.rows,
                cols: spawn.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| failed(&error))?;
        let mut command = CommandBuilder::new(&shell.program);
        command.args(&shell.args);
        command.cwd(&spawn.cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "jam");
        command.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        // An app opened from the Dock or Finder may have no locale, and the
        // shell would then treat UTF-8 output as bytes.
        #[cfg(unix)]
        if ["LANG", "LC_ALL", "LC_CTYPE"]
            .iter()
            .all(|name| std::env::var_os(name).is_none())
        {
            command.env("LANG", "en_US.UTF-8");
        }
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| failed(&error))?;
        // The shell holds the only slave handle, so its exit ends the output.
        drop(pair.slave);
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| failed(&error))?;
        let writer = pair.master.take_writer().map_err(|error| failed(&error))?;
        let killer = child.clone_killer();

        let session = TerminalSession {
            id: spawn.session_id,
            resource_id: spawn.resource_id.clone(),
            project_id: spawn.project_id,
            cwd: spawn.cwd.display().to_string(),
            cwd_label: shell::display_path(&spawn.cwd),
            cwd_source: spawn.cwd_source,
            shell: shell.name(),
            title,
            status: TerminalStatus::Running,
            created_at: spawn.created_at,
            cols: spawn.cols,
            rows: spawn.rows,
            exit_code: None,
            exit_signal: None,
            ended_at: None,
            terminated: false,
        };
        let generation = {
            let mut state = entry.lock()?;
            if state.live.is_some() {
                // Another start won the race; this shell must not be orphaned.
                let mut killer = killer;
                let _ = killer.kill();
                return Err(JamError::new(
                    "conflict",
                    "This terminal's shell is already running.",
                ));
            }
            state.generation += 1;
            state.kill_requested = false;
            state.replay.clear();
            state.session = Some(session.clone());
            state.live = Some(Live {
                master: pair.master,
                killer,
                writer: Arc::new(Mutex::new(writer)),
            });
            let started = session.clone();
            state.broadcast(|| TerminalEvent::Session {
                terminal: started.clone(),
            });
            // A previous shell's reader may be waiting on flow control.
            entry.flow.notify_all();
            state.generation
        };

        let (done, drained) = mpsc::channel();
        let reading = Arc::clone(&entry);
        let spawned = std::thread::Builder::new()
            .name("jam-terminal-reader".into())
            .spawn(move || read_output(&reading, generation, reader, done));
        let waiting = Arc::clone(&entry);
        let spawned = spawned.and_then(|_| {
            std::thread::Builder::new()
                .name("jam-terminal-waiter".into())
                .spawn(move || wait_for_exit(&waiting, generation, child, drained))
        });
        if let Err(error) = spawned {
            let mut state = entry.lock()?;
            if let Some(mut live) = state.live.take() {
                let _ = live.killer.kill();
            }
            state.session = None;
            return Err(failed(&error));
        }
        Ok(session)
    }

    /// Writes keyboard input or pasted text to the shell.
    pub fn input(&self, resource_id: &str, data: &str) -> Result<(), JamError> {
        let entry = self.entry(resource_id)?.ok_or_else(not_running)?;
        let writer = {
            let state = entry.lock()?;
            Arc::clone(&state.live.as_ref().ok_or_else(not_running)?.writer)
        };
        // Writing can block while the program is not reading its input, so it
        // happens outside the state lock that output and acknowledgements need.
        let mut writer = writer.lock().map_err(|_| poisoned())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|_| JamError::new("conflict", "The shell is no longer accepting input."))
    }

    pub fn resize(
        &self,
        resource_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalSession, JamError> {
        let entry = self.entry(resource_id)?.ok_or_else(not_running)?;
        let mut state = entry.lock()?;
        let live = state.live.as_ref().ok_or_else(not_running)?;
        live.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|_| JamError::new("conflict", "The terminal could not be resized."))?;
        let session = state.session.as_mut().ok_or_else(not_running)?;
        session.cols = cols;
        session.rows = rows;
        let session = session.clone();
        let changed = session.clone();
        state.broadcast(|| TerminalEvent::Session {
            terminal: changed.clone(),
        });
        Ok(session)
    }

    /// Explicitly ends the shell. The session is reported as exited once the
    /// process has actually gone; the resource and its output remain.
    pub fn kill(&self, resource_id: &str) -> Result<TerminalSession, JamError> {
        let entry = self.entry(resource_id)?.ok_or_else(not_running)?;
        let mut state = entry.lock()?;
        let live = state.live.as_mut().ok_or_else(not_running)?;
        // SIGHUP on macOS/Linux, as closing a terminal window sends; an
        // interactive shell passes it on to its jobs. TerminateProcess on
        // Windows, where the pseudoconsole is then closed on exit.
        live.killer
            .kill()
            .map_err(|_| JamError::new("conflict", "The shell could not be stopped."))?;
        state.kill_requested = true;
        state.session.clone().ok_or_else(not_running)
    }

    /// Attaches a view. The sink first receives a snapshot of the session and
    /// its recent output, then every later event in order.
    pub fn attach(&self, resource_id: String, sink: TerminalSink) -> Result<String, JamError> {
        let mut registry = self.registry()?;
        if registry.closed {
            return Err(JamError::new("unavailable", "JAM is shutting down."));
        }
        if registry.attachments.len() >= MAX_ATTACHMENTS {
            return Err(JamError::new(
                "unavailable",
                "Too many terminal views are attached.",
            ));
        }
        let entry = Arc::clone(
            registry
                .entries
                .entry(resource_id.clone())
                .or_insert_with(Entry::new),
        );
        let id = crate::runtime::new_id("attachment");
        let mut state = entry.lock()?;
        let delivered = sink(TerminalEvent::Snapshot {
            attachment_id: id.clone(),
            terminal: state.session.clone(),
            data: state.replay.text().to_string(),
        });
        if !delivered {
            return Err(JamError::new(
                "unavailable",
                "The terminal view closed while attaching.",
            ));
        }
        state.attachments.insert(
            id.clone(),
            Attachment {
                sink,
                seq: 0,
                unacked: VecDeque::new(),
                unacked_bytes: 0,
            },
        );
        registry.attachments.insert(id.clone(), resource_id);
        Ok(id)
    }

    /// Detaches a view. The shell keeps running.
    pub fn detach(&self, attachment_id: &str) -> Result<(), JamError> {
        let mut registry = self.registry()?;
        let Some(resource_id) = registry.attachments.remove(attachment_id) else {
            return Ok(());
        };
        let Some(entry) = registry.entries.get(&resource_id).cloned() else {
            return Ok(());
        };
        let mut state = entry.lock()?;
        state.attachments.remove(attachment_id);
        entry.flow.notify_all();
        // An entry with no shell and no views has nothing left to keep.
        if state.session.is_none() && state.attachments.is_empty() {
            drop(state);
            registry.entries.remove(&resource_id);
        }
        Ok(())
    }

    /// Detaches every view, as when the desktop window reloads. Shells run on.
    pub fn detach_all(&self) -> Result<(), JamError> {
        let mut registry = self.registry()?;
        registry.attachments.clear();
        registry.entries.retain(|_, entry| {
            let Ok(mut state) = entry.state.lock() else {
                return true;
            };
            state.attachments.clear();
            entry.flow.notify_all();
            state.session.is_some()
        });
        Ok(())
    }

    /// Records that a view has rendered output up to `seq`.
    pub fn ack(&self, attachment_id: &str, seq: u64) -> Result<(), JamError> {
        let Some(entry) = ({
            let registry = self.registry()?;
            registry
                .attachments
                .get(attachment_id)
                .and_then(|resource_id| registry.entries.get(resource_id).cloned())
        }) else {
            return Ok(());
        };
        let mut state = entry.lock()?;
        if let Some(attachment) = state.attachments.get_mut(attachment_id) {
            while attachment
                .unacked
                .front()
                .is_some_and(|(pending, _)| *pending <= seq)
            {
                if let Some((_, bytes)) = attachment.unacked.pop_front() {
                    attachment.unacked_bytes -= bytes;
                }
            }
            entry.flow.notify_all();
        }
        Ok(())
    }

    /// Ends every shell. Used only by explicit Quit.
    pub fn shutdown(&self) -> Result<(), JamError> {
        let entries: Vec<_> = {
            let mut registry = self.registry()?;
            registry.closed = true;
            registry.attachments.clear();
            registry.entries.values().cloned().collect()
        };
        for entry in entries {
            let mut state = entry.lock()?;
            if let Some(mut live) = state.live.take() {
                let _ = live.killer.kill();
            }
            state.attachments.clear();
            entry.flow.notify_all();
        }
        Ok(())
    }
}

fn read_output(
    entry: &Entry,
    generation: u64,
    mut reader: Box<dyn Read + Send>,
    done: mpsc::Sender<()>,
) {
    let mut decoder = Utf8Stream::default();
    let mut buffer = vec![0u8; READ_CHUNK];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            // EIO once the last slave handle closes on Linux; a closed pipe on Windows.
            Err(_) => break,
        };
        let text = decoder.push(&buffer[..count]);
        if text.is_empty() {
            continue;
        }
        let Ok(mut state) = entry.state.lock() else {
            break;
        };
        if state.generation != generation {
            break;
        }
        state.replay.push(&text);
        state.broadcast_output(&text);
        while state.generation == generation && state.backlogged() {
            state = match entry.flow.wait(state) {
                Ok(state) => state,
                Err(_) => return,
            };
        }
    }
    let _ = done.send(());
}

fn wait_for_exit(
    entry: &Entry,
    generation: u64,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    drained: mpsc::Receiver<()>,
) {
    let status = child.wait();
    // Let the last output arrive before reporting the exit. ConPTY may not end
    // the stream until the pseudoconsole closes, so this is bounded.
    let _ = drained.recv_timeout(DRAIN_GRACE);
    let Ok(mut state) = entry.state.lock() else {
        return;
    };
    if state.generation != generation {
        return;
    }
    // Closing the master releases the pseudoconsole and its handles.
    state.live = None;
    let terminated = state.kill_requested;
    let Some(session) = state.session.as_mut() else {
        return;
    };
    session.status = TerminalStatus::Exited;
    session.ended_at = Some(crate::runtime::now());
    session.terminated = terminated;
    match status {
        Ok(status) => {
            session.exit_signal = status.signal().map(str::to_string);
            session.exit_code = Some(status.exit_code());
        }
        Err(_) => session.exit_code = None,
    }
    let ended = session.clone();
    state.broadcast(|| TerminalEvent::Session {
        terminal: ended.clone(),
    });
    entry.flow.notify_all();
}
