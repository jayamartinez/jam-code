//! Claude Code through its documented stream-json stdio interface: the same
//! control protocol the official Agent SDK uses when it runs the CLI.
//!
//! JAM runs the user's own, unmodified `claude` executable. Claude Code owns
//! sign-in, credentials, models and tool execution; JAM never reads, copies
//! or stores Claude credentials, never passes `--bare`, and never sets an
//! authentication environment variable. Each JAM session keeps one Claude
//! process while it is in use; it is resumed by Claude's session ID after an
//! idle stop, a crash or a restart.
mod tools;

use super::{
    Answer, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
    ProviderUpdate, Transcript, TurnIo, access, descriptor, discovery,
    process::{LaunchSpec, Output, StdioChild},
    set_capability,
    transcript::until,
};
use crate::{
    error::JamError,
    protocol::{
        InteractionStatus, MessageBlock, OptionValue, ProviderAccount, ProviderDescriptor,
        ProviderModel, ProviderOption, ProviderStatus, SessionStatus, SessionUsage,
    },
    runtime::new_id,
};
use base64::Engine;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::mpsc;

const NAME: &str = "Claude Code";
/// The CLI version this adapter was written and tested against.
const TESTED: &str = "2.1.283";
const IDLE_STOP: Duration = Duration::from_secs(15 * 60);
const INTERRUPT_GRACE: Duration = Duration::from_secs(6);
const START_DEADLINE: Duration = Duration::from_secs(30);

struct Process {
    child: StdioChild,
    lines: tokio::sync::Mutex<mpsc::Receiver<Output>>,
    native_id: String,
    effort: Option<String>,
    auto_compact: bool,
    model: Mutex<Option<String>>,
    mode: Mutex<String>,
    next_request: AtomicU64,
}

impl Process {
    fn request_id(&self) -> String {
        format!("jam-{}", self.next_request.fetch_add(1, Ordering::Relaxed))
    }

    async fn control(&self, subtype: &str, extra: Value) -> Result<String, JamError> {
        let id = self.request_id();
        let mut request = json!({"subtype": subtype});
        if let (Some(request), Some(extra)) = (request.as_object_mut(), extra.as_object()) {
            request.extend(extra.clone());
        }
        self.child
            .send(&json!({"type": "control_request", "request_id": id, "request": request}))
            .await?;
        Ok(id)
    }
}

#[derive(Default)]
struct Inner {
    processes: Mutex<HashMap<String, Arc<Process>>>,
    generations: Mutex<HashMap<String, u64>>,
}

#[derive(Clone, Default)]
pub struct ClaudeAdapter {
    inner: Arc<Inner>,
}

fn options() -> Vec<ProviderOption> {
    let value = |value: &str, label: &str, description: &str| OptionValue {
        value: value.into(),
        label: label.into(),
        description: Some(description.into()),
    };
    vec![
        access::option(
            "Claude asks before tools its settings do not already allow.",
            "File edits are applied without asking; other tools still ask.",
            "Every tool runs without asking (Claude Code's bypass permissions mode).",
        ),
        ProviderOption {
            id: AUTO_COMPACT.into(),
            label: "Auto-compact".into(),
            description: Some(
                "Claude Code summarizes the conversation when its context fills.".into(),
            ),
            values: vec![
                value(
                    "on",
                    "On",
                    "Compact automatically when the context is nearly full.",
                ),
                value("off", "Off", "Only compact when you ask."),
            ],
            default: "on".into(),
        },
    ]
}

const AUTO_COMPACT: &str = "autoCompact";

/// Claude Code's permission mode for a JAM access level.
fn permission_mode(options: &std::collections::BTreeMap<String, String>) -> String {
    match access::chosen(options) {
        access::FULL => "bypassPermissions",
        access::EDITS => "acceptEdits",
        _ => "default",
    }
    .into()
}

fn auto_compact(options: &std::collections::BTreeMap<String, String>) -> bool {
    options.get(AUTO_COMPACT).map(String::as_str) != Some("off")
}

fn base_args(mode: &str) -> Vec<String> {
    [
        "--output-format",
        "stream-json",
        "--verbose",
        "--input-format",
        "stream-json",
        "--include-partial-messages",
        "--permission-prompt-tool",
        "stdio",
        "--permission-mode",
        mode,
    ]
    .into_iter()
    .map(str::to_owned)
    .collect()
}

fn missing(missing: discovery::Missing) -> JamError {
    match missing {
        discovery::Missing::InvalidOverride => JamError::new(
            "provider_unavailable",
            "The Claude Code executable set in Settings → Providers is not a runnable file.",
        ),
        discovery::Missing::NotFound => JamError::new(
            "provider_unavailable",
            "Claude Code is not installed or not on PATH. Install it, sign in with `claude`, then check again in Settings → Providers.",
        ),
    }
}

impl ClaudeAdapter {
    fn base(&self, config: &ProviderConfig) -> ProviderDescriptor {
        let mut d = descriptor(
            "claude",
            NAME,
            "unknown",
            "Claude Code has not been checked yet.",
        );
        d.executable_override = config.executable.clone();
        d.options = Some(options());
        d
    }

    fn take(&self, session_id: &str) -> Option<Arc<Process>> {
        self.inner.processes.lock().ok()?.remove(session_id)
    }

    fn keep(&self, session_id: &str, process: Arc<Process>) {
        if let Ok(mut processes) = self.inner.processes.lock() {
            processes.insert(session_id.to_string(), process);
        }
        let generation = {
            let Ok(mut generations) = self.inner.generations.lock() else {
                return;
            };
            let entry = generations.entry(session_id.to_string()).or_insert(0);
            *entry += 1;
            *entry
        };
        let inner = Arc::downgrade(&self.inner);
        let session_id = session_id.to_string();
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_STOP).await;
            let Some(inner) = inner.upgrade() else { return };
            let current = inner
                .generations
                .lock()
                .ok()
                .and_then(|g| g.get(&session_id).copied());
            if current == Some(generation)
                && let Some(process) = inner
                    .processes
                    .lock()
                    .ok()
                    .and_then(|mut p| p.remove(&session_id))
            {
                process.child.kill();
            }
        });
    }
}

impl ProviderAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn unchecked(&self, config: &ProviderConfig) -> ProviderDescriptor {
        self.base(config)
    }

    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let base = self.base(&config);
        Box::pin(async move { probe(base, config).await })
    }

    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        let adapter = self.clone();
        Box::pin(async move { run(&adapter, turn, io).await })
    }

    fn release(&self, session_id: &str) {
        if let Some(process) = self.take(session_id) {
            process.child.kill();
        }
    }

    fn shutdown(&self) {
        if let Ok(mut processes) = self.inner.processes.lock() {
            for (_, process) in processes.drain() {
                process.child.kill();
            }
        }
    }
}

/// `claude auth status` prints JSON and exits 0 when signed in, 1 when not.
/// Only these fields are read; account identifiers are never kept.
async fn auth_status(executable: &Path) -> Option<(bool, Value)> {
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new(executable)
            .args(["auth", "status"])
            .env("PATH", discovery::search_path())
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    let value: Value = serde_json::from_slice(&output.stdout).ok()?;
    let logged_in = value.get("loggedIn").and_then(Value::as_bool)?;
    let kept = json!({
        "authMethod": value.get("authMethod"),
        "apiProvider": value.get("apiProvider"),
        "subscriptionType": value.get("subscriptionType"),
    });
    Some((logged_in && output.status.success(), kept))
}

fn models_from(response: &Value) -> Vec<ProviderModel> {
    response
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| {
            let id = model.get("value").and_then(Value::as_str)?;
            Some(ProviderModel {
                id: id.into(),
                label: model
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .into(),
                description: model
                    .get("description")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                is_default: id == "default",
                efforts: if model.get("supportsEffort").and_then(Value::as_bool) == Some(true) {
                    model
                        .get("supportedEffortLevels")
                        .and_then(Value::as_array)
                        .map(|levels| {
                            levels
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default()
                } else {
                    Vec::new()
                },
                default_effort: None,
                // Claude Code accepts image blocks for every model it lists.
                images: Some("supported".into()),
            })
        })
        .collect()
}

async fn probe(mut d: ProviderDescriptor, config: ProviderConfig) -> ProviderDescriptor {
    let found = match discovery::locate(&["claude"], config.executable.as_deref()) {
        Ok(found) => found,
        Err(discovery::Missing::NotFound) => {
            d.installation = "missing".into();
            for key in crate::protocol::CAPABILITIES {
                set_capability(
                    &mut d,
                    key,
                    "unsupported",
                    Some("Claude Code is not installed."),
                );
            }
            return d;
        }
        Err(discovery::Missing::InvalidOverride) => {
            d.installation = "missing".into();
            d.status = Some(ProviderStatus {
                tone: "error".into(),
                message: "The executable set for Claude Code is not a runnable file.".into(),
            });
            return d;
        }
    };
    d.installation = "installed".into();
    d.executable = Some(found.path.display().to_string());
    d.executable_source = Some(
        match found.source {
            discovery::Source::Override => "override",
            discovery::Source::Detected => "detected",
        }
        .into(),
    );
    d.version = discovery::version(&found.path, &["--version"]).await;
    let mut notes = Vec::new();
    if let Some(version) = &d.version
        && !discovery::at_least(version, TESTED)
    {
        notes.push(format!(
            "Claude Code {version} is older than the version JAM was tested with ({TESTED})."
        ));
    }
    match auth_status(&found.path).await {
        Some((logged_in, status)) => {
            d.authentication = if logged_in {
                "authenticated"
            } else {
                "unauthenticated"
            }
            .into();
            if logged_in {
                d.account = Some(ProviderAccount {
                    method: match status.get("authMethod").and_then(Value::as_str) {
                        Some("claude.ai") => Some("Claude account".into()),
                        Some("none") | None => None,
                        Some(other) => Some(other.to_string()),
                    },
                    plan: status
                        .get("subscriptionType")
                        .and_then(Value::as_str)
                        .filter(|plan| !plan.is_empty())
                        .map(str::to_owned),
                });
            }
        }
        None => notes.push("Claude Code did not report its sign-in state.".into()),
    }
    if std::env::var_os("ANTHROPIC_API_KEY").is_some() {
        notes.push("ANTHROPIC_API_KEY is set in JAM's environment; Claude Code may use that key instead of your sign-in.".into());
    }
    // Model discovery through the control protocol's initialize request:
    // no user message is sent, so nothing is asked of the model.
    let mut args = base_args("default");
    args.extend(
        [
            "--strict-mcp-config",
            "--settings",
            r#"{"disableAllHooks":true}"#,
        ]
        .into_iter()
        .map(str::to_owned),
    );
    let spec = LaunchSpec::new(found.path.clone())
        .args(args)
        .cwd(Some(std::env::temp_dir()))
        .env("PATH", discovery::search_path());
    let mut models = Vec::new();
    if let Ok((child, mut lines)) = StdioChild::spawn(&spec) {
        let sent = child
            .send(&json!({"type": "control_request", "request_id": "jam-probe", "request": {"subtype": "initialize"}}))
            .await;
        if sent.is_ok() {
            let wait = async {
                while let Some(output) = lines.recv().await {
                    let Output::Line(line) = output else { continue };
                    let Ok(message) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };
                    if message.get("type").and_then(Value::as_str) == Some("control_response")
                        && message
                            .pointer("/response/request_id")
                            .and_then(Value::as_str)
                            == Some("jam-probe")
                    {
                        return message.pointer("/response/response").cloned();
                    }
                }
                None
            };
            if let Ok(Some(response)) = tokio::time::timeout(START_DEADLINE, wait).await {
                models = models_from(&response);
            }
        }
        child.kill();
    }
    let has_models = !models.is_empty();
    if has_models {
        d.models = Some(models);
    } else {
        notes.push("Claude Code did not list its models.".into());
    }
    notes.push("Runs your installed Claude Code with its own sign-in. JAM never reads Claude credentials; Anthropic's terms govern how a subscription may be used.".into());
    d.status = Some(ProviderStatus {
        tone: if notes.len() > 1 { "warning" } else { "info" }.into(),
        message: notes.join(" "),
    });
    for key in [
        "create",
        "resume",
        "interrupt",
        "streaming",
        "toolApproval",
        "userInput",
        "images",
        "permissionModes",
        "usage",
        "compact",
    ] {
        set_capability(&mut d, key, "supported", None);
    }
    for key in ["modelSelection", "effort"] {
        if has_models {
            set_capability(&mut d, key, "supported", None);
        } else {
            set_capability(
                &mut d,
                key,
                "unknown",
                Some("Claude Code did not list its models."),
            );
        }
    }
    set_capability(
        &mut d,
        "fork",
        "unsupported",
        Some("Claude Code can fork sessions; JAM does not offer forking yet."),
    );
    set_capability(
        &mut d,
        "steering",
        "unsupported",
        Some("JAM does not send messages into a running Claude turn yet."),
    );
    set_capability(
        &mut d,
        "queue",
        "unsupported",
        Some("Send after the current turn finishes."),
    );
    d
}

/// Starts a Claude process for a session and completes the initialize
/// handshake. Resumes `native_id` when given, otherwise starts a new session
/// with an ID JAM chose, so the provider ID is known before the first reply.
async fn spawn(
    executable: &Path,
    cwd: &Path,
    native_id: Option<&str>,
    turn: &ProviderTurn,
) -> Result<Arc<Process>, JamError> {
    let mode = permission_mode(&turn.options);
    let mut args = base_args(&mode);
    let compacts = auto_compact(&turn.options);
    if !compacts {
        // A per-session setting; the user's own settings files are untouched.
        args.extend([
            "--settings".into(),
            r#"{"autoCompactEnabled":false}"#.into(),
        ]);
    }
    let native = match native_id {
        Some(id) => {
            args.push(format!("--resume={id}"));
            id.to_string()
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            args.push(format!("--session-id={id}"));
            id
        }
    };
    let model = turn.options.get("model").cloned();
    if let Some(model) = &model {
        args.extend(["--model".into(), model.clone()]);
    }
    let effort = turn.options.get("effort").cloned();
    if let Some(effort) = &effort {
        args.extend(["--effort".into(), effort.clone()]);
    }
    let spec = LaunchSpec::new(executable.to_path_buf())
        .args(args)
        .cwd(Some(cwd.to_path_buf()))
        .env("PATH", discovery::search_path());
    let (child, mut lines) = StdioChild::spawn(&spec)?;
    child
        .send(&json!({"type": "control_request", "request_id": "jam-init", "request": {"subtype": "initialize"}}))
        .await?;
    let ready = async {
        while let Some(output) = lines.recv().await {
            let Output::Line(line) = output else { continue };
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if message.get("type").and_then(Value::as_str) == Some("control_response")
                && message
                    .pointer("/response/request_id")
                    .and_then(Value::as_str)
                    == Some("jam-init")
            {
                return message.pointer("/response/subtype").and_then(Value::as_str)
                    == Some("success");
            }
        }
        false
    };
    let ok = tokio::time::timeout(START_DEADLINE, ready)
        .await
        .unwrap_or(false);
    if !ok {
        let detail = child.stderr_summary();
        child.kill();
        return Err(JamError::new(
            "provider_error",
            match detail {
                Some(detail) => format!(
                    "Claude Code did not start: {}",
                    super::bounded(&super::plain(&detail), 300)
                ),
                None => "Claude Code did not start.".into(),
            },
        ));
    }
    Ok(Arc::new(Process {
        child,
        lines: tokio::sync::Mutex::new(lines),
        native_id: native,
        effort,
        auto_compact: compacts,
        model: Mutex::new(model),
        mode: Mutex::new(mode),
        next_request: AtomicU64::new(1),
    }))
}

struct ToolCall {
    id: String,
    name: String,
    json: String,
}

async fn run(adapter: &ClaudeAdapter, turn: ProviderTurn, io: TurnIo) -> Result<(), JamError> {
    let TurnIo {
        updates,
        mut cancelled,
        interactions,
    } = io;
    let mut transcript = Transcript::new(updates);
    let Some(cwd) = turn.cwd.clone() else {
        return Err(JamError::invalid(
            "Add a folder to this project before starting a Claude Code chat.",
        ));
    };
    let executable = discovery::locate(&["claude"], turn.config.executable.as_deref())
        .map_err(missing)?
        .path;

    // Reuse this session's process when it is alive and compatible.
    let existing = adapter.take(&turn.session_id).filter(|p| {
        p.child.exited().is_none()
            && Some(&p.native_id) == turn.native_id.as_ref()
            && p.effort == turn.options.get("effort").cloned()
            && p.auto_compact == auto_compact(&turn.options)
    });
    if existing.is_none()
        && let Some(stale) = adapter.take(&turn.session_id)
    {
        stale.child.kill();
    }
    let process = match existing {
        Some(process) => {
            let model = turn.options.get("model").cloned();
            if *process.model.lock().expect("model lock") != model
                && let Some(model) = &model
            {
                process
                    .control("set_model", json!({"model": model}))
                    .await?;
                *process.model.lock().expect("model lock") = Some(model.clone());
            }
            let mode = permission_mode(&turn.options);
            if *process.mode.lock().expect("mode lock") != mode {
                process
                    .control("set_permission_mode", json!({"mode": mode}))
                    .await?;
                *process.mode.lock().expect("mode lock") = mode;
            }
            process
        }
        None => match spawn(&executable, &cwd, turn.native_id.as_deref(), &turn).await {
            Ok(process) => process,
            Err(error) if turn.native_id.is_some() => {
                // The earlier session may be gone from Claude's own history.
                transcript.notice(
                    "warning",
                    &format!(
                        "Claude Code could not resume this chat's earlier session, so this turn started a new one without that history. ({})",
                        error.message
                    ),
                );
                spawn(&executable, &cwd, None, &turn).await?
            }
            Err(error) => return Err(error),
        },
    };
    transcript
        .send(ProviderUpdate::Native(process.native_id.clone()))
        .await;

    // Images first: Claude Code treats a message as a command only when its
    // last block is text.
    let mut content: Vec<Value> = turn
        .images
        .iter()
        .map(|image| {
            json!({"type": "image", "source": {
                "type": "base64",
                "media_type": image.media_type,
                "data": base64::engine::general_purpose::STANDARD.encode(image.bytes.as_slice()),
            }})
        })
        .collect();
    if turn.compact {
        content.clear();
        content.push(json!({"type": "text", "text": "/compact"}));
    } else {
        content.push(json!({"type": "text", "text": turn.text}));
    }
    let message_uuid = uuid::Uuid::new_v4().to_string();
    process
        .child
        .send(&json!({
            "type": "user",
            "session_id": "",
            "parent_tool_use_id": null,
            "uuid": message_uuid,
            "message": {"role": "user", "content": content},
        }))
        .await?;
    if turn.compact {
        transcript.compacting();
        transcript.flush().await;
    }

    let mut lines = process.lines.lock().await;
    let cwd_ref = Some(cwd.as_path());
    let mut streamed: HashSet<String> = HashSet::new();
    let mut backfill: HashMap<String, usize> = HashMap::new();
    let mut message_id = String::new();
    let mut tool_calls: HashMap<i64, ToolCall> = HashMap::new();
    let mut tool_kinds: HashMap<String, String> = HashMap::new();
    let mut asked: HashMap<String, (String, Value)> = HashMap::new();
    let mut by_request: HashMap<String, String> = HashMap::new();
    let (answers_tx, mut answers) = mpsc::channel::<(String, Answer)>(16);
    let mut interrupting = false;
    let mut interrupt_deadline: Option<tokio::time::Instant> = None;
    let mut context_tokens: Option<u64> = None;
    let mut model_name: Option<String> = None;
    let mut retry_noted = false;

    let outcome = loop {
        tokio::select! {
            biased;
            changed = cancelled.changed(), if !interrupting => {
                if changed.is_err() || *cancelled.borrow() {
                    interrupting = true;
                    interrupt_deadline = Some(tokio::time::Instant::now() + INTERRUPT_GRACE);
                    for (id, (request_id, _)) in asked.drain() {
                        interactions.withdraw(&id);
                        let _ = process.child.send(&control_success(&request_id, json!({"behavior": "deny", "message": "The turn was interrupted.", "interrupt": true}))).await;
                    }
                    let _ = process.control("interrupt", json!({})).await;
                }
            }
            _ = until(interrupt_deadline), if interrupting => {
                // Claude did not settle after the interrupt; end the process.
                // The next turn resumes the session by its ID.
                process.child.kill();
                break SessionStatus::Interrupted;
            }
            Some((interaction_id, answer)) = answers.recv() => {
                if let Some((request_id, request)) = asked.remove(&interaction_id) {
                    let (response, outcome) = tools::permission_response(&request, &answer);
                    let sent = process.child.send(&control_success(&request_id, response)).await.is_ok();
                    transcript.update_interaction(&interaction_id, |i| {
                        i.status = if sent { InteractionStatus::Resolved } else { InteractionStatus::Expired };
                        i.outcome = Some(outcome);
                    });
                    transcript.flush().await;
                }
            }
            output = lines.recv() => {
                let Some(output) = output else {
                    let detail = process.child.stderr_summary().map(|s| format!(" ({})", super::plain(&s))).unwrap_or_default();
                    transcript.settle("Claude Code exited");
                    transcript.notice("error", &format!("Claude Code exited unexpectedly{detail}. Send again to resume this chat."));
                    break if interrupting { SessionStatus::Interrupted } else { SessionStatus::Failed };
                };
                let Output::Line(line) = output else { continue };
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                let subagent = message.get("parent_tool_use_id").is_some_and(|p| !p.is_null());
                match message.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "stream_event" if !subagent => {
                        let event = message.get("event").cloned().unwrap_or(Value::Null);
                        let index = event.get("index").and_then(Value::as_i64).unwrap_or(0);
                        match event.get("type").and_then(Value::as_str).unwrap_or_default() {
                            "message_start" => {
                                message_id = event.pointer("/message/id").and_then(Value::as_str).unwrap_or_default().to_string();
                                streamed.insert(message_id.clone());
                                tool_calls.clear();
                                if let Some(usage) = event.pointer("/message/usage") {
                                    let n = |k: &str| usage.get(k).and_then(Value::as_u64).unwrap_or(0);
                                    context_tokens = Some(n("input_tokens") + n("cache_creation_input_tokens") + n("cache_read_input_tokens"));
                                }
                            }
                            "content_block_start" => {
                                let block = event.get("content_block").cloned().unwrap_or(Value::Null);
                                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                                    let id = block.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
                                    let tool = tools::tool_block(&id, &name, &json!({}), "running", cwd_ref);
                                    if let MessageBlock::Tool { kind, .. } = &tool { tool_kinds.insert(id.clone(), kind.clone()); }
                                    if !transcript.contains(&id) && !tools::hidden(&name) { transcript.upsert(&id, tool); }
                                    tool_calls.insert(index, ToolCall { id, name, json: String::new() });
                                }
                            }
                            "content_block_delta" => {
                                let delta = event.get("delta").cloned().unwrap_or(Value::Null);
                                let key = format!("{message_id}:{index}");
                                match delta.get("type").and_then(Value::as_str).unwrap_or_default() {
                                    "text_delta" => transcript.append(&key, false, delta.get("text").and_then(Value::as_str).unwrap_or_default()),
                                    "thinking_delta" => transcript.append(&key, true, delta.get("thinking").and_then(Value::as_str).unwrap_or_default()),
                                    "input_json_delta" => {
                                        if let Some(call) = tool_calls.get_mut(&index)
                                            && call.json.len() < 1_000_000
                                        {
                                            call.json.push_str(delta.get("partial_json").and_then(Value::as_str).unwrap_or_default());
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            "content_block_stop" => {
                                if let Some(call) = tool_calls.remove(&index)
                                    && let Ok(input) = serde_json::from_str::<Value>(&call.json)
                                {
                                    update_tool_input(&mut transcript, &call.id, &call.name, &input, cwd_ref);
                                }
                            }
                            _ => {}
                        }
                    }
                    "assistant" if !subagent => {
                        let id = message.pointer("/message/id").and_then(Value::as_str).unwrap_or_default().to_string();
                        if let Some(model) = message.pointer("/message/model").and_then(Value::as_str)
                            && model_name.as_deref() != Some(model)
                        {
                            model_name = Some(model.to_string());
                            transcript.send(ProviderUpdate::Model(model.to_string())).await;
                        }
                        for block in message.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                            match block.get("type").and_then(Value::as_str).unwrap_or_default() {
                                // Deltas are primary; a complete block only fills in a
                                // message whose deltas never arrived.
                                kind @ ("text" | "thinking") if !streamed.contains(&id) => {
                                    let n = backfill.entry(id.clone()).or_insert(0);
                                    let key = format!("{id}:b{n}");
                                    *n += 1;
                                    let text = block.get(kind).and_then(Value::as_str).unwrap_or_default();
                                    if !text.is_empty() { transcript.set_text(&key, kind == "thinking", text); }
                                }
                                "tool_use" => {
                                    let tool_id = block.get("id").and_then(Value::as_str).unwrap_or_default();
                                    let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
                                    let input = block.get("input").cloned().unwrap_or(json!({}));
                                    update_tool_input(&mut transcript, tool_id, name, &input, cwd_ref);
                                    if let Some(MessageBlock::Tool { kind, .. }) = transcript.get_mut(tool_id) {
                                        tool_kinds.insert(tool_id.to_string(), kind.clone());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    "user" if !subagent && message.get("isReplay").and_then(Value::as_bool) != Some(true) => {
                        for block in message.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                            if block.get("type").and_then(Value::as_str) != Some("tool_result") { continue; }
                            let tool_id = block.get("tool_use_id").and_then(Value::as_str).unwrap_or_default();
                            let failed = block.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                            let output = tools::result_text(block.get("content"));
                            let shows = tool_kinds.get(tool_id).is_some_and(|k| tools::shows_output(k));
                            if let Some(MessageBlock::Tool { status, detail, .. }) = transcript.get_mut(tool_id) {
                                *status = if failed { "failed" } else { "completed" }.into();
                                if shows || failed {
                                    *detail = if detail.is_empty() { output } else { format!("{detail}\n{output}") };
                                }
                            }
                        }
                    }
                    "system" => match message.get("subtype").and_then(Value::as_str).unwrap_or_default() {
                        "init" => {
                            if let Some(model) = message.get("model").and_then(Value::as_str) {
                                model_name = Some(model.to_string());
                                transcript.send(ProviderUpdate::Model(model.to_string())).await;
                            }
                        }
                        "compact_boundary" => transcript.compacted("Claude Code compacted this conversation's context."),
                        "api_retry" if !retry_noted => {
                            retry_noted = true;
                            transcript.notice("info", "Claude Code is retrying a request.");
                        }
                        _ => {}
                    },
                    "control_request" => {
                        let request_id = message.get("request_id").and_then(Value::as_str).unwrap_or_default().to_string();
                        let request = message.get("request").cloned().unwrap_or(Value::Null);
                        if request.get("subtype").and_then(Value::as_str) == Some("can_use_tool") && !interrupting {
                            if by_request.contains_key(&request_id) { continue; }
                            let interaction = tools::permission(new_id("interaction"), &request, cwd_ref);
                            let receiver = interactions.open(&turn.session_id, &interaction)?;
                            by_request.insert(request_id.clone(), interaction.id.clone());
                            asked.insert(interaction.id.clone(), (request_id, request));
                            let interaction_id = interaction.id.clone();
                            transcript.interaction(interaction);
                            transcript.flush().await;
                            let answers_tx = answers_tx.clone();
                            tokio::spawn(async move {
                                if let Ok(answer) = receiver.await {
                                    let _ = answers_tx.send((interaction_id, answer)).await;
                                }
                            });
                        } else {
                            let _ = process.child.send(&json!({"type": "control_response", "response": {
                                "subtype": "error", "request_id": request_id,
                                "error": "JAM does not support this request."
                            }})).await;
                        }
                    }
                    "control_cancel_request" => {
                        let request_id = message.get("request_id").and_then(Value::as_str).unwrap_or_default();
                        if let Some(interaction_id) = by_request.remove(request_id)
                            && asked.remove(&interaction_id).is_some()
                        {
                            interactions.withdraw(&interaction_id);
                            transcript.update_interaction(&interaction_id, |i| {
                                i.status = InteractionStatus::Cancelled;
                                i.outcome = Some("Withdrawn by Claude Code".into());
                            });
                        }
                    }
                    "result" => {
                        let window = message.get("modelUsage").and_then(Value::as_object).and_then(|usage| {
                            usage.values().filter_map(|m| m.get("contextWindow").and_then(Value::as_u64)).max()
                        });
                        transcript.send(ProviderUpdate::Usage(SessionUsage {
                            context_tokens,
                            context_window: window,
                            input_tokens: None,
                            output_tokens: None,
                        })).await;
                        let reason = message.get("terminal_reason").and_then(Value::as_str).unwrap_or_default();
                        let error = message.get("is_error").and_then(Value::as_bool).unwrap_or(false)
                            || message.get("subtype").and_then(Value::as_str).is_some_and(|s| s != "success");
                        break if interrupting || reason.starts_with("aborted") {
                            transcript.settle("Interrupted");
                            SessionStatus::Interrupted
                        } else if error {
                            let text = message.get("result").and_then(Value::as_str).unwrap_or("Claude Code could not complete this turn.");
                            let text = if text.contains("Not logged in") || text.contains("/login") {
                                "Claude Code is not signed in. Run `claude` in a terminal and sign in, then send again.".to_string()
                            } else {
                                super::bounded(&super::plain(text), 2_000)
                            };
                            transcript.settle("Failed");
                            transcript.notice("error", &text);
                            SessionStatus::Failed
                        } else {
                            SessionStatus::Idle
                        };
                    }
                    _ => {}
                }
            }
            _ = until(transcript.due()) => {
                if !transcript.flush().await { break SessionStatus::Failed; }
            }
        }
    };
    // Claude Code's own account of the context window, which also covers
    // what a compaction freed.
    if outcome == SessionStatus::Idle
        && let Ok(id) = process.control("get_context_usage", json!({})).await
    {
        let read = async {
            while let Some(output) = lines.recv().await {
                let Output::Line(line) = output else { continue };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if message
                    .pointer("/response/request_id")
                    .and_then(Value::as_str)
                    == Some(id.as_str())
                {
                    return message.pointer("/response/response").cloned();
                }
            }
            None
        };
        if let Ok(Some(usage)) = tokio::time::timeout(Duration::from_secs(3), read).await
            && let (Some(used), Some(window)) = (
                usage.get("totalTokens").and_then(Value::as_u64),
                usage.get("maxTokens").and_then(Value::as_u64),
            )
        {
            transcript
                .send(ProviderUpdate::Usage(SessionUsage {
                    context_tokens: Some(used),
                    context_window: Some(window),
                    input_tokens: None,
                    output_tokens: None,
                }))
                .await;
        }
    }
    drop(lines);
    for (id, (request_id, _)) in asked.drain() {
        interactions.withdraw(&id);
        let _ = process
            .child
            .send(&control_success(
                &request_id,
                json!({"behavior": "deny", "message": "The turn ended.", "interrupt": false}),
            ))
            .await;
    }
    if outcome != SessionStatus::Idle {
        transcript.settle(if outcome == SessionStatus::Interrupted {
            "Interrupted"
        } else {
            "Failed"
        });
    }
    transcript.end_compaction(if outcome == SessionStatus::Idle {
        "Claude Code finished without reporting a compaction."
    } else {
        "The context was not compacted."
    });
    transcript.flush().await;
    if process.child.exited().is_none() {
        adapter.keep(&turn.session_id, Arc::clone(&process));
    }
    transcript.send(ProviderUpdate::Finished(outcome)).await;
    Ok(())
}

fn control_success(request_id: &str, response: Value) -> Value {
    json!({"type": "control_response", "response": {
        "subtype": "success", "request_id": request_id, "response": response
    }})
}

/// Replaces a tool block's title and files from its (complete) input while
/// keeping the status and output it already has.
fn update_tool_input(
    transcript: &mut Transcript,
    id: &str,
    name: &str,
    input: &Value,
    cwd: Option<&Path>,
) {
    if tools::hidden(name) {
        return;
    }
    let fresh = tools::tool_block(id, name, input, "running", cwd);
    match (transcript.get_mut(id), fresh) {
        (
            Some(MessageBlock::Tool {
                title,
                files,
                detail,
                ..
            }),
            MessageBlock::Tool {
                title: new_title,
                files: new_files,
                detail: new_detail,
                ..
            },
        ) => {
            *title = new_title;
            *files = new_files;
            if detail.is_empty() {
                *detail = new_detail;
            }
        }
        (None, fresh) => transcript.upsert(id, fresh),
        _ => {}
    }
}
