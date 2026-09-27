//! Provider boundary tests with no real CLI: the demo provider's simulated
//! requests and a scripted adapter standing in for a real one.
use jam_runtime::{
    Runtime,
    protocol::{
        CapabilitySupport, EventPayload, InteractionStatus, MessageBlock, ProviderDescriptor,
        Request, SessionStatus, SubscriptionScope,
    },
    providers::{
        MockProvider, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
        ProviderUpdate, TurnIo,
    },
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
        let root = std::env::temp_dir().join(format!("jam-providers-{}", uuid::Uuid::new_v4()));
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

/// Provider ID, text, folder and options one turn was given.
type Seen = (
    Option<String>,
    String,
    Option<PathBuf>,
    Vec<(String, String)>,
);

/// Stands in for a real provider: records what it was given and replies
/// with a provider ID, a model, a block and success.
#[derive(Default)]
struct Scripted {
    seen: Arc<Mutex<Vec<Seen>>>,
}

impl ProviderAdapter for Scripted {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn unchecked(&self, _config: &ProviderConfig) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "claude".into(),
            name: "Scripted".into(),
            installation: "installed".into(),
            authentication: "authenticated".into(),
            enabled: true,
            is_default: false,
            running: false,
            capabilities: jam_runtime::protocol::CAPABILITIES
                .iter()
                .map(|key| (key.to_string(), CapabilitySupport::supported()))
                .collect(),
            running_count: None,
            version: Some("1.0.0".into()),
            executable: None,
            executable_source: None,
            executable_override: None,
            status: None,
            account: None,
            models: Some(vec![jam_runtime::protocol::ProviderModel {
                id: "fast".into(),
                label: "Fast".into(),
                description: None,
                is_default: true,
                efforts: vec!["low".into(), "high".into()],
                default_effort: None,
                images: Some("unsupported".into()),
            }]),
            options: None,
            defaults: None,
            checked_at: None,
        }
    }
    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let descriptor = self.unchecked(&config);
        Box::pin(async move { descriptor })
    }
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        let seen = Arc::clone(&self.seen);
        Box::pin(async move {
            seen.lock().unwrap().push((
                turn.native_id.clone(),
                turn.text.clone(),
                turn.cwd.clone(),
                turn.options.clone().into_iter().collect(),
            ));
            let native = turn.native_id.unwrap_or_else(|| "native-thread-1".into());
            let _ = io.updates.send(ProviderUpdate::Native(native)).await;
            let _ = io
                .updates
                .send(ProviderUpdate::Model("fast-2026".into()))
                .await;
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
}

async fn settled(
    receiver: &mut jam_runtime::EventReceiver,
) -> (SessionStatus, Vec<MessageBlock>, bool) {
    let mut blocks = Vec::new();
    let mut needs_input = false;
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Some(event) = receiver.recv().await {
            match event.payload {
                EventPayload::MessageUpserted { message } if message.role == "assistant" => {
                    blocks = message.blocks;
                }
                EventPayload::SessionUpdated { session } => {
                    needs_input = session.needs_input;
                    if session.status != SessionStatus::Running || session.needs_input {
                        return session.status;
                    }
                }
                _ => {}
            }
        }
        SessionStatus::Failed
    })
    .await
    .map(|status| (status, blocks, needs_input))
    .expect("turn settles")
}

fn pending_interaction(blocks: &[MessageBlock]) -> Option<String> {
    blocks.iter().find_map(|block| match block {
        MessageBlock::Interaction { interaction }
            if interaction.status == InteractionStatus::Pending =>
        {
            Some(interaction.id.clone())
        }
        _ => None,
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn simulated_approvals_answer_once_and_then_are_stale() {
    let temp = Temp::new();
    let runtime = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider)]).unwrap();
    let created = call(
        &runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"claude"}),
    )
    .await
    .unwrap();
    let resource = created["resource"]["id"].as_str().unwrap().to_string();
    let mut events = runtime
        .subscribe(SubscriptionScope {
            resource_id: Some(resource.clone()),
        })
        .unwrap();
    call(
        &runtime,
        "turn.start",
        json!({"resourceId": resource, "text": "/approval", "context": [], "requestId": "r1"}),
    )
    .await
    .unwrap();
    let (status, blocks, needs_input) = settled(&mut events.receiver).await;
    assert_eq!(status, SessionStatus::Running);
    assert!(needs_input, "the session says it needs input");
    let interaction = pending_interaction(&blocks).expect("an approval is shown");
    let unoffered = call(
        &runtime,
        "interaction.respond",
        json!({"resourceId": resource, "interactionId": interaction, "choiceId": "always"}),
    )
    .await
    .unwrap_err();
    assert!(unoffered.starts_with("invalid_request"), "{unoffered}");
    call(
        &runtime,
        "interaction.respond",
        json!({"resourceId": resource, "interactionId": interaction, "choiceId": "allow"}),
    )
    .await
    .unwrap();
    let (status, blocks, needs_input) = settled(&mut events.receiver).await;
    assert_eq!(status, SessionStatus::Idle);
    assert!(!needs_input);
    assert!(blocks.iter().any(|b| matches!(b, MessageBlock::Interaction { interaction } if interaction.status == InteractionStatus::Resolved)));
    let again = call(
        &runtime,
        "interaction.respond",
        json!({"resourceId": resource, "interactionId": interaction, "choiceId": "allow"}),
    )
    .await
    .unwrap_err();
    assert!(again.starts_with("stale"), "{again}");
}

#[tokio::test(flavor = "multi_thread")]
async fn interrupting_cancels_a_pending_request_and_restart_expires_one() {
    let temp = Temp::new();
    let resource = {
        let runtime = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider)]).unwrap();
        let created = call(
            &runtime,
            "conversation.create",
            json!({"projectId":"project-jam","presentation":"codex"}),
        )
        .await
        .unwrap();
        let resource = created["resource"]["id"].as_str().unwrap().to_string();
        let session = created["session"]["id"].as_str().unwrap().to_string();
        let mut events = runtime
            .subscribe(SubscriptionScope {
                resource_id: Some(resource.clone()),
            })
            .unwrap();
        call(
            &runtime,
            "turn.start",
            json!({"resourceId": resource, "text": "/question", "context": [], "requestId": "q1"}),
        )
        .await
        .unwrap();
        let (_, blocks, _) = settled(&mut events.receiver).await;
        let interaction = pending_interaction(&blocks).unwrap();
        call(&runtime, "turn.interrupt", json!({"sessionId": session}))
            .await
            .unwrap();
        let conversation = call(
            &runtime,
            "conversation.get",
            json!({"resourceId": resource}),
        )
        .await
        .unwrap();
        let text = conversation.to_string();
        assert!(
            text.contains("\"status\":\"cancelled\""),
            "the request is cancelled"
        );
        let late = call(&runtime, "interaction.respond", json!({"resourceId": resource, "interactionId": interaction, "answers": {"approach": ["Runtime-owned"]}}))
            .await
            .unwrap_err();
        assert!(late.starts_with("stale"), "{late}");

        // A new request left pending when JAM stops cannot be answered later.
        let mut events = runtime
            .subscribe(SubscriptionScope {
                resource_id: Some(resource.clone()),
            })
            .unwrap();
        call(
            &runtime,
            "turn.start",
            json!({"resourceId": resource, "text": "/approval", "context": [], "requestId": "q2"}),
        )
        .await
        .unwrap();
        let (_, blocks, _) = settled(&mut events.receiver).await;
        assert!(pending_interaction(&blocks).is_some());
        drop(events);
        runtime.shutdown().await.unwrap();
        resource
    };
    let reopened = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider)]).unwrap();
    let conversation = call(
        &reopened,
        "conversation.get",
        json!({"resourceId": resource}),
    )
    .await
    .unwrap();
    let workspace = call(&reopened, "workspace.get", json!({})).await.unwrap();
    let session = workspace["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["resourceId"] == resource.as_str())
        .unwrap();
    assert!(session.get("needsInput").is_none());
    assert!(!conversation.to_string().contains("\"status\":\"pending\""));
}

#[tokio::test(flavor = "multi_thread")]
async fn real_providers_bind_native_ids_and_resume_with_them() {
    let temp = Temp::new();
    let scripted = Arc::new(Scripted::default());
    let seen = Arc::clone(&scripted.seen);
    let resource = {
        let runtime =
            Runtime::open_with(temp.db(), vec![Arc::new(MockProvider), scripted.clone()]).unwrap();
        // Unknown providers and bad options are refused before anything is created.
        assert!(
            call(
                &runtime,
                "conversation.create",
                json!({"projectId":"project-jam","presentation":"claude","providerId":"gemini"})
            )
            .await
            .is_err()
        );
        let bad = call(&runtime, "conversation.create", json!({"projectId":"project-jam","presentation":"claude","providerId":"claude","options":{"effort":"max"}}))
            .await
            .unwrap_err();
        assert!(bad.contains("effort"), "{bad}");
        let created = call(&runtime, "conversation.create", json!({"projectId":"project-jam","presentation":"codex","providerId":"claude","options":{"effort":"high"}}))
            .await
            .unwrap();
        assert_eq!(created["session"]["providerId"], "claude");
        assert_eq!(
            created["session"]["presentation"], "claude",
            "a real provider presents as itself"
        );
        assert_eq!(created["session"]["model"], "Fast");
        let resource = created["resource"]["id"].as_str().unwrap().to_string();

        // Agents run in the project's folder; without one nothing is saved.
        let refused = call(
            &runtime,
            "turn.start",
            json!({"resourceId": resource, "text": "hi", "context": [], "requestId": "t0"}),
        )
        .await
        .unwrap_err();
        assert!(refused.starts_with("project_folder_required"), "{refused}");
        let conversation = call(
            &runtime,
            "conversation.get",
            json!({"resourceId": resource}),
        )
        .await
        .unwrap();
        assert!(conversation["messages"].as_array().unwrap().is_empty());

        call(
            &runtime,
            "project.update",
            json!({"projectId":"project-jam","paths":[temp.folder()]}),
        )
        .await
        .unwrap();
        let mut events = runtime
            .subscribe(SubscriptionScope {
                resource_id: Some(resource.clone()),
            })
            .unwrap();
        call(
            &runtime,
            "turn.start",
            json!({"resourceId": resource, "text": "hi", "context": [], "requestId": "t1"}),
        )
        .await
        .unwrap();
        let (status, blocks, _) = settled(&mut events.receiver).await;
        assert_eq!(status, SessionStatus::Idle);
        assert_eq!(
            blocks,
            vec![MessageBlock::Text {
                text: "done".into()
            }]
        );
        runtime.shutdown().await.unwrap();
        resource
    };
    // After a restart the provider's own ID is handed back for resume, and
    // a changed option applies from that turn on.
    let runtime = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider), scripted]).unwrap();
    let mut events = runtime
        .subscribe(SubscriptionScope {
            resource_id: Some(resource.clone()),
        })
        .unwrap();
    call(&runtime, "turn.start", json!({"resourceId": resource, "text": "again", "context": [], "requestId": "t2", "options": {"effort": "low"}}))
        .await
        .unwrap();
    let (status, _, _) = settled(&mut events.receiver).await;
    assert_eq!(status, SessionStatus::Idle);
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.len(), 2);
    assert_eq!(seen[0].0, None, "a new session has no provider ID yet");
    assert_eq!(seen[1].0.as_deref(), Some("native-thread-1"));
    assert_eq!(
        seen[1].2.clone(),
        Some(std::fs::canonicalize(temp.folder()).unwrap())
    );
    assert_eq!(seen[1].3, vec![("effort".to_string(), "low".to_string())]);
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    let session = workspace["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["resourceId"] == resource.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        session["model"], "fast-2026",
        "the model the provider reported"
    );
    assert_eq!(session["options"]["effort"], "low");
    assert!(
        !workspace.to_string().contains("native-thread-1"),
        "provider IDs stay in the runtime"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn provider_settings_persist_and_stay_independent() {
    let temp = Temp::new();
    {
        let runtime = Runtime::open_with(
            temp.db(),
            vec![Arc::new(MockProvider), Arc::new(Scripted::default())],
        )
        .unwrap();
        let listed = call(&runtime, "provider.list", json!({})).await.unwrap();
        let mock = listed["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "mock")
            .unwrap()
            .clone();
        assert_eq!(
            mock["enabled"], false,
            "the demo provider is off by default"
        );
        let refused = call(
            &runtime,
            "conversation.create",
            json!({"projectId":"project-jam","presentation":"claude","providerId":"mock"}),
        )
        .await
        .unwrap_err();
        assert!(refused.starts_with("provider_disabled"), "{refused}");
        assert!(
            call(
                &runtime,
                "provider.configure",
                json!({"providerId":"claude","executable":"relative/claude"})
            )
            .await
            .is_err()
        );
        call(
            &runtime,
            "provider.configure",
            json!({"providerId":"mock","enabled":true,"isDefault":true}),
        )
        .await
        .unwrap();
        let configured = call(
            &runtime,
            "provider.configure",
            json!({"providerId":"claude","enabled":false,"defaults":{"model":"fast"}}),
        )
        .await
        .unwrap();
        let claude = configured["providers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "claude")
            .unwrap()
            .clone();
        assert_eq!(claude["enabled"], false);
        assert_eq!(
            claude["installation"], "installed",
            "disabling does not uninstall"
        );
        assert_eq!(claude["authentication"], "authenticated");
        assert_eq!(claude["defaults"]["model"], "fast");
        runtime.shutdown().await.unwrap();
    }
    let runtime = Runtime::open_with(
        temp.db(),
        vec![Arc::new(MockProvider), Arc::new(Scripted::default())],
    )
    .unwrap();
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    let providers = workspace["providers"].as_array().unwrap();
    let mock = providers.iter().find(|p| p["id"] == "mock").unwrap();
    let claude = providers.iter().find(|p| p["id"] == "claude").unwrap();
    assert_eq!(
        (mock["enabled"].as_bool(), mock["isDefault"].as_bool()),
        (Some(true), Some(true))
    );
    assert_eq!(claude["enabled"], false);
}
