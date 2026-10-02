//! Permanent conversation deletion: what goes, what must stay, and when it
//! is refused. Rows are checked in the database itself, so a table the
//! runtime forgot to clean cannot hide behind a request that filters it out.
use jam_runtime::{
    Runtime,
    protocol::{
        CapabilitySupport, EventPayload, MessageBlock, ProviderDescriptor, Request, SessionStatus,
        SubscriptionScope,
    },
    providers::{
        MockProvider, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
        ProviderUpdate, TurnIo,
    },
    snapshots::{CapturedWindow, SnapshotSettings},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jam-delete-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("project")).unwrap();
        Self(root)
    }
    fn db(&self) -> PathBuf {
        self.0.join("jam.sqlite")
    }
    /// Rows in `table` matching `filter`, read straight from the database.
    fn rows(&self, table: &str, filter: &str, value: &str) -> i64 {
        rusqlite::Connection::open(self.db())
            .unwrap()
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE {filter}"),
                [value],
                |row| row.get(0),
            )
            .unwrap()
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn request(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, String> {
    runtime
        .request(Request {
            protocol_version: 1,
            method: method.into(),
            params,
        })
        .map_err(|error| error.code)
}

fn delete(runtime: &Arc<Runtime>, resource_id: &str) -> Result<Value, String> {
    request(
        runtime,
        "conversation.delete",
        json!({ "resourceId": resource_id }),
    )
}

fn ids(workspace: &Value, list: &str) -> Vec<String> {
    workspace[list]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

/// Waits for a turn that has started to stop running, or to ask for input.
async fn settled(receiver: &mut jam_runtime::EventReceiver) -> (SessionStatus, bool) {
    tokio::time::timeout(Duration::from_secs(10), async {
        // Creating a chat also reports its (idle) session; that is not a turn.
        let mut started = false;
        while let Some(event) = receiver.recv().await {
            let EventPayload::SessionUpdated { session } = event.payload else {
                continue;
            };
            if session.status == SessionStatus::Running && !session.needs_input {
                started = true;
            } else if started {
                return (session.status, session.needs_input);
            }
        }
        panic!("subscription ended before the turn settled")
    })
    .await
    .expect("turn settles")
}

/// The tables that hold anything keyed by a conversation or its session.
fn remaining(temp: &Temp, resource_id: &str, session_id: &str) -> Vec<(&'static str, i64)> {
    [
        ("resources", "id=?1", resource_id),
        ("conversations", "id=?1", resource_id),
        ("sessions", "conversation_id=?1", resource_id),
        ("messages", "conversation_id=?1", resource_id),
        ("search_documents", "resource_id=?1", resource_id),
        ("provider_bindings", "session_id=?1", session_id),
        (
            "requests",
            "json_extract(receipt,'$.resourceId')=?1",
            resource_id,
        ),
        (
            "requests",
            "json_extract(receipt,'$.sessionId')=?1",
            session_id,
        ),
    ]
    .into_iter()
    .map(|(table, filter, value)| (table, temp.rows(table, filter, value)))
    .collect()
}

#[tokio::test]
async fn deleting_an_idle_chat_removes_only_its_own_records_for_good() {
    let temp = Temp::new();
    let runtime = Runtime::open_demo(temp.db()).unwrap();
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    // Give both chats something searchable and a request receipt.
    for (resource, text, id) in [
        ("conv-navigation", "Delete me uniquewordgarnet", "doomed"),
        ("conv-layout", "Keep me uniquewordjasper", "kept"),
    ] {
        request(
            &runtime,
            "turn.start",
            json!({"resourceId":resource,"text":text,"context":[],"requestId":id}),
        )
        .unwrap();
        assert_eq!(settled(&mut observer.receiver).await.0, SessionStatus::Idle);
    }
    let before = request(&runtime, "workspace.get", json!({})).unwrap();
    let session_of = |resource: &str| {
        before["resources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == json!(resource))
            .unwrap()["sessionId"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let (doomed_session, kept_session) = (session_of("conv-navigation"), session_of("conv-layout"));
    let kept_before = request(
        &runtime,
        "conversation.get",
        json!({"resourceId":"conv-layout"}),
    )
    .unwrap();
    assert!(
        remaining(&temp, "conv-navigation", &doomed_session)
            .iter()
            .filter(|(table, _)| *table != "provider_bindings")
            .any(|(_, count)| *count > 0)
    );

    assert_eq!(
        delete(&runtime, "conv-navigation").unwrap(),
        json!({"resourceId":"conv-navigation"})
    );

    // Every table that held it is clean, and so is the search index.
    for (table, count) in remaining(&temp, "conv-navigation", &doomed_session) {
        assert_eq!(count, 0, "{table} still holds the deleted chat");
    }
    assert_eq!(
        temp.rows("search_fts", "search_fts MATCH ?1", "\"uniquewordgarnet\"*"),
        0
    );
    assert_eq!(
        request(
            &runtime,
            "search.query",
            json!({"query":"uniquewordgarnet"})
        )
        .unwrap()["results"],
        json!([])
    );
    assert_eq!(
        request(
            &runtime,
            "conversation.get",
            json!({"resourceId":"conv-navigation"})
        ),
        Err("not_found".into())
    );
    // A retry is recognizable, never a second deletion of something else.
    assert_eq!(delete(&runtime, "conv-navigation"), Err("not_found".into()));
    // Its receipt is gone too: the old request ID no longer answers for it.
    assert_eq!(
        request(
            &runtime,
            "turn.start",
            json!({"resourceId":"conv-navigation","text":"Delete me uniquewordgarnet","context":[],"requestId":"doomed"}),
        ),
        Err("not_found".into())
    );

    // Everything else is exactly as it was.
    let after = request(&runtime, "workspace.get", json!({})).unwrap();
    assert_eq!(after["projects"], before["projects"]);
    assert_eq!(after["worktrees"], before["worktrees"]);
    let without = |list: &str, gone: &str| {
        ids(&before, list)
            .into_iter()
            .filter(|id| id != gone)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        ids(&after, "resources"),
        without("resources", "conv-navigation")
    );
    assert_eq!(
        ids(&after, "sessions"),
        without("sessions", &doomed_session)
    );
    assert_eq!(
        request(
            &runtime,
            "conversation.get",
            json!({"resourceId":"conv-layout"})
        )
        .unwrap()["messages"],
        kept_before["messages"]
    );
    assert_eq!(
        request(
            &runtime,
            "search.query",
            json!({"query":"uniquewordjasper"})
        )
        .unwrap()["results"][0]["resourceId"],
        "conv-layout"
    );
    assert_eq!(
        temp.rows(
            "requests",
            "json_extract(receipt,'$.sessionId')=?1",
            &kept_session
        ),
        1
    );

    // It stays deleted across a restart; the seed does not bring it back.
    drop(observer);
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = Runtime::open_demo(temp.db()).unwrap();
    let workspace = request(&reopened, "workspace.get", json!({})).unwrap();
    assert_eq!(ids(&workspace, "resources"), ids(&after, "resources"));
    assert_eq!(
        delete(&reopened, "conv-navigation"),
        Err("not_found".into())
    );
}

#[tokio::test]
async fn a_working_or_waiting_chat_cannot_be_deleted() {
    let temp = Temp::new();
    let runtime = Runtime::open_demo(temp.db()).unwrap();
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    let send = |text: &str, id: &str| {
        request(
            &runtime,
            "turn.start",
            json!({"resourceId":"conv-layout","text":text,"context":[],"requestId":id}),
        )
        .unwrap()
    };

    send("Work for a while", "running");
    assert_eq!(delete(&runtime, "conv-layout"), Err("conflict".into()));
    assert_eq!(settled(&mut observer.receiver).await.0, SessionStatus::Idle);

    let receipt = send("/approval", "waiting");
    assert!(settled(&mut observer.receiver).await.1, "the agent asks");
    assert_eq!(delete(&runtime, "conv-layout"), Err("conflict".into()));
    // Refusals changed nothing.
    assert_eq!(temp.rows("resources", "id=?1", "conv-layout"), 1);
    assert!(temp.rows("messages", "conversation_id=?1", "conv-layout") > 0);

    // Deleting never interrupts; the reader stops the turn, then deletes.
    request(
        &runtime,
        "turn.interrupt",
        json!({"sessionId":receipt["sessionId"]}),
    )
    .unwrap();
    tokio::time::timeout(Duration::from_secs(15), async {
        // The interrupted turn's task may still be stopping for a moment.
        while delete(&runtime, "conv-layout") == Err("conflict".into()) {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the interrupted turn finishes stopping");
    assert_eq!(temp.rows("resources", "id=?1", "conv-layout"), 0);

    // Only conversations can be deleted this way.
    for resource in ["diff-pane", "settings"] {
        assert_eq!(delete(&runtime, resource), Err("invalid_request".into()));
    }
    assert_eq!(delete(&runtime, "conv-missing"), Err("not_found".into()));
    assert_eq!(
        request(&runtime, "conversation.delete", json!({})),
        Err("invalid_request".into())
    );
}

/// Stands in for a real provider: binds a provider session ID, remembers the
/// ID each turn resumed with, and records which sessions were released.
#[derive(Default)]
struct Scripted {
    resumed: Arc<Mutex<Vec<Option<String>>>>,
    released: Arc<Mutex<Vec<String>>>,
}

impl ProviderAdapter for Scripted {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn unchecked(&self, config: &ProviderConfig) -> ProviderDescriptor {
        let mut descriptor = MockProvider.unchecked(config);
        descriptor.id = "claude".into();
        descriptor.name = "Scripted".into();
        descriptor.installation = "installed".into();
        descriptor.authentication = "authenticated".into();
        descriptor.enabled = true;
        for support in descriptor.capabilities.values_mut() {
            *support = CapabilitySupport::supported();
        }
        descriptor
    }
    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let descriptor = self.unchecked(&config);
        Box::pin(async move { descriptor })
    }
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        let resumed = Arc::clone(&self.resumed);
        Box::pin(async move {
            resumed.lock().unwrap().push(turn.native_id.clone());
            let native = turn
                .native_id
                .unwrap_or_else(|| format!("native-{}", turn.session_id));
            let _ = io.updates.send(ProviderUpdate::Native(native)).await;
            let _ = io
                .updates
                .send(ProviderUpdate::Blocks(vec![MessageBlock::Text {
                    text: "done".into(),
                }]))
                .await;
            let _ = io
                .updates
                .send(ProviderUpdate::Finished(SessionStatus::Idle))
                .await;
            Ok(())
        })
    }
    fn release(&self, session_id: &str) {
        self.released.lock().unwrap().push(session_id.to_owned());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_one_agent_chat_leaves_another_chats_binding_and_folder_alone() {
    let temp = Temp::new();
    let folder = temp.0.join("project");
    std::fs::write(folder.join("notes.txt"), "the reader's file").unwrap();
    let agent = Arc::new(Scripted::default());
    let runtime =
        Runtime::open_with(temp.db(), vec![Arc::new(MockProvider), agent.clone()]).unwrap();
    request(
        &runtime,
        "project.update",
        json!({"projectId":"project-jam","paths":[folder.display().to_string()]}),
    )
    .unwrap();
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    let mut chats = Vec::new();
    for name in ["first", "second"] {
        let created = request(
            &runtime,
            "conversation.create",
            json!({"projectId":"project-jam","presentation":"claude","providerId":"claude","requestId":format!("create-{name}")}),
        )
        .unwrap();
        let (resource, session) = (
            created["resource"]["id"].as_str().unwrap().to_owned(),
            created["session"]["id"].as_str().unwrap().to_owned(),
        );
        request(
            &runtime,
            "turn.start",
            json!({"resourceId":resource,"text":format!("Hello {name}"),"context":[],"requestId":format!("turn-{name}")}),
        )
        .unwrap();
        assert_eq!(settled(&mut observer.receiver).await.0, SessionStatus::Idle);
        assert_eq!(temp.rows("provider_bindings", "session_id=?1", &session), 1);
        chats.push((resource, session));
    }
    let [(first, first_session), (second, second_session)] = [chats[0].clone(), chats[1].clone()];

    delete(&runtime, &first).unwrap();

    for (table, count) in remaining(&temp, &first, &first_session) {
        assert_eq!(count, 0, "{table} still holds the deleted chat");
    }
    // The process kept for the deleted session is released, and only that one.
    assert_eq!(*agent.released.lock().unwrap(), vec![first_session.clone()]);
    // The other chat still resumes its own provider session.
    assert_eq!(
        temp.rows("provider_bindings", "session_id=?1", &second_session),
        1
    );
    request(
        &runtime,
        "turn.start",
        json!({"resourceId":second,"text":"Still here","context":[],"requestId":"turn-again"}),
    )
    .unwrap();
    assert_eq!(settled(&mut observer.receiver).await.0, SessionStatus::Idle);
    assert_eq!(
        agent.resumed.lock().unwrap().last().unwrap().as_deref(),
        Some(format!("native-{second_session}").as_str())
    );
    // The project and its folder are untouched.
    let workspace = request(&runtime, "workspace.get", json!({})).unwrap();
    assert!(ids(&workspace, "projects").contains(&"project-jam".to_owned()));
    assert_eq!(
        std::fs::read_to_string(folder.join("notes.txt")).unwrap(),
        "the reader's file"
    );
    // A retried first Send with the old request ID makes a new chat rather
    // than answering with the deleted one.
    let again = request(
        &runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"claude","providerId":"claude","requestId":"create-first"}),
    )
    .unwrap();
    assert_ne!(again["resource"]["id"], json!(first));
}

fn capture() -> CapturedWindow {
    CapturedWindow {
        bounds: [0.0; 4],
        image: vec![255, 216, 255, 217],
        thumbnail: vec![255, 216, 255, 217],
        width: 640,
        height: 480,
        application: "Harmless test app".into(),
        window_title: "Test window".into(),
    }
}

#[tokio::test]
async fn a_deleted_chat_releases_the_snapshots_it_sent_and_returns_staged_ones() {
    let temp = Temp::new();
    let runtime = Runtime::open_demo(temp.db()).unwrap();
    request(
        &runtime,
        "snapshot.settings.update",
        serde_json::to_value(SnapshotSettings {
            enabled: true,
            ..Default::default()
        })
        .unwrap(),
    )
    .unwrap();
    let asset = |id: &str| temp.0.join("snapshots").join(format!("{id}.jpg"));
    let stage = |resource: &str| {
        runtime
            .store_snapshot_for(capture(), Some(resource.into()))
            .unwrap()
    };
    let sent = stage("conv-layout");
    let elsewhere = stage("conv-navigation");
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    for (resource, snapshot, id) in [
        ("conv-layout", &sent, "send-doomed"),
        ("conv-navigation", &elsewhere, "send-kept"),
    ] {
        request(
            &runtime,
            "turn.start",
            json!({"resourceId":resource,"text":"Look","context":[snapshot.context],"requestId":id}),
        )
        .unwrap();
        assert_eq!(settled(&mut observer.receiver).await.0, SessionStatus::Idle);
    }
    let staged = stage("conv-layout");
    request(
        &runtime,
        "snapshot.focus",
        json!({"resourceId":"conv-layout"}),
    )
    .unwrap();
    assert!(asset(&sent.id).exists() && asset(&staged.id).exists());

    delete(&runtime, "conv-layout").unwrap();

    // The snapshot it sent belonged to its history: record and files go.
    assert_eq!(temp.rows("snapshots", "id=?1", &sent.id), 0);
    assert!(!asset(&sent.id).exists());
    assert!(!asset(&format!("{}-thumb", sent.id)).exists());
    // A capture still waiting for it was never sent: it returns to the inbox.
    let inbox = request(&runtime, "snapshot.list", json!({})).unwrap();
    let returned = inbox["snapshots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == json!(staged.id))
        .expect("the staged capture is kept");
    assert!(returned.get("resourceId").is_none() || returned["resourceId"].is_null());
    assert!(asset(&staged.id).exists());
    // Another chat's sent snapshot is untouched.
    assert_eq!(temp.rows("snapshots", "id=?1", &elsewhere.id), 1);
    assert!(asset(&elsewhere.id).exists());
    // Captures no longer aim at the deleted chat.
    assert_eq!(runtime.snapshot_destination().unwrap(), None);
}
