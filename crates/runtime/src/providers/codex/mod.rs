//! Codex through `codex app-server`, its structured JSON-RPC interface.
//!
//! One app-server process serves every Codex session in JAM. It starts on the
//! first turn, not at launch, and stops after it has been idle for a while or
//! when JAM quits. Codex owns authentication, models and tool execution; JAM
//! observes items and answers the approvals Codex asks for.
mod items;
mod rpc;

use super::{
    ACCOUNT_IDENTITY_LIMIT, ACCOUNT_LABEL_LIMIT, Answer, ProbeFuture, ProviderAdapter,
    ProviderConfig, ProviderFuture, ProviderTurn, ProviderUpdate, SPEED, Transcript, TurnIo,
    access, account_label, account_text, descriptor, discovery, process::LaunchSpec,
    set_capability, transcript::until,
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
    /// Threads resumed or started on this process, with what was applied.
    loaded: Mutex<HashMap<String, Applied>>,
}

/// A loaded thread's settings that persist across its turns.
#[derive(Clone)]
struct Applied {
    sandbox: String,
    /// A service tier other than standard, which later turns keep until reset.
    tier: Option<String>,
}

/// Codex's standard service tier, sent to leave a faster one.
const STANDARD_TIER: &str = "default";

/// A faster tier a thread reports, if any.
fn reported_tier(result: &Value) -> Option<String> {
    result
        .get("serviceTier")
        .and_then(Value::as_str)
        .filter(|tier| *tier != STANDARD_TIER)
        .map(str::to_owned)
}

/// The `serviceTier` a turn must send: the chosen faster tier, standard to
/// leave one the thread still has, or nothing to keep Codex's own choice.
fn tier_to_send(chosen: Option<&str>, applied: Option<&str>) -> Option<String> {
    match (chosen, applied) {
        (Some(chosen), applied) if applied != Some(chosen) => Some(chosen.into()),
        (None, Some(_)) => Some(STANDARD_TIER.into()),
        _ => None,
    }
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
    vec![access::option(
        "Codex asks before anything that is not a known-safe read; commands run read-only.",
        "Codex edits files in the project and decides when to ask; commands may write there.",
        "Codex never asks and runs without a sandbox. Commands can change anything.",
    )]
}

/// Codex's approval policy and sandbox for a JAM access level.
fn codex_access(options: &BTreeMap<String, String>) -> (&'static str, &'static str) {
    match access::chosen(options) {
        access::FULL => ("never", "danger-full-access"),
        access::EDITS => ("on-request", "workspace-write"),
        _ => ("untrusted", "read-only"),
    }
}

fn sandbox_policy(mode: &str) -> Value {
    match mode {
        "read-only" => json!({"type": "readOnly", "networkAccess": false}),
        "danger-full-access" => json!({"type": "dangerFullAccess"}),
        _ => json!({"type": "workspaceWrite", "writableRoots": [], "networkAccess": false,
                     "excludeTmpdirEnvVar": false, "excludeSlashTmp": false}),
    }
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

/// The account `account/read` reports, as JAM shows it. The email is kept as
/// the display identity (hidden until the reader reveals it); every other
/// identifier, such as the workspace routing account ID, is dropped here.
fn account_from(account: &Value) -> ProviderAccount {
    ProviderAccount {
        method: match account.get("type").and_then(Value::as_str) {
            Some("chatgpt") => Some("ChatGPT".into()),
            Some("apiKey") => Some("API key".into()),
            Some("amazonBedrock") => Some("Amazon Bedrock".into()),
            _ => None,
        },
        plan: account
            .get("planType")
            .and_then(Value::as_str)
            .and_then(chatgpt_plan),
        identity: account_text(account.get("email"), ACCOUNT_IDENTITY_LIMIT),
    }
}

/// The full ChatGPT plan name for Codex's `PlanType` code. A code without a
/// public name JAM knows is shown as Codex sent it, never guessed; `unknown`
/// is unknown.
fn chatgpt_plan(code: &str) -> Option<String> {
    let name = match code {
        "unknown" => return None,
        "free" => "Free",
        "go" => "Go",
        "plus" => "Plus",
        "pro" => "Pro",
        "prolite" => "Pro 5x",
        "team" => "Team",
        "business" | "self_serve_business_prolite" | "self_serve_business_usage_based" => {
            "Business"
        }
        "enterprise" | "ent26" | "enterprise_cbp_automation" | "enterprise_cbp_usage_based" => {
            "Enterprise"
        }
        "edu" => "Edu",
        other => {
            return account_label(other, ACCOUNT_LABEL_LIMIT)
                .map(|code| format!("ChatGPT ({code})"));
        }
    };
    Some(format!("ChatGPT {name}"))
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
            server.connection.child.kill_now();
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
            d.account = account.map(account_from);
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
                speeds: model
                    .get("serviceTiers")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|tier| {
                        let id = tier.get("id").and_then(Value::as_str)?;
                        (id != STANDARD_TIER).then(|| OptionValue {
                            value: id.into(),
                            label: tier
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or(id)
                                .into(),
                            description: tier
                                .get("description")
                                .and_then(Value::as_str)
                                .map(str::to_owned),
                        })
                    })
                    .collect(),
                // Codex names the model that supersedes this one.
                legacy: model
                    .get("upgrade")
                    .is_some_and(|upgrade| !upgrade.is_null()),
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
    let (approval, sandbox) = codex_access(&turn.options);
    let (approval, sandbox) = (approval.to_string(), sandbox.to_string());
    let model = turn.options.get("model").cloned();
    let effort = turn.options.get("effort").cloned();
    let speed = turn.options.get(SPEED).cloned();
    // What a thread resumed or started below reported for itself.
    let mut fresh_tier = None;

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
                    fresh_tier = reported_tier(&result);
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
            fresh_tier = reported_tier(&result);
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

    let started = if turn.compact {
        // Codex runs the compaction as a turn of its own on this thread.
        connection
            .request("thread/compact/start", json!({"threadId": thread_id}))
            .await
            .map_err(|e| e.into_jam("Codex could not compact this chat"))?;
        transcript.compacting();
        transcript.flush().await;
        json!({})
    } else {
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
        // The folder goes with every turn: a chat can move to another
        // branch's folder, and a loaded thread keeps the one it started in.
        let mut start = json!({
            "threadId": thread_id,
            "input": input,
            "approvalPolicy": approval,
            "cwd": cwd.display().to_string(),
        });
        if let Some(model) = &model {
            start["model"] = json!(model);
        }
        if let Some(effort) = &effort {
            start["effort"] = json!(effort);
        }
        if already
            .as_ref()
            .is_some_and(|applied| applied.sandbox != sandbox)
        {
            start["sandboxPolicy"] = sandbox_policy(&sandbox);
        }
        let applied_tier = match &already {
            Some(applied) => applied.tier.clone(),
            None => fresh_tier,
        };
        let send_tier = tier_to_send(speed.as_deref(), applied_tier.as_deref());
        if let Some(tier) = &send_tier {
            start["serviceTier"] = json!(tier);
        }
        let started = connection
            .request("turn/start", start)
            .await
            .map_err(|e| e.into_jam("Codex did not start the turn"))?;
        if let Ok(mut loaded) = server.loaded.lock() {
            let tier = match send_tier {
                Some(sent) => Some(sent).filter(|tier| tier != STANDARD_TIER),
                None => applied_tier,
            };
            loaded.insert(
                thread_id.clone(),
                Applied {
                    sandbox: sandbox.clone(),
                    tier,
                },
            );
        }
        started
    };
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
                                    ItemBlock::Notice(_, text) if completed && item.get("type").and_then(Value::as_str) == Some("contextCompaction") => transcript.compacted(&text),
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
    transcript.end_compaction(if outcome == SessionStatus::Idle {
        "Codex finished without reporting a compaction."
    } else {
        "The context was not compacted."
    });
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

#[cfg(test)]
mod tests {
    use super::{STANDARD_TIER, account_from, chatgpt_plan, reported_tier, tier_to_send};
    use serde_json::json;

    #[test]
    fn account_keeps_the_email_as_identity_and_names_the_plan() {
        let account = account_from(&json!({
            "type": "chatgpt",
            "email": "reader@example.com",
            "planType": "prolite",
            "chatgptAccountId": "acct-1"
        }));
        assert_eq!(account.method.as_deref(), Some("ChatGPT"));
        assert_eq!(account.plan.as_deref(), Some("ChatGPT Pro 5x"));
        assert_eq!(account.identity.as_deref(), Some("reader@example.com"));
        // Debug output never carries the identity.
        assert!(!format!("{account:?}").contains("reader@"));

        // An API key sign-in reports no email or plan: both stay unknown.
        let key = account_from(&json!({"type": "apiKey"}));
        assert_eq!(key.method.as_deref(), Some("API key"));
        assert_eq!((key.plan, key.identity), (None, None));

        // An oversized or multi-line email is unknown, not cut.
        let long = format!("{}@example.com", "a".repeat(300));
        assert_eq!(
            account_from(&json!({"type": "chatgpt", "email": long})).identity,
            None
        );
        assert_eq!(
            account_from(&json!({"type": "chatgpt", "email": "a@b.c\nx"})).identity,
            None
        );
    }

    #[test]
    fn plans_have_full_names_and_unfamiliar_codes_are_not_guessed() {
        assert_eq!(chatgpt_plan("pro").as_deref(), Some("ChatGPT Pro"));
        assert_eq!(chatgpt_plan("plus").as_deref(), Some("ChatGPT Plus"));
        assert_eq!(chatgpt_plan("ent26").as_deref(), Some("ChatGPT Enterprise"));
        assert_eq!(chatgpt_plan("promax").as_deref(), Some("ChatGPT (promax)"));
        assert_eq!(chatgpt_plan("unknown"), None);
        assert_eq!(chatgpt_plan(""), None);
        assert_eq!(chatgpt_plan("bad\ncode"), None);
    }

    #[test]
    fn a_faster_tier_is_sent_once_and_left_explicitly() {
        // Chosen and not yet applied: send it.
        assert_eq!(
            tier_to_send(Some("priority"), None).as_deref(),
            Some("priority")
        );
        // Already applied to the loaded thread: later turns keep it.
        assert_eq!(tier_to_send(Some("priority"), Some("priority")), None);
        // Back to standard: Codex keeps an override until it is reset.
        assert_eq!(
            tier_to_send(None, Some("priority")).as_deref(),
            Some(STANDARD_TIER)
        );
        // Nothing chosen and nothing applied: Codex's own configuration decides.
        assert_eq!(tier_to_send(None, None), None);
    }

    #[test]
    fn a_thread_on_the_standard_tier_reports_none() {
        assert_eq!(reported_tier(&json!({"serviceTier": "default"})), None);
        assert_eq!(reported_tier(&json!({"serviceTier": null})), None);
        assert_eq!(
            reported_tier(&json!({"serviceTier": "priority"})).as_deref(),
            Some("priority")
        );
    }
}
