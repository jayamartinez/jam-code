//! Terminal sessions against real pseudo-terminals.
//!
//! Tests start `/bin/sh` (or `cmd.exe`) rather than the user's shell so they
//! never depend on a personal shell configuration.
#[cfg(unix)]
use jam_runtime::terminal::HIGH_WATER;
use jam_runtime::{
    JamError, Runtime,
    protocol::Request,
    terminal::{ShellSpec, TerminalEvent, TerminalSession, TerminalStatus},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, mpsc},
    time::{Duration, Instant},
};

struct TestDatabase(PathBuf);
impl TestDatabase {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("jam-terminal-{}.sqlite", uuid::Uuid::new_v4())))
    }
    fn open(&self) -> Arc<Runtime> {
        let runtime = Runtime::open_demo(&self.0).expect("open test database");
        runtime
            .set_terminal_shell(Some(test_shell()))
            .expect("choose the test shell");
        runtime
    }
}
impl Drop for TestDatabase {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}

#[cfg(unix)]
fn test_shell() -> ShellSpec {
    ShellSpec::new("/bin/sh", Vec::<String>::new())
}
#[cfg(windows)]
fn test_shell() -> ShellSpec {
    ShellSpec::new("cmd.exe", ["/Q"])
}

const PROJECT: &str = "project-jam";
const WAIT: Duration = Duration::from_secs(10);

fn call(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, JamError> {
    runtime.request(Request {
        protocol_version: 1,
        method: method.into(),
        params,
    })
}

fn request(runtime: &Arc<Runtime>, method: &str, params: Value) -> Value {
    call(runtime, method, params).unwrap_or_else(|error| panic!("{method}: {error}"))
}

fn session(value: &Value) -> TerminalSession {
    serde_json::from_value(value["terminal"].clone())
        .unwrap_or_else(|error| panic!("expected a terminal in {value}: {error}"))
}

fn create(runtime: &Arc<Runtime>) -> (String, TerminalSession) {
    let created = request(runtime, "terminal.create", json!({ "projectId": PROJECT }));
    let resource = created["resource"]["id"].as_str().unwrap().to_string();
    assert_eq!(created["resource"]["kind"], "terminal");
    (resource, session(&created))
}

/// A view: every event the runtime delivers to one attachment.
struct View {
    id: String,
    events: mpsc::Receiver<TerminalEvent>,
    output: String,
    last_seq: u64,
}

impl View {
    fn attach(runtime: &Arc<Runtime>, resource: &str) -> Self {
        let (sender, events) = mpsc::channel();
        let id = runtime
            .attach_terminal(resource, Box::new(move |event| sender.send(event).is_ok()))
            .expect("attach");
        let mut view = Self {
            id,
            events,
            output: String::new(),
            last_seq: 0,
        };
        match view.next().expect("a snapshot arrives first") {
            TerminalEvent::Snapshot {
                attachment_id,
                data,
                ..
            } => {
                assert_eq!(attachment_id, view.id);
                view.output = data;
            }
            other => panic!("expected a snapshot, got {other:?}"),
        }
        view
    }

    fn next(&mut self) -> Option<TerminalEvent> {
        self.events.recv_timeout(WAIT).ok()
    }

    /// Reads events until `done` holds, returning the last session update.
    fn until(
        &mut self,
        what: &str,
        done: impl Fn(&str, Option<&TerminalSession>) -> bool,
    ) -> Option<TerminalSession> {
        let deadline = Instant::now() + WAIT;
        let mut latest = None;
        while !done(&self.output, latest.as_ref()) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.events.recv_timeout(remaining) {
                Ok(TerminalEvent::Output { seq, data }) => {
                    assert_eq!(seq, self.last_seq + 1, "output is delivered in order");
                    self.last_seq = seq;
                    self.output.push_str(&data);
                }
                Ok(TerminalEvent::Session { terminal }) => latest = Some(terminal),
                Ok(TerminalEvent::Snapshot { .. }) => panic!("only one snapshot per attachment"),
                Err(_) => panic!(
                    "timed out waiting for {what}; output so far: {:?}",
                    self.output
                ),
            }
        }
        latest
    }

    fn contains(&mut self, text: &str) {
        self.until(text, |output, _| output.contains(text));
    }

    fn exit(&mut self) -> TerminalSession {
        self.until("exit", |_, session| {
            session.is_some_and(|session| session.status == TerminalStatus::Exited)
        })
        .expect("an exit update")
    }
}

fn input(runtime: &Arc<Runtime>, resource: &str, data: &str) {
    request(
        runtime,
        "terminal.input",
        json!({ "resourceId": resource, "data": data }),
    );
}

#[test]
fn no_terminal_runs_until_one_is_created() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let listed = request(&runtime, "terminal.list", json!({}));
    assert_eq!(listed["terminals"], json!([]));
}

#[test]
fn several_terminals_are_independent() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (a, first) = create(&runtime);
    let (b, second) = create(&runtime);
    let (c, _) = create(&runtime);
    assert!(
        a != b && b != c && a != c,
        "each terminal is its own resource"
    );
    assert_ne!(first.id, second.id, "and its own session");
    assert_eq!(first.status, TerminalStatus::Running);
    assert_eq!(first.project_id, PROJECT);
    // The demo project records no folder, so its terminals start at home.
    assert_eq!(first.cwd_source, jam_runtime::terminal::CwdSource::Home);
    assert_eq!(first.cwd_label, "~");

    let listed = request(&runtime, "terminal.list", json!({ "projectId": PROJECT }));
    assert_eq!(listed["terminals"].as_array().unwrap().len(), 3);
    // Resources persist like any other; sessions belong to the running runtime.
    let workspace = request(&runtime, "workspace.get", json!({}));
    let kinds = workspace["resources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|resource| [&a, &b, &c].iter().any(|id| resource["id"] == ***id))
        .count();
    assert_eq!(kinds, 3);

    // Running terminals are told apart by name; the resource carries it too.
    let titles: Vec<_> = listed["terminals"]
        .as_array()
        .unwrap()
        .iter()
        .map(|terminal| terminal["title"].as_str().unwrap().to_string())
        .collect();
    let shell = &first.shell;
    assert_eq!(
        titles,
        [shell.clone(), format!("{shell} 2"), format!("{shell} 3")]
    );

    request(&runtime, "terminal.kill", json!({ "resourceId": b }));
    let mut view = View::attach(&runtime, &b);
    assert!(
        view.exit().terminated,
        "an explicit kill is reported as such"
    );
    let running = request(&runtime, "terminal.get", json!({ "resourceId": a }));
    assert_eq!(
        running["terminal"]["status"], "running",
        "killing B leaves A alone"
    );
}

#[cfg(unix)]
#[test]
fn input_reaches_the_shell_and_output_reaches_views() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, _) = create(&runtime);
    let mut view = View::attach(&runtime, &terminal);
    // The marker is assembled by the shell, so the echoed command cannot match it.
    input(&runtime, &terminal, "printf 'jam_%s\\n' 42\n");
    view.contains("jam_42");
    input(
        &runtime,
        &terminal,
        "printf '\\033[31mred\\033[0m \\342\\206\\222 done\\n'\n",
    );
    view.contains("\u{1b}[31mred\u{1b}[0m → done");
}

#[cfg(unix)]
#[test]
fn resizing_changes_the_pty_size() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, created) = create(&runtime);
    assert_eq!((created.cols, created.rows), (80, 24));
    let mut view = View::attach(&runtime, &terminal);
    let resized = request(
        &runtime,
        "terminal.resize",
        json!({ "resourceId": terminal, "cols": 132, "rows": 41 }),
    );
    assert_eq!(resized["terminal"]["cols"], 132);
    input(&runtime, &terminal, "stty size\n");
    view.contains("41 132");
    for (cols, rows) in [(1, 10), (80, 0), (1001, 10), (80, 501)] {
        let error = call(
            &runtime,
            "terminal.resize",
            json!({ "resourceId": terminal, "cols": cols, "rows": rows }),
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_request");
    }
}

#[cfg(unix)]
#[test]
fn detaching_a_view_leaves_the_shell_running_and_reattaching_replays() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, created) = create(&runtime);
    let mut first = View::attach(&runtime, &terminal);
    input(&runtime, &terminal, "printf 'before_%s\\n' close\n");
    first.contains("before_close");
    runtime.detach_terminal(&first.id).unwrap();
    // The pane is gone; the shell is not.
    input(&runtime, &terminal, "printf 'while_%s\\n' hidden\n");
    std::thread::sleep(Duration::from_millis(200));
    let listed = request(&runtime, "terminal.get", json!({ "resourceId": terminal }));
    assert_eq!(listed["terminal"]["status"], "running");
    assert_eq!(
        listed["terminal"]["id"],
        created.id.as_str(),
        "same session"
    );

    let mut second = View::attach(&runtime, &terminal);
    second.contains("while_hidden");
    assert!(
        second.output.contains("before_close"),
        "recent output is replayed"
    );

    // A window reload detaches every view and still ends nothing.
    runtime.detach_clients().unwrap();
    input(&runtime, &terminal, "printf 'after_%s\\n' reload\n");
    let mut third = View::attach(&runtime, &terminal);
    third.contains("after_reload");
}

#[cfg(unix)]
#[test]
fn two_views_of_one_terminal_see_the_same_output() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, _) = create(&runtime);
    let mut left = View::attach(&runtime, &terminal);
    let mut right = View::attach(&runtime, &terminal);
    input(&runtime, &terminal, "printf 'both_%s\\n' views\n");
    left.contains("both_views");
    right.contains("both_views");
}

#[cfg(unix)]
#[test]
fn a_shell_that_exits_reports_its_status_and_can_restart() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, created) = create(&runtime);
    let mut view = View::attach(&runtime, &terminal);
    input(&runtime, &terminal, "exit 3\n");
    let ended = view.exit();
    assert_eq!(ended.exit_code, Some(3));
    assert!(!ended.terminated, "the shell exited by itself");
    assert!(ended.ended_at.is_some());
    let error = call(
        &runtime,
        "terminal.input",
        json!({ "resourceId": terminal, "data": "x" }),
    )
    .unwrap_err();
    assert_eq!(error.code, "conflict");

    // The resource outlives its shell and can start a new one.
    let restarted = request(
        &runtime,
        "terminal.start",
        json!({ "resourceId": terminal, "cols": 100, "rows": 30 }),
    );
    let restarted = session(&restarted);
    assert_ne!(restarted.id, created.id);
    assert_eq!(restarted.status, TerminalStatus::Running);
    let update = view.until("restart", |_, session| session.is_some());
    assert_eq!(
        update.unwrap().id,
        restarted.id,
        "attached views learn of the restart"
    );
    let error = call(
        &runtime,
        "terminal.start",
        json!({ "resourceId": terminal }),
    )
    .unwrap_err();
    assert_eq!(
        error.code, "conflict",
        "a running terminal is not started twice"
    );
}

#[cfg(unix)]
#[test]
fn explicit_termination_ends_the_shell_and_its_foreground_job() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, _) = create(&runtime);
    let mut view = View::attach(&runtime, &terminal);
    input(&runtime, &terminal, "sleep 300; printf 'sle%s\\n' pt\n");
    std::thread::sleep(Duration::from_millis(200));
    request(&runtime, "terminal.kill", json!({ "resourceId": terminal }));
    let ended = view.exit();
    assert!(ended.exit_signal.is_some() || ended.exit_code.is_some());
    assert!(!view.output.contains("slept"));
    let error = call(&runtime, "terminal.kill", json!({ "resourceId": terminal })).unwrap_err();
    assert_eq!(error.code, "conflict");
}

#[cfg(windows)]
#[test]
fn explicit_termination_is_reported_as_terminated_on_windows() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, _) = create(&runtime);
    let mut view = View::attach(&runtime, &terminal);
    // ConPTY asks for the cursor position before the shell's first output;
    // answer as xterm does in the app.
    view.contains("\u{1b}[6n");
    input(&runtime, &terminal, "\u{1b}[1;1R");
    input(&runtime, &terminal, "echo ready\r\n");
    view.contains("ready");
    request(&runtime, "terminal.kill", json!({ "resourceId": terminal }));
    let ended = view.exit();
    assert!(ended.terminated, "an explicit kill is not a plain exit");
}

#[cfg(unix)]
#[test]
fn ctrl_c_interrupts_the_foreground_program_not_the_shell() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, _) = create(&runtime);
    let mut view = View::attach(&runtime, &terminal);
    input(&runtime, &terminal, "sleep 300\n");
    std::thread::sleep(Duration::from_millis(300));
    input(&runtime, &terminal, "\u{3}");
    input(&runtime, &terminal, "printf 'still_%s\\n' here\n");
    view.contains("still_here");
    let current = request(&runtime, "terminal.get", json!({ "resourceId": terminal }));
    assert_eq!(current["terminal"]["status"], "running");
}

#[cfg(unix)]
#[test]
fn a_requested_working_directory_is_used() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let directory = std::env::temp_dir().canonicalize().unwrap();
    let created = request(
        &runtime,
        "terminal.create",
        json!({ "projectId": PROJECT, "cwd": directory.display().to_string() }),
    );
    let terminal = created["resource"]["id"].as_str().unwrap().to_string();
    assert_eq!(created["terminal"]["cwdSource"], "requested");
    let mut view = View::attach(&runtime, &terminal);
    input(&runtime, &terminal, "pwd -P\n");
    view.contains(&format!("{}\r\n", directory.display()));
}

#[cfg(unix)]
#[test]
fn output_pauses_for_a_view_that_does_not_acknowledge() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (terminal, _) = create(&runtime);
    let mut view = View::attach(&runtime, &terminal);
    let total = 2 * 1024 * 1024;
    input(
        &runtime,
        &terminal,
        &format!("head -c {total} /dev/zero | tr '\\000' x; printf '\\nflood_%s\\n' done\n"),
    );
    // Without acknowledgements, delivery stops near the high-water mark.
    std::thread::sleep(Duration::from_millis(1500));
    while let Ok(TerminalEvent::Output { seq, data }) = view.events.try_recv() {
        view.last_seq = seq;
        view.output.push_str(&data);
    }
    let unacknowledged = view.output.len();
    assert!(
        unacknowledged <= HIGH_WATER + 64 * 1024,
        "{unacknowledged} bytes arrived without acknowledgement"
    );
    assert!(!view.output.contains("flood_done"));
    // Acknowledging as it renders lets the rest through.
    let deadline = Instant::now() + WAIT;
    while !view.output.contains("flood_done") {
        assert!(Instant::now() < deadline, "the flood did not finish");
        request(
            &runtime,
            "terminal.ack",
            json!({ "attachmentId": view.id, "seq": view.last_seq }),
        );
        if let Ok(TerminalEvent::Output { seq, data }) =
            view.events.recv_timeout(Duration::from_millis(200))
        {
            view.last_seq = seq;
            view.output.push_str(&data);
        }
    }
    assert!(view.output.matches('x').count() >= total);
}

#[cfg(unix)]
#[test]
fn quitting_ends_every_shell() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let (a, _) = create(&runtime);
    let (b, _) = create(&runtime);
    let mut views = [View::attach(&runtime, &a), View::attach(&runtime, &b)];
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(runtime.shutdown())
        .unwrap();
    // Requests are refused once shutdown begins.
    let error = call(&runtime, "terminal.get", json!({ "resourceId": a })).unwrap_err();
    assert_eq!(error.code, "unavailable");
    let _ = b;
    for view in &mut views {
        // The sink was dropped: the channel disconnects rather than timing out.
        while view.events.recv_timeout(WAIT).is_ok() {}
    }
}

#[test]
fn invalid_terminal_requests_fail_before_doing_anything() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let cases = [
        (
            "terminal.create",
            json!({ "projectId": "missing" }),
            "not_found",
        ),
        (
            "terminal.create",
            json!({ "projectId": PROJECT, "cwd": "relative/path" }),
            "invalid_request",
        ),
        (
            "terminal.create",
            json!({ "projectId": PROJECT, "cwd": "/definitely/not/a/folder/jam" }),
            "invalid_request",
        ),
        (
            "terminal.create",
            json!({ "projectId": PROJECT, "cols": 0 }),
            "invalid_request",
        ),
        (
            "terminal.create",
            json!({ "projectId": PROJECT, "shell": "/bin/sh" }),
            "invalid_request",
        ),
        (
            "terminal.get",
            json!({ "resourceId": "conv-pane-lifetime" }),
            "invalid_request",
        ),
        (
            "terminal.get",
            json!({ "resourceId": "missing" }),
            "not_found",
        ),
        (
            "terminal.input",
            json!({ "resourceId": "terminal-pane", "data": "" }),
            "invalid_request",
        ),
        (
            "terminal.input",
            json!({ "resourceId": "terminal-pane", "data": "x".repeat(65_537) }),
            "invalid_request",
        ),
        // A stored terminal whose shell is not running.
        (
            "terminal.input",
            json!({ "resourceId": "terminal-pane", "data": "x" }),
            "conflict",
        ),
        (
            "terminal.kill",
            json!({ "resourceId": "terminal-pane" }),
            "conflict",
        ),
        ("terminal.unknown", json!({}), "unknown_method"),
    ];
    for (method, params, code) in cases {
        let error = call(&runtime, method, params.clone()).unwrap_err();
        assert_eq!(error.code, code, "{method} {params}");
    }
    let attach = runtime.attach_terminal("conv-pane-lifetime", Box::new(|_| true));
    assert_eq!(attach.unwrap_err().code, "invalid_request");
    assert_eq!(
        request(&runtime, "terminal.list", json!({}))["terminals"],
        json!([]),
        "no failed request started a shell"
    );
}

#[test]
fn a_stored_terminal_without_a_shell_can_be_attached_and_started() {
    let database = TestDatabase::new();
    let runtime = database.open();
    // The demo seed includes a terminal resource that has never run.
    let (sender, events) = mpsc::channel();
    runtime
        .attach_terminal(
            "terminal-pane",
            Box::new(move |event| sender.send(event).is_ok()),
        )
        .unwrap();
    match events.recv_timeout(WAIT).unwrap() {
        TerminalEvent::Snapshot { terminal, data, .. } => {
            assert!(terminal.is_none(), "no shell is invented for it");
            assert!(data.is_empty());
        }
        other => panic!("expected a snapshot, got {other:?}"),
    }
    let started = request(
        &runtime,
        "terminal.start",
        json!({ "resourceId": "terminal-pane" }),
    );
    assert_eq!(started["terminal"]["status"], "running");
    match events.recv_timeout(WAIT).unwrap() {
        TerminalEvent::Session { terminal } => assert_eq!(terminal.status, TerminalStatus::Running),
        other => panic!("expected the start, got {other:?}"),
    }
    request(
        &runtime,
        "terminal.kill",
        json!({ "resourceId": "terminal-pane" }),
    );
}
