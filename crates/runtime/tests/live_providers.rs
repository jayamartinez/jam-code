//! Live provider checks against the Claude Code and Codex CLIs installed on
//! this computer. Ignored by default: they start real provider processes,
//! and the turn tests make small inference requests on the signed-in
//! account. Run explicitly:
//!
//! ```sh
//! JAM_LIVE_PROVIDERS=1 cargo test -p jam-runtime --test live_providers -- --ignored --nocapture
//! ```
//!
//! `JAM_LIVE_TURNS=1` additionally sends one short turn per provider and one
//! approval round trip (a harmless `ls`). Nothing here reads credentials.
use jam_runtime::{
    Runtime,
    protocol::{EventPayload, InteractionStatus, MessageBlock, Request, SessionStatus},
};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};

struct Temp(PathBuf);
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn enabled(var: &str) -> bool {
    std::env::var(var).is_ok_and(|v| v == "1")
}

async fn request(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, String> {
    let runtime = Arc::clone(runtime);
    let method = method.to_string();
    tokio::task::spawn_blocking(move || {
        runtime
            .request(Request {
                protocol_version: 1,
                method,
                params,
            })
            .map_err(|e| e.to_string())
    })
    .await
    .unwrap()
}

fn setup() -> (Temp, Arc<Runtime>, PathBuf) {
    let root = std::env::temp_dir().join(format!("jam-live-{}", uuid::Uuid::new_v4()));
    let project = root.join("project");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("README.md"), "# Live test project\n").unwrap();
    let runtime = Runtime::open_demo(root.join("jam.sqlite")).unwrap();
    (Temp(root), runtime, project)
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "starts the installed Claude Code and Codex CLIs"]
async fn installed_providers_are_described_without_inference() {
    if !enabled("JAM_LIVE_PROVIDERS") {
        return;
    }
    let (_temp, runtime, _) = setup();
    let providers = request(&runtime, "provider.list", json!({"refresh": true}))
        .await
        .unwrap();
    for provider in providers["providers"].as_array().unwrap() {
        let models: Vec<&str> = provider["models"]
            .as_array()
            .map(|m| m.iter().filter_map(|m| m["id"].as_str()).collect())
            .unwrap_or_default();
        println!(
            "{}: installation={} authentication={} version={} account={} models={:?} status={}",
            provider["id"],
            provider["installation"],
            provider["authentication"],
            provider["version"],
            provider["account"],
            models,
            provider["status"]["message"]
        );
        let text = provider.to_string();
        assert!(!text.contains('@'), "no email address reaches the client");
    }
}

async fn wait_for(
    receiver: &mut jam_runtime::EventReceiver,
    runtime: &Arc<Runtime>,
    resource_id: &str,
    approve: Option<&str>,
) -> (SessionStatus, Vec<MessageBlock>) {
    let mut blocks = Vec::new();
    let mut answered = std::collections::HashSet::new();
    let result = tokio::time::timeout(Duration::from_secs(240), async {
        while let Some(event) = receiver.recv().await {
            match event.payload {
                EventPayload::MessageUpserted { message } if message.role == "assistant" => {
                    for block in &message.blocks {
                        if let MessageBlock::Interaction { interaction } = block
                            && interaction.status == InteractionStatus::Pending
                            && let Some(choice) = approve
                            && answered.insert(interaction.id.clone())
                        {
                            println!("  interaction: {} · {:?}", interaction.title, interaction.detail);
                            request(
                                runtime,
                                "interaction.respond",
                                json!({"resourceId": resource_id, "interactionId": interaction.id, "choiceId": choice}),
                            )
                            .await
                            .unwrap();
                        }
                    }
                    blocks = message.blocks;
                }
                EventPayload::SessionUpdated { session } if session.status != SessionStatus::Running => {
                    return session.status;
                }
                _ => {}
            }
        }
        SessionStatus::Failed
    })
    .await
    .expect("turn finishes within four minutes");
    (result, blocks)
}

async fn turn(provider: &str, options: Value, prompt: &str, approve: Option<&str>) {
    let (_temp, runtime, project) = setup();
    let workspace = request(&runtime, "workspace.get", json!({})).await.unwrap();
    let project_id = workspace["projects"][0]["id"].as_str().unwrap().to_string();
    request(
        &runtime,
        "project.update",
        json!({"projectId": project_id, "paths": [project.display().to_string()]}),
    )
    .await
    .unwrap();
    request(&runtime, "provider.list", json!({"refresh": true}))
        .await
        .unwrap();
    let created = request(
        &runtime,
        "conversation.create",
        json!({"projectId": project_id, "presentation": provider, "providerId": provider, "options": options}),
    )
    .await
    .unwrap();
    let resource_id = created["resource"]["id"].as_str().unwrap().to_string();
    let mut subscription = runtime
        .subscribe(jam_runtime::protocol::SubscriptionScope {
            resource_id: Some(resource_id.clone()),
        })
        .unwrap();
    request(
        &runtime,
        "turn.start",
        json!({"resourceId": resource_id, "text": prompt, "context": [], "requestId": format!("live-{provider}")}),
    )
    .await
    .unwrap();
    let (status, blocks) =
        wait_for(&mut subscription.receiver, &runtime, &resource_id, approve).await;
    println!("{provider}: {status:?}");
    for block in &blocks {
        println!(
            "  {}",
            serde_json::to_string(block)
                .unwrap()
                .chars()
                .take(300)
                .collect::<String>()
        );
    }
    let session = request(&runtime, "workspace.get", json!({})).await.unwrap()["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["resourceId"] == resource_id.as_str())
        .cloned()
        .unwrap();
    println!(
        "  session: model={} usage={}",
        session["model"], session["usage"]
    );
    runtime.shutdown().await.unwrap();
    assert_eq!(status, SessionStatus::Idle);
    assert!(
        blocks
            .iter()
            .any(|b| matches!(b, MessageBlock::Text { .. }))
    );
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "sends a short Codex turn on the signed-in account"]
async fn codex_answers_and_asks_for_approval() {
    if !enabled("JAM_LIVE_TURNS") {
        return;
    }
    turn(
        "codex",
        json!({}),
        "Reply with exactly the word: pong",
        None,
    )
    .await;
    turn(
        "codex",
        json!({"approvalPolicy": "untrusted", "sandbox": "read-only"}),
        "Run the shell command `ls` in the current directory and tell me the file names.",
        Some("accept"),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "sends a short Claude Code turn on the signed-in account"]
async fn claude_answers_and_asks_for_approval() {
    if !enabled("JAM_LIVE_TURNS") {
        return;
    }
    turn(
        "claude",
        json!({}),
        "Reply with exactly the word: pong",
        None,
    )
    .await;
    turn(
        "claude",
        json!({"permissionMode": "default"}),
        "Use the Write tool to create a file named hello.txt containing the single word hi. Do nothing else.",
        Some("allow"),
    )
    .await;
}

/// Interrupting stops the provider's turn without ending its session: a
/// follow-up on the same JAM session is accepted and completes.
async fn interrupt_then_resume(provider: &str) {
    let (_temp, runtime, project) = setup();
    let workspace = request(&runtime, "workspace.get", json!({})).await.unwrap();
    let project_id = workspace["projects"][0]["id"].as_str().unwrap().to_string();
    request(
        &runtime,
        "project.update",
        json!({"projectId": project_id, "paths": [project.display().to_string()]}),
    )
    .await
    .unwrap();
    let created = request(
        &runtime,
        "conversation.create",
        json!({"projectId": project_id, "presentation": provider, "providerId": provider}),
    )
    .await
    .unwrap();
    let resource_id = created["resource"]["id"].as_str().unwrap().to_string();
    let session_id = created["session"]["id"].as_str().unwrap().to_string();
    let mut subscription = runtime
        .subscribe(jam_runtime::protocol::SubscriptionScope {
            resource_id: Some(resource_id.clone()),
        })
        .unwrap();
    request(
        &runtime,
        "turn.start",
        json!({"resourceId": resource_id, "text": "Write a 1500-word short story about a lighthouse keeper. Do not use any tools.", "context": [], "requestId": "live-long"}),
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(120), async {
        while let Some(event) = subscription.receiver.recv().await {
            if let EventPayload::MessageUpserted { message } = event.payload
                && message.role == "assistant"
                && message
                    .blocks
                    .iter()
                    .any(|b| matches!(b, MessageBlock::Text { text } if text.len() > 40))
            {
                return;
            }
        }
    })
    .await
    .expect("text streams before the interrupt");
    let started = std::time::Instant::now();
    let interrupted = request(&runtime, "turn.interrupt", json!({"sessionId": session_id}))
        .await
        .unwrap();
    assert_eq!(interrupted["interrupted"], true);
    // Only the follow-up's events: the interrupt's own update is queued on
    // the first subscription.
    let mut subscription = runtime
        .subscribe(jam_runtime::protocol::SubscriptionScope {
            resource_id: Some(resource_id.clone()),
        })
        .unwrap();
    let mut accepted = false;
    for _ in 0..60 {
        match request(
            &runtime,
            "turn.start",
            json!({"resourceId": resource_id, "text": "Reply with exactly the word: resumed", "context": [], "requestId": "live-after"}),
        )
        .await
        {
            Ok(_) => {
                accepted = true;
                break;
            }
            Err(error) if error.contains("conflict") => {
                tokio::time::sleep(Duration::from_millis(250)).await
            }
            Err(error) => panic!("{error}"),
        }
    }
    assert!(accepted, "a follow-up is accepted after the interrupt");
    println!(
        "{provider}: follow-up accepted {:?} after interrupt",
        started.elapsed()
    );
    let (status, blocks) = wait_for(&mut subscription.receiver, &runtime, &resource_id, None).await;
    println!(
        "{provider}: after interrupt {status:?} in {:?} {:?}",
        started.elapsed(),
        blocks
            .iter()
            .map(|b| serde_json::to_string(b).unwrap())
            .collect::<Vec<_>>()
    );
    runtime.shutdown().await.unwrap();
    assert_eq!(status, SessionStatus::Idle);
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "sends interrupted and follow-up turns on the signed-in accounts"]
async fn interrupted_turns_resume() {
    if !enabled("JAM_LIVE_TURNS") {
        return;
    }
    interrupt_then_resume("codex").await;
    interrupt_then_resume("claude").await;
}
