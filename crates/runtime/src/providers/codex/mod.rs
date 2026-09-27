//! Codex through `codex app-server`, its structured JSON-RPC interface.
//!
//! One app-server process serves every Codex session in JAM. It starts on the
//! first turn, not at launch, and stops after it has been idle for a while or
//! when JAM quits. Codex owns authentication, models and tool execution; JAM
//! observes items and answers the approvals Codex asks for.
mod items;
mod rpc;

use super::{
    Answer, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
    ProviderUpdate, Transcript, TurnIo, descriptor, discovery, process::LaunchSpec, set_capability,
    transcript::until,
};
use crate::{
    error::JamError,
    protocol::{
        InteractionStatus, OptionValue, ProviderAccount, ProviderDescriptor, ProviderModel,
        ProviderOption, ProviderStatus, SessionStatus, SessionUsage,
    },
    runtime::new_id,
};
use base64::Engine;
use items::ItemBlock;
use rpc::{Connection, Incoming};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::mpsc;

const NAME: &str = "Codex";
/// The app-server protocol this adapter was written and tested against.
const TESTED: &str = "0.157.0";
const IDLE_SHUTDOWN: Duration = Duration::from_secs(15 * 60);
const INTERRUPT_GRACE: Duration = Duration::from_secs(8);

struct Server {
    connection: Arc<Connection>,
    /// Threads resumed or started on this process, with the sandbox applied.
    loaded: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct Inner {
    server: tokio::sync::Mutex<Option<Arc<Server>>>,
    active: AtomicU64,
    generation: AtomicU64,
}

#[derive(Clone, Default)]
pub struct CodexAdapter {
    inner: Arc<Inner>,
}

fn launch(executable: PathBuf) -> LaunchSpec {
    LaunchSpec::new(executable)
        .arg("app-server")
        .env("PATH", discovery::search_path())
}

fn options() -> Vec<ProviderOption> {
    let value = |value: &str, label: &str, description: &str| OptionValue {
        value: value.into(),
        label: label.into(),
        description: Some(description.into()),
    };
    vec![
        ProviderOption {
            id: "approvalPolicy".into(),
            label: "Approval mode".into(),
            description: Some("When Codex asks before running commands.".into()),
            values: vec![
                value(
                    "untrusted",
                    "Untrusted",
                    "Ask before anything that is not a known-safe read.",
                ),
                value("on-request", "On request", "Codex decides when to ask."),
                value(
                    "never",
                    "Never",
                    "Never ask. Failures are returned to Codex.",
                ),
            ],
            default: "on-request".into(),
        },
        ProviderOption {
            id: "sandbox".into(),
            label: "Sandbox".into(),
            description: Some("What commands Codex runs may touch.".into()),
            values: vec![
                value("read-only", "Read only", "Commands cannot write files."),
                value(
                    "workspace-write",
                    "Workspace write",
                    "Commands may write inside the project.",
                ),
                value(
                    "danger-full-access",
                    "Full access",
                    "No sandbox. Commands can change anything.",
                ),
            ],
            default: "workspace-write".into(),
        },
    ]
}

fn sandbox_policy(mode: &str) -> Value {
    match mode {
        "read-only" => json!({"type": "readOnly", "networkAccess": false}),
        "danger-full-access" => json!({"type": "dangerFullAccess"}),
        _ => json!({"type": "workspaceWrite", "writableRoots": [], "networkAccess": false,
                     "excludeTmpdirEnvVar": false, "excludeSlashTmp": false}),
    }
}

fn option<'a>(options: &'a BTreeMap<String, String>, key: &str, default: &'a str) -> &'a str {
    options.get(key).map(String::as_str).unwrap_or(default)
}

impl CodexAdapter {
    fn base(&self, config: &ProviderConfig) -> ProviderDescriptor {
        let mut d = descriptor("codex", NAME, "unknown", "Codex has not been checked yet.");
        d.executable_override = config.executable.clone();
        d.options = Some(options());
        d
    }

    async fn server(&self, config: &ProviderConfig) -> Result<Arc<Server>, JamError> {
        let mut slot = self.inner.server.lock().await;
        if let Some(server) = slot.as_ref()
            && server.connection.alive()
        {
            return Ok(Arc::clone(server));
        }
        let found = discovery::locate(&["codex"], config.executable.as_deref()).map_err(missing)?;
        let connection =
            rpc::Connection::start(&launch(found.path.clone()), env!("CARGO_PKG_VERSION")).await?;
        let server = Arc::new(Server {
            connection,
            loaded: Mutex::new(HashMap::new()),
        });
        *slot = Some(Arc::clone(&server));
        Ok(server)
    }

    /// Stops the shared server once no turn has used it for a while.
    fn schedule_idle_shutdown(&self) {
        let generation = self.inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let inner = Arc::downgrade(&self.inner);
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_SHUTDOWN).await;
            let Some(inner) = inner.upgrade() else { return };
            if inner.generation.load(Ordering::Acquire) == generation
                && inner.active.load(Ordering::Acquire) == 0
                && let Some(server) = inner.server.lock().await.take()
            {
                server.connection.child.kill();
            }
        });
    }
}

fn missing(missing: discovery::Missing) -> JamError {
    match missing {
        discovery::Missing::InvalidOverride => JamError::new(
            "provider_unavailable",
            "The Codex executable set in Settings → Providers is not a runnable file.",
        ),
        discovery::Missing::NotFound => JamError::new(
            "provider_unavailable",
            "Codex is not installed or not on PATH. Install the Codex CLI, then check again in Settings → Providers.",
        ),
    }
}

impl ProviderAdapter for CodexAdapter {
    fn id(&self) -> &'static str {
        "codex"
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
        Box::pin(async move {
            adapter.inner.active.fetch_add(1, Ordering::AcqRel);
            let result = run(&adapter, turn, io).await;
            adapter.inner.active.fetch_sub(1, Ordering::AcqRel);
            adapter.schedule_idle_shutdown();
            result
        })
    }

    fn shutdown(&self) {
        if let Ok(mut slot) = self.inner.server.try_lock()
            && let Some(server) = slot.take()
        {
            server.connection.child.kill();
        }
    }
}

async fn probe(mut d: ProviderDescriptor, config: ProviderConfig) -> ProviderDescriptor {
    let found = match discovery::locate(&["codex"], config.executable.as_deref()) {
        Ok(found) => found,
        Err(discovery::Missing::NotFound) => {
            d.installation = "missing".into();
            for key in crate::protocol::CAPABILITIES {
                set_capability(&mut d, key, "unsupported", Some("Codex is not installed."));
            }
            return d;
        }
        Err(discovery::Missing::InvalidOverride) => {
            d.installation = "missing".into();
            d.status = Some(ProviderStatus {
                tone: "error".into(),
                message: "The executable set for Codex is not a runnable file.".into(),
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
    if let Some(version) = &d.version
        && !discovery::at_least(version, TESTED)
    {
        d.status = Some(ProviderStatus {
            tone: "warning".into(),
            message: format!(
                "Codex {version} is older than the version JAM was tested with ({TESTED}). Update Codex if chats fail."
            ),
        });
    }
    let connection =
        match rpc::Connection::start(&launch(found.path), env!("CARGO_PKG_VERSION")).await {
            Ok(connection) => connection,
            Err(error) => {
                d.status = Some(ProviderStatus {
                    tone: "error".into(),
                    message: error.message,
                });
                return d;
            }
        };
    match connection
        .request("account/read", json!({"refreshToken": false}))
        .await
    {
        Ok(result) => {
            let account = result.get("account").filter(|a| !a.is_null());
            let requires = result
                .get("requiresOpenaiAuth")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            d.authentication = match (account, requires) {
                (Some(_), _) => "authenticated",
                (None, true) => "unauthenticated",
                (None, false) => "not-required",
            }
            .into();
            // Only the kind of sign-in and a plan Codex itself reports.
            // Email and account identifiers are dropped here.
            if let Some(account) = account {
                d.account = Some(ProviderAccount {
                    method: match account.get("type").and_then(Value::as_str) {
                        Some("chatgpt") => Some("ChatGPT".into()),
                        Some("apiKey") => Some("API key".into()),
                        Some("amazonBedrock") => Some("Amazon Bedrock".into()),
                        _ => None,
                    },
                    plan: account
                        .get("planType")
                        .and_then(Value::as_str)
                        .filter(|plan| *plan != "unknown")
                        .map(str::to_owned),
                });
            }
        }
        Err(error) => {
            d.status = Some(ProviderStatus {
                tone: "warning".into(),
                message: error.into_jam("Codex could not report its sign-in").message,
            });
        }
    }
    let mut models = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..5 {
        let mut params = json!({"limit": 100, "includeHidden": false});
        if let Some(cursor) = &cursor {
            params["cursor"] = json!(cursor);
        }
        let Ok(page) = connection.request("model/list", params).await else {
            break;
        };
        for model in page
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = model
                .get("model")
                .or_else(|| model.get("id"))
                .and_then(Value::as_str);
            let Some(id) = id else { continue };
            models.push(ProviderModel {
                id: id.into(),
                label: model
                    .get("displayName")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .into(),
                description: model
                    .get("description")
                    .and_then(Value::as_str)
                    .filter(|d| !d.is_empty())
                    .map(str::to_owned),
                is_default: model
                    .get("isDefault")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                efforts: model
                    .get("supportedReasoningEfforts")
                    .and_then(Value::as_array)
                    .map(|efforts| {
                        efforts
                            .iter()
                            .filter_map(|e| e.get("reasoningEffort").and_then(Value::as_str))
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default(),
                default_effort: model
                    .get("defaultReasoningEffort")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                images: model
                    .get("inputModalities")
                    .and_then(Value::as_array)
                    .map(|m| {
                        if m.iter().any(|m| m == "image") {
                            "supported"
                        } else {
                            "unsupported"
                        }
                        .to_string()
                    }),
            });
        }
        cursor = page
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        if cursor.is_none() {
            break;
        }
    }
    connection.child.kill();
    let has_models = !models.is_empty();
    let images = models
        .iter()
        .any(|m| m.images.as_deref() == Some("supported"));
    if has_models {
        d.models = Some(models);
    }
    for key in [
        "create",
        "resume",
        "interrupt",
        "streaming",
        "toolApproval",
        "permissionModes",
        "usage",
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
                Some("Codex did not list its models."),
            );
        }
    }
    set_capability(
        &mut d,
        "images",
        if images { "conditional" } else { "unknown" },
        Some("Depends on the model Codex reports."),
    );
    set_capability(
        &mut d,
        "fork",
        "unsupported",
        Some("Codex can fork threads; JAM does not offer forking yet."),
    );
    set_capability(
        &mut d,
        "userInput",
        "unsupported",
        Some("Codex asks questions only through its experimental API, which JAM does not enable."),
    );
    set_capability(
        &mut d,
        "steering",
        "unsupported",
        Some("Codex supports steering a running turn; JAM does not offer it yet."),
    );
    set_capability(
        &mut d,
        "queue",
        "unsupported",
        Some("Send after the current turn finishes."),
    );
    d
}

/// One pending Codex server request JAM showed to the reader.
struct Asked {
    request_id: Value,
    method: String,
    params: Value,
}

async fn run(adapter: &CodexAdapter, turn: ProviderTurn, io: TurnIo) -> Result<(), JamError> {
    let TurnIo {
        updates,
        mut cancelled,
        interactions,
    } = io;
    let mut transcript = Transcript::new(updates);
    let Some(cwd) = turn.cwd.clone() else {
        return Err(JamError::invalid(
            "Add a folder to this project before starting a Codex chat.",
        ));
    };
    let server = adapter.server(&turn.config).await?;
    let connection = Arc::clone(&server.connection);
    let approval = option(&turn.options, "approvalPolicy", "on-request").to_string();
    let sandbox = option(&turn.options, "sandbox", "workspace-write").to_string();
    let model = turn.options.get("model").cloned();
    let effort = turn.options.get("effort").cloned();

    // Resume the provider's thread, or start one.
    let already = turn
        .native_id
        .as_ref()
        .and_then(|id| server.loaded.lock().ok()?.get(id).cloned());
    let mut thread_id = turn.native_id.clone().filter(|_| already.is_some());
    let mut settings = json!({
        "cwd": cwd.display().to_string(),
        "approvalPolicy": approval,
        "approvalsReviewer": "user",
        "sandbox": sandbox,
    });
    if let Some(model) = &model {
        settings["model"] = json!(model);
    }
    if thread_id.is_none() {
        if let Some(native) = &turn.native_id {
            let mut params = settings.clone();
            params["threadId"] = json!(native);
            params["excludeTurns"] = json!(true);
            match connection.request("thread/resume", params).await {
                Ok(result) => {
                    thread_id = Some(native.clone());
                    report_model(&transcript, &result).await;
                }
                Err(error) if error.message.contains("not found") => {
                    transcript.notice(
                        "warning",
                        "Codex could not find this chat's earlier thread, so this turn started a new one without that history.",
                    );
                }
                Err(error) => return Err(error.into_jam("Codex could not resume this chat")),
            }
        }
        if thread_id.is_none() {
            let result = connection
                .request("thread/start", settings)
                .await
                .map_err(|e| e.into_jam("Codex could not start a thread"))?;
            let id = result
                .pointer("/thread/id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    JamError::new("provider_error", "Codex started a thread without an ID.")
                })?
                .to_string();
            report_model(&transcript, &result).await;
            thread_id = Some(id);
        }
    }
    let thread_id = thread_id.expect("resolved above");
    transcript
        .send(ProviderUpdate::Native(thread_id.clone()))
        .await;

    let (route_tx, mut route) = mpsc::channel::<Incoming>(512);
    connection.route(&thread_id, route_tx.clone());
    let _unroute = Unroute(Arc::clone(&connection), thread_id.clone(), route_tx);

    // Input: the reader's text first, then images they explicitly sent.
    let mut input = vec![json!({"type": "text", "text": turn.text, "text_elements": []})];
    for image in &turn.images {
        input.push(match &image.path {
            Some(path) => json!({"type": "localImage", "path": path.display().to_string()}),
            None => json!({"type": "image", "url": format!(
                "data:{};base64,{}",
                image.media_type,
                base64::engine::general_purpose::STANDARD.encode(image.bytes.as_slice())
            )}),
        });
    }
    let mut start = json!({"threadId": thread_id, "input": input, "approvalPolicy": approval});
    if let Some(model) = &model {
        start["model"] = json!(model);
    }
    if let Some(effort) = &effort {
        start["effort"] = json!(effort);
    }
    if already.as_deref().is_some_and(|applied| applied != sandbox) {
        start["sandboxPolicy"] = sandbox_policy(&sandbox);
    }
    let started = connection
        .request("turn/start", start)
        .await
        .map_err(|e| e.into_jam("Codex did not start the turn"))?;
    if let Ok(mut loaded) = server.loaded.lock() {
        loaded.insert(thread_id.clone(), sandbox.clone());
    }
    let turn_id = started
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let cwd_ref = Some(cwd.as_path());
    let mut asked: HashMap<String, Asked> = HashMap::new();
    let mut by_request: HashMap<String, String> = HashMap::new();
    let (answers_tx, mut answers) = mpsc::channel::<(String, Answer)>(16);
    let mut file_items: HashMap<String, Value> = HashMap::new();
    let mut interrupting = false;
    let mut interrupt_deadline: Option<tokio::time::Instant> = None;
    let mut seen_reasoning_parts: HashSet<(String, i64)> = HashSet::new();

    let outcome = loop {
        tokio::select! {
            biased;
            changed = cancelled.changed(), if !interrupting => {
                if changed.is_err() || *cancelled.borrow() {
                    interrupting = true;
                    interrupt_deadline = Some(tokio::time::Instant::now() + INTERRUPT_GRACE);
                    // Withdraw JAM's side of every open request before
                    // interrupting, so Codex is not left waiting on JAM.
                    for (id, pending) in asked.drain() {
                        interactions.withdraw(&id);
                        let _ = connection.respond(&pending.request_id, items::cancellation(&pending.method)).await;
                    }
                    let _ = connection.request("turn/interrupt", json!({"threadId": thread_id, "turnId": turn_id})).await;
                }
            }
            _ = until(interrupt_deadline), if interrupting => {
                break SessionStatus::Interrupted;
            }
            Some((interaction_id, answer)) = answers.recv() => {
                if let Some(pending) = asked.remove(&interaction_id) {
                    let (reply, outcome) = items::response(&pending.method, &pending.params, &answer);
                    let sent = connection.respond(&pending.request_id, reply).await.is_ok();
                    transcript.update_interaction(&interaction_id, |i| {
                        i.status = if sent { InteractionStatus::Resolved } else { InteractionStatus::Expired };
                        i.outcome = Some(outcome);
                    });
                    transcript.flush().await;
                }
            }
            incoming = route.recv() => {
                let Some(incoming) = incoming else { break SessionStatus::Failed };
                match incoming {
                    Incoming::Exited => {
                        let detail = connection.child.stderr_summary().map(|s| format!(" ({s})")).unwrap_or_default();
                        transcript.settle("Codex exited");
                        transcript.notice("error", &format!("Codex exited unexpectedly{detail}. Send again to resume this chat."));
                        break SessionStatus::Failed;
                    }
                    Incoming::Request { id, method, params } => {
                        let detail = params.get("itemId").and_then(Value::as_str)
                            .and_then(|item| file_items.get(item))
                            .map(|item| items::changes(item, cwd_ref).iter().map(|c| format!("{} (+{} −{})", c.path, c.added, c.removed)).collect::<Vec<_>>().join("\n"));
                        match items::interaction(new_id("interaction"), &method, &params, detail) {
                            Some(interaction) if !interrupting => {
                                let receiver = interactions.open(&turn.session_id, &interaction)?;
                                let key = id.to_string();
                                by_request.insert(key, interaction.id.clone());
                                asked.insert(interaction.id.clone(), Asked { request_id: id, method, params });
                                let interaction_id = interaction.id.clone();
                                transcript.interaction(interaction);
                                transcript.flush().await;
                                let answers_tx = answers_tx.clone();
                                tokio::spawn(async move {
                                    if let Ok(answer) = receiver.await {
                                        let _ = answers_tx.send((interaction_id, answer)).await;
                                    }
                                });
                            }
                            Some(_) => { let _ = connection.respond(&id, items::cancellation(&method)).await; }
                            None => {
                                connection.respond_error(&id, -32601, "JAM cannot answer this Codex request yet.").await;
                                if method == "mcpServer/elicitation/request" {
                                    transcript.notice("warning", "An MCP server asked for input; JAM cannot answer MCP requests yet, so it was declined.");
                                }
                            }
                        }
                    }
                    Incoming::Notification { method, params } => {
                        let item_id = params.get("itemId").and_then(Value::as_str).unwrap_or_default().to_string();
                        match method.as_str() {
                            "item/agentMessage/delta" => {
                                transcript.append(&item_id, false, params.get("delta").and_then(Value::as_str).unwrap_or_default());
                            }
                            "item/reasoning/summaryTextDelta" => {
                                let index = params.get("summaryIndex").and_then(Value::as_i64).unwrap_or(0);
                                let key = format!("{item_id}:reasoning");
                                if index > 0 && seen_reasoning_parts.insert((item_id.clone(), index)) {
                                    transcript.append(&key, true, "\n\n");
                                }
                                transcript.append(&key, true, params.get("delta").and_then(Value::as_str).unwrap_or_default());
                            }
                            "item/commandExecution/outputDelta" => {
                                transcript.append_detail(&item_id, params.get("delta").and_then(Value::as_str).unwrap_or_default());
                            }
                            "item/started" | "item/completed" => {
                                let Some(item) = params.get("item") else { continue };
                                let id = item.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                                if item.get("type").and_then(Value::as_str) == Some("fileChange") {
                                    file_items.insert(id.clone(), item.clone());
                                }
                                let completed = method == "item/completed";
                                match items::item(item, cwd_ref) {
                                    ItemBlock::Text(text) if completed => transcript.set_text(&id, false, &text),
                                    ItemBlock::Reasoning(text) if completed => transcript.set_text(&format!("{id}:reasoning"), true, &text),
                                    ItemBlock::Block(block) => {
                                        // Keep streamed output until the final item replaces it.
                                        let keep = !completed && transcript.contains(&id);
                                        if !keep { transcript.upsert(&id, block); }
                                    }
                                    ItemBlock::Notice(tone, text) if completed => transcript.notice(tone, &text),
                                    _ => {}
                                }
                            }
                            "item/fileChange/patchUpdated" => {
                                if let Some(item) = file_items.get_mut(&item_id) {
                                    item["changes"] = params.get("changes").cloned().unwrap_or(json!([]));
                                    let item = item.clone();
                                    if let ItemBlock::Block(block) = items::item(&item, cwd_ref) { transcript.upsert(&item_id, block); }
                                }
                            }
                            "serverRequest/resolved" => {
                                let key = params.get("requestId").map(Value::to_string).unwrap_or_default();
                                if let Some(interaction_id) = by_request.remove(&key)
                                    && asked.remove(&interaction_id).is_some()
                                {
                                    interactions.withdraw(&interaction_id);
                                    transcript.update_interaction(&interaction_id, |i| {
                                        i.status = InteractionStatus::Cancelled;
                                        i.outcome = Some("Resolved by Codex".into());
                                    });
                                }
                            }
                            "thread/tokenUsage/updated" => {
                                let usage = params.get("tokenUsage");
                                let number = |path: &str| usage.and_then(|u| u.pointer(path)).and_then(Value::as_u64);
                                transcript.send(ProviderUpdate::Usage(SessionUsage {
                                    context_tokens: number("/last/totalTokens"),
                                    context_window: number("/modelContextWindow"),
                                    input_tokens: number("/total/inputTokens"),
                                    output_tokens: number("/total/outputTokens"),
                                })).await;
                            }
                            "model/rerouted" => {
                                if let Some(to) = params.get("toModel").and_then(Value::as_str) {
                                    transcript.send(ProviderUpdate::Model(to.to_string())).await;
                                    transcript.notice("info", &format!("Codex switched this turn to {to}."));
                                }
                            }
                            "error" => {
                                let message = params.pointer("/error/message").and_then(Value::as_str).unwrap_or("Codex reported an error.");
                                let retrying = params.get("willRetry").and_then(Value::as_bool).unwrap_or(false);
                                if retrying {
                                    transcript.notice("info", &format!("Codex is retrying: {}", super::plain(message)));
                                }
                            }
                            "turn/completed" => {
                                let turn = params.get("turn").cloned().unwrap_or(Value::Null);
                                if !turn_id.is_empty() && turn.get("id").and_then(Value::as_str).is_some_and(|id| id != turn_id) {
                                    continue;
                                }
                                break match turn.get("status").and_then(Value::as_str) {
                                    Some("completed") => SessionStatus::Idle,
                                    Some("interrupted") => {
                                        transcript.settle("Interrupted");
                                        SessionStatus::Interrupted
                                    }
                                    _ => {
                                        let message = turn.pointer("/error/message").and_then(Value::as_str).unwrap_or("Codex could not complete this turn.");
                                        transcript.settle("Failed");
                                        transcript.notice("error", &super::plain(message));
                                        SessionStatus::Failed
                                    }
                                };
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ = until(transcript.due()) => {
                if !transcript.flush().await { break SessionStatus::Failed; }
            }
        }
    };
    for (id, pending) in asked.drain() {
        interactions.withdraw(&id);
        let _ = connection
            .respond(&pending.request_id, items::cancellation(&pending.method))
            .await;
    }
    if outcome != SessionStatus::Idle {
        transcript.settle(if outcome == SessionStatus::Interrupted {
            "Interrupted"
        } else {
            "Failed"
        });
    }
    transcript.flush().await;
    transcript.send(ProviderUpdate::Finished(outcome)).await;
    Ok(())
}

async fn report_model(transcript: &Transcript, result: &Value) {
    if let Some(model) = result.get("model").and_then(Value::as_str) {
        transcript
            .send(ProviderUpdate::Model(model.to_string()))
            .await;
    }
}

/// Stops routing a thread's messages when its turn ends, however it ends.
/// Only this turn's own route is removed, never a later turn's.
struct Unroute(Arc<Connection>, String, mpsc::Sender<Incoming>);
impl Drop for Unroute {
    fn drop(&mut self) {
        self.0.unroute(&self.1, &self.2);
    }
}
