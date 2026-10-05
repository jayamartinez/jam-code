//! Queued follow-ups (storage and editing), driven through the runtime's requests with
//! a gated adapter: each turn waits until the test lets it finish, so what
//! happens while an agent works can be observed exactly.
use jam_runtime::{
    Runtime,
    protocol::{
        CapabilitySupport, Interaction, InteractionStatus, MessageBlock, ProviderDescriptor,
        Request, SessionStatus,
    },
    providers::{
        ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn, ProviderUpdate,
        TurnIo,
    },
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::Semaphore;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jam-queue-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("project")).unwrap();
        Self(root)
    }
    fn db(&self) -> PathBuf {
        self.0.join("jam.sqlite")
    }
    fn folder(&self) -> String {
        self.0.join("project").display().to_string()
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn call(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, String> {
    let runtime = Arc::clone(runtime);
    let method = method.to_string();
    tokio::task::spawn_blocking(move || {
        runtime
            .request(Request {
                protocol_version: 1,
                method,
                params,
            })
            .map_err(|e| format!("{}: {}", e.code, e.message))
    })
    .await
    .unwrap()
}

/// A provider whose turns finish only when the test releases them. A turn
/// whose text contains `fail` fails, and one with `ask` waits for an approval
/// first.
struct Gated {
    /// Every turn's text, in the order the provider received them.
    turns: Arc<Mutex<Vec<String>>>,
    release: Arc<Semaphore>,
}

impl Gated {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            turns: Arc::default(),
            release: Arc::new(Semaphore::new(0)),
        })
    }
    fn finish_one(&self) {
        self.release.add_permits(1);
    }
    fn turns(&self) -> Vec<String> {
        self.turns.lock().unwrap().clone()
    }
}

impl ProviderAdapter for Gated {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn unchecked(&self, _config: &ProviderConfig) -> ProviderDescriptor {
        let capabilities = jam_runtime::protocol::CAPABILITIES
            .iter()
            .map(|key| (key.to_string(), CapabilitySupport::supported()))
            .collect();
        ProviderDescriptor {
            id: "claude".into(),
            name: "Gated".into(),
            installation: "installed".into(),
            authentication: "authenticated".into(),
            enabled: true,
            is_default: false,
            running: false,
            capabilities,
            running_count: None,
            version: Some("1.0.0".into()),
            executable: None,
            executable_source: None,
            executable_override: None,
            status: None,
            account: None,
            models: None,
            options: None,
            defaults: None,
            favorite_models: Vec::new(),
            hidden_models: Vec::new(),
            checked_at: None,
        }
    }
    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let descriptor = self.unchecked(&config);
        Box::pin(async move { descriptor })
    }
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        let turns = Arc::clone(&self.turns);
        let release = Arc::clone(&self.release);
        Box::pin(async move {
            let TurnIo {
                updates,
                mut cancelled,
                interactions,
            } = io;
            turns.lock().unwrap().push(turn.text.clone());
            let mut blocks = vec![MessageBlock::Text {
                text: format!("working on {}", turn.text),
            }];
            let _ = updates.send(ProviderUpdate::Blocks(blocks.clone())).await;
            if turn.text.contains("ask") {
                let interaction = Interaction {
                    id: format!("interaction-{}", uuid::Uuid::new_v4()),
                    kind: "command".into(),
                    title: "Run a command".into(),
                    detail: None,
                    reason: None,
                    tool_id: None,
                    choices: vec![jam_runtime::protocol::InteractionChoice {
                        id: "allow".into(),
                        label: "Allow".into(),
                        tone: "allow".into(),
                    }],
                    questions: None,
                    status: InteractionStatus::Pending,
                    outcome: None,
                };
                let answer = interactions.open(&turn.session_id, &interaction).unwrap();
                blocks.push(MessageBlock::Interaction {
                    interaction: interaction.clone(),
                });
                let _ = updates.send(ProviderUpdate::Blocks(blocks.clone())).await;
                tokio::select! {
                    _ = answer => {}
                    _ = cancelled.changed() => return Ok(()),
                }
                blocks.pop();
                let mut answered = interaction;
                answered.status = InteractionStatus::Resolved;
                blocks.push(MessageBlock::Interaction {
                    interaction: answered,
                });
                let _ = updates.send(ProviderUpdate::Blocks(blocks.clone())).await;
            }
            tokio::select! {
                permit = release.acquire() => permit.unwrap().forget(),
                _ = cancelled.changed() => return Ok(()),
            }
            let status = if turn.text.contains("fail") {
                SessionStatus::Failed
            } else {
                SessionStatus::Idle
            };
            let _ = updates.send(ProviderUpdate::Finished(status)).await;
            Ok(())
        })
    }
}

struct Chat {
    runtime: Arc<Runtime>,
    resource: String,
    session: String,
}

async fn chat(temp: &Temp, adapter: Arc<Gated>) -> Chat {
    let runtime = Runtime::open_with(temp.db(), vec![adapter]).unwrap();
    open_chat(runtime, temp).await
}

async fn open_chat(runtime: Arc<Runtime>, temp: &Temp) -> Chat {
    call(
        &runtime,
        "project.update",
        json!({"projectId":"project-jam","paths":[temp.folder()]}),
    )
    .await
    .unwrap();
    let created = call(
        &runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"claude","providerId":"claude"}),
    )
    .await
    .unwrap();
    Chat {
        runtime,
        resource: created["resource"]["id"].as_str().unwrap().to_string(),
        session: created["session"]["id"].as_str().unwrap().to_string(),
    }
}

impl Chat {
    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        call(&self.runtime, method, params).await
    }
    async fn send(&self, text: &str, request: &str) -> Result<Value, String> {
        self.call(
            "turn.start",
            json!({"resourceId": self.resource, "text": text, "context": [], "requestId": request}),
        )
        .await
    }
    async fn queue(&self, text: &str, request: &str) -> Result<Value, String> {
        self.call(
            "queue.add",
            json!({"resourceId": self.resource, "text": text, "context": [], "requestId": request}),
        )
        .await
    }
    async fn conversation(&self) -> Value {
        self.call("conversation.get", json!({"resourceId": self.resource}))
            .await
            .unwrap()
    }
    async fn queued(&self) -> Vec<String> {
        self.conversation().await["queued"]
            .as_array()
            .unwrap()
            .iter()
            .map(|turn| turn["text"].as_str().unwrap().to_string())
            .collect()
    }
    async fn queued_ids(&self) -> Vec<String> {
        self.conversation().await["queued"]
            .as_array()
            .unwrap()
            .iter()
            .map(|turn| turn["id"].as_str().unwrap().to_string())
            .collect()
    }
    async fn status(&self) -> String {
        let workspace = self.call("workspace.get", json!({})).await.unwrap();
        workspace["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|session| session["id"] == self.session.as_str())
            .unwrap()["status"]
            .as_str()
            .unwrap()
            .to_string()
    }
    /// The user messages in the transcript, in order.
    async fn sent(&self) -> Vec<String> {
        self.conversation().await["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| message["role"] == "user")
            .map(|message| {
                message["blocks"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find_map(|block| block["text"].as_str())
                    .unwrap_or_default()
                    .to_string()
            })
            .collect()
    }
}

/// Waits until `check` holds, or fails the test after ten seconds.
async fn until<F, Fut>(what: &str, mut check: F)
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !check().await {
        assert!(tokio::time::Instant::now() < deadline, "timed out: {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn follow_ups_wait_without_reaching_the_provider() {
    let temp = Temp::new();
    let gated = Gated::new();
    let chat = chat(&temp, Arc::clone(&gated)).await;
    chat.send("first", "t1").await.unwrap();
    until("the first turn runs", || async { gated.turns().len() == 1 }).await;

    // Queued while it works: nothing reaches the provider yet.
    chat.queue("second", "q1").await.unwrap();
    chat.queue("third", "q2").await.unwrap();
    assert_eq!(chat.queued().await, ["second", "third"]);
    // A retried request is the same follow-up, not another one.
    let again = chat.queue("second", "q1").await.unwrap();
    assert_eq!(chat.queued().await.len(), 2);
    assert_eq!(again["accepted"], true);
    // Queued text is not part of the transcript or the search index yet.
    assert_eq!(chat.sent().await, ["first"]);
    let found = chat
        .call("search.query", json!({"query": "third"}))
        .await
        .unwrap();
    assert!(found["results"].as_array().unwrap().is_empty());
    assert_eq!(gated.turns(), ["first"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn follow_ups_can_be_edited_reordered_and_removed() {
    let temp = Temp::new();
    let gated = Gated::new();
    let chat = chat(&temp, Arc::clone(&gated)).await;
    chat.send("first", "t1").await.unwrap();
    until("running", || async { gated.turns().len() == 1 }).await;
    for (text, request) in [("a", "q1"), ("b", "q2"), ("c", "q3")] {
        chat.queue(text, request).await.unwrap();
    }
    let ids = chat.queued_ids().await;
    chat.call(
        "queue.update",
        json!({"resourceId": chat.resource, "queuedId": ids[1], "text": "b, edited"}),
    )
    .await
    .unwrap();
    let blank = chat
        .call(
            "queue.update",
            json!({"resourceId": chat.resource, "queuedId": ids[1], "text": "  "}),
        )
        .await
        .unwrap_err();
    assert!(blank.starts_with("invalid_request"), "{blank}");
    // The last moves to the front; order is explicit, not by time.
    chat.call(
        "queue.move",
        json!({"resourceId": chat.resource, "queuedId": ids[2], "position": 0}),
    )
    .await
    .unwrap();
    assert_eq!(chat.queued().await, ["c", "a", "b, edited"]);
    chat.call(
        "queue.remove",
        json!({"resourceId": chat.resource, "queuedId": ids[0]}),
    )
    .await
    .unwrap();
    // Removing it again is harmless.
    chat.call(
        "queue.remove",
        json!({"resourceId": chat.resource, "queuedId": ids[0]}),
    )
    .await
    .unwrap();
    assert_eq!(chat.queued().await, ["c", "b, edited"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restart_keeps_follow_ups_without_starting_them() {
    let temp = Temp::new();
    {
        let gated = Gated::new();
        let chat = chat(&temp, Arc::clone(&gated)).await;
        chat.send("first", "t1").await.unwrap();
        until("running", || async { gated.turns().len() == 1 }).await;
        chat.queue("survives", "q1").await.unwrap();
        // The app goes away with the turn still running.
        chat.runtime.shutdown().await.unwrap();
    }
    let gated = Gated::new();
    let runtime = Runtime::open_with(temp.db(), vec![gated.clone()]).unwrap();
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    let session = workspace["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["providerId"] == "claude")
        .unwrap()
        .clone();
    assert_eq!(session["status"], "interrupted");
    let conversation = call(
        &runtime,
        "conversation.get",
        json!({"resourceId": session["resourceId"]}),
    )
    .await
    .unwrap();
    assert_eq!(conversation["queued"][0]["text"], "survives");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(gated.turns().is_empty(), "nothing starts at launch");
}

#[tokio::test(flavor = "multi_thread")]
async fn queued_attachments_survive_until_sent_or_removed() {
    let temp = Temp::new();
    let gated = Gated::new();
    let chat = chat(&temp, Arc::clone(&gated)).await;
    let kept = chat
        .runtime
        .import_pasted_attachment("notes.txt", b"kept")
        .unwrap();
    let dropped = chat
        .runtime
        .import_pasted_attachment("drop.txt", b"dropped")
        .unwrap();
    let staged_dir = temp.0.join("attachments");
    let staged = || {
        std::fs::read_dir(&staged_dir)
            .unwrap()
            .filter(|entry| entry.as_ref().unwrap().path().is_file())
            .count()
    };
    assert_eq!(staged(), 2);
    chat.send("first", "t1").await.unwrap();
    until("running", || async { gated.turns().len() == 1 }).await;
    chat.call(
        "queue.add",
        json!({"resourceId": chat.resource, "text": "read it", "context": [kept], "requestId": "q1"}),
    )
    .await
    .unwrap();
    chat.call(
        "queue.add",
        json!({"resourceId": chat.resource, "text": "not this", "context": [dropped], "requestId": "q2"}),
    )
    .await
    .unwrap();
    let kept_id = kept.asset_id.clone().unwrap();
    // A queued attachment is not a removable chip, and cannot be sent twice.
    let removal = chat
        .call("attachment.remove", json!({"id": kept_id.clone()}))
        .await
        .unwrap_err();
    assert!(removal.starts_with("conflict"), "{removal}");
    let twice = chat
        .call(
            "queue.add",
            json!({"resourceId": chat.resource, "text": "again", "context": [kept], "requestId": "q3"}),
        )
        .await
        .unwrap_err();
    assert!(twice.contains("queued message"), "{twice}");

    // A restart's cleanup of staged files leaves queued ones alone.
    chat.runtime.shutdown().await.unwrap();
    drop(chat);
    let runtime = Runtime::open_with(temp.db(), vec![gated.clone()]).unwrap();
    assert_eq!(staged(), 2, "queued copies outlive the restart cleanup");
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    let resource = workspace["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["providerId"] == "claude")
        .unwrap()["resourceId"]
        .as_str()
        .unwrap()
        .to_string();
    let conversation = call(
        &runtime,
        "conversation.get",
        json!({"resourceId": resource}),
    )
    .await
    .unwrap();
    let ids: Vec<String> = conversation["queued"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect();

    // Removing one deletes the copy it owned.
    call(
        &runtime,
        "queue.remove",
        json!({"resourceId": resource, "queuedId": ids[1]}),
    )
    .await
    .unwrap();
    assert_eq!(staged(), 1);

    // Sending the other moves its copy into the conversation's folder,
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_chat_takes_its_queue() {
    let temp = Temp::new();
    let gated = Gated::new();
    let chat = chat(&temp, Arc::clone(&gated)).await;
    let file = chat
        .runtime
        .import_pasted_attachment("notes.txt", b"x")
        .unwrap();
    let file = serde_json::to_value(&file).unwrap();
    chat.send("this will fail", "t1").await.unwrap();
    until("running", || async { gated.turns().len() == 1 }).await;
    chat.call(
        "queue.add",
        json!({"resourceId": chat.resource, "text": "later", "context": [file], "requestId": "q1"}),
    )
    .await
    .unwrap();
    gated.finish_one();
    until("failed", || async { chat.status().await == "failed" }).await;
    until("task ended", || async {
        chat.call("conversation.delete", json!({"resourceId": chat.resource}))
            .await
            .is_ok()
    })
    .await;
    let left = std::fs::read_dir(temp.0.join("attachments"))
        .unwrap()
        .filter(|entry| entry.as_ref().unwrap().path().is_file())
        .count();
    assert_eq!(left, 0, "the queued copy goes with the chat");
}
