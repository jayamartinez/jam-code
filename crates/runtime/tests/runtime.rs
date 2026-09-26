use jam_runtime::{
    Runtime,
    protocol::{DemoFixture, EventPayload, Request, SubscriptionScope},
};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};

struct TestDatabase(PathBuf);
impl TestDatabase {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("jam-test-{}.sqlite", uuid::Uuid::new_v4())))
    }
    fn open(&self) -> Arc<Runtime> {
        Runtime::open_demo(&self.0).expect("open test database")
    }
}
impl Drop for TestDatabase {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}

fn request(runtime: &Arc<Runtime>, method: &str, params: Value) -> Value {
    runtime
        .request(Request {
            protocol_version: 1,
            method: method.into(),
            params,
        })
        .unwrap()
}

fn turn(id: &str, text: &str) -> Value {
    json!({"resourceId":"conv-pane-lifetime","text":text,"context":[],"requestId":id})
}

async fn finished(receiver: &mut jam_runtime::EventReceiver) -> String {
    tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(event) = receiver.recv().await {
            if let EventPayload::SessionUpdated { session } = event.payload
                && session.status != jam_runtime::protocol::SessionStatus::Running
            {
                return serde_json::to_value(session.status)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned();
            }
        }
        panic!("subscription ended before a terminal session state")
    })
    .await
    .expect("mock completes within deadline")
}

#[test]
fn seed_contract_migration_reopen_and_search_are_real() {
    let fixture: DemoFixture = serde_json::from_str(include_str!(
        "../../../packages/protocol/fixtures/workspace.json"
    ))
    .unwrap();
    let database = TestDatabase::new();
    let runtime = database.open();
    let first = request(&runtime, "workspace.get", json!({}));
    assert_eq!(
        first["resources"].as_array().unwrap().len(),
        fixture.workspace.resources.len()
    );
    let result = request(
        &runtime,
        "search.query",
        json!({"query":"PTY","projectId":"project-jam","pinned":true}),
    );
    assert!(
        result["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["resourceId"] == "conv-pane-lifetime")
    );
    assert_eq!(
        request(&runtime, "search.query", json!({"query":"\" * --"}))["results"],
        json!([])
    );
    drop(runtime);
    let reopened = database.open();
    let second = request(&reopened, "workspace.get", json!({}));
    assert_eq!(first["resources"], second["resources"]);
    assert_ne!(first["runtimeId"], second["runtimeId"]);
}

#[tokio::test]
async fn retry_deduplicates_and_detach_does_not_stop_work() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let subscription = runtime
        .subscribe(SubscriptionScope {
            resource_id: Some("conv-pane-lifetime".into()),
        })
        .unwrap();
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    let params = turn("retry-demo", "Searchable uniquewordquartz");
    let receipt = request(&runtime, "turn.start", params.clone());
    assert_eq!(request(&runtime, "turn.start", params.clone()), receipt);
    runtime.unsubscribe(&subscription.id).unwrap();
    drop(subscription);
    assert_eq!(finished(&mut observer.receiver).await, "idle");
    let conversation = request(
        &runtime,
        "conversation.get",
        json!({"resourceId":"conv-pane-lifetime"}),
    );
    let matching = conversation["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| {
            m["blocks"]
                .as_array()
                .unwrap()
                .iter()
                .any(|b| b["text"] == "Searchable uniquewordquartz")
        })
        .count();
    assert_eq!(matching, 1);
    assert_eq!(
        request(
            &runtime,
            "search.query",
            json!({"query":"uniquewordquartz"})
        )["results"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let conflict = runtime
        .request(Request {
            protocol_version: 1,
            method: "turn.start".into(),
            params: turn("retry-demo", "Different text"),
        })
        .unwrap_err();
    assert_eq!(conflict.code, "conflict");
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = database.open();
    assert_eq!(request(&reopened, "turn.start", params), receipt);
    assert_eq!(
        request(
            &reopened,
            "conversation.get",
            json!({"resourceId":"conv-pane-lifetime"})
        )["messages"],
        conversation["messages"]
    );
}

#[tokio::test]
async fn interruption_prevents_late_completion_and_scope_filters_events() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let mut unrelated = runtime
        .subscribe(SubscriptionScope {
            resource_id: Some("conv-navigation".into()),
        })
        .unwrap();
    let mut observer = runtime
        .subscribe(SubscriptionScope {
            resource_id: Some("conv-pane-lifetime".into()),
        })
        .unwrap();
    request(
        &runtime,
        "turn.start",
        turn("interrupt-demo", "Please inspect"),
    );
    request(
        &runtime,
        "turn.interrupt",
        json!({"sessionId":"session-pane-lifetime"}),
    );
    assert_eq!(finished(&mut observer.receiver).await, "interrupted");
    assert!(unrelated.receiver.try_recv().is_err());
    tokio::time::sleep(Duration::from_millis(450)).await;
    let workspace = request(&runtime, "workspace.get", json!({}));
    assert_eq!(
        workspace["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == "session-pane-lifetime")
            .unwrap()["status"],
        "interrupted"
    );
    assert_eq!(
        request(
            &runtime,
            "turn.interrupt",
            json!({"sessionId":"session-pane-lifetime"})
        )["interrupted"],
        false
    );
    runtime.shutdown().await.unwrap();
}

#[tokio::test]
async fn provider_failure_is_a_durable_terminal_state() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    request(&runtime, "turn.start", turn("failure-demo", "/fail"));
    assert_eq!(finished(&mut observer.receiver).await, "failed");
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    assert_eq!(
        workspace["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == "session-pane-lifetime")
            .unwrap()["status"],
        "failed"
    );
}

#[tokio::test]
async fn shutdown_interrupts_and_context_only_send_is_explicit() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let created = request(
        &runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"codex"}),
    );
    let resource_id = created["resource"]["id"].as_str().unwrap();
    assert!(
        created["conversation"]["messages"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    request(
        &runtime,
        "turn.start",
        json!({"resourceId":resource_id,"requestId":"context-send","text":"","context":[{"id":"context-demo","kind":"file","label":"example.ts","source":{"uri":"example.ts"}}]}),
    );
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = database.open();
    let conversation = request(
        &reopened,
        "conversation.get",
        json!({"resourceId":resource_id}),
    );
    assert_eq!(conversation["messages"][0]["blocks"][0]["type"], "context");
    let workspace = request(&reopened, "workspace.get", json!({}));
    assert_eq!(
        workspace["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["resourceId"] == resource_id)
            .unwrap()["status"],
        "interrupted"
    );
}

#[test]
fn invalid_requests_do_not_mutate_storage() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let before = request(&runtime, "workspace.get", json!({}));
    for (version, method, params, code) in [
        (2, "workspace.get", json!({}), "unsupported_version"),
        (1, "shell.run", json!({}), "unknown_method"),
        (
            1,
            "conversation.create",
            json!({"projectId":"project-jam","presentation":"codex","unexpected":true}),
            "invalid_request",
        ),
        (1, "turn.start", turn("empty-demo", ""), "invalid_request"),
        (
            1,
            "search.query",
            json!({"query":"test","projectId":null}),
            "invalid_request",
        ),
        (
            1,
            "search.query",
            json!({"query":"test","providerId":"unknown"}),
            "invalid_request",
        ),
        (
            1,
            "turn.start",
            turn("large-demo", &"🟦".repeat(10_001)),
            "invalid_request",
        ),
    ] {
        let error = runtime
            .request(Request {
                protocol_version: version,
                method: method.into(),
                params,
            })
            .unwrap_err();
        assert_eq!(error.code, code);
    }
    assert_eq!(before, request(&runtime, "workspace.get", json!({})));
}

#[tokio::test]
async fn creation_notifies_other_clients_and_overflow_retains_the_last_cursor() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    for _ in 0..300 {
        request(
            &runtime,
            "conversation.create",
            json!({"projectId":"project-jam","presentation":"codex"}),
        );
    }
    let mut delivered = Vec::new();
    while let Ok(event) = observer.receiver.try_recv() {
        delivered.push(event.cursor.sequence);
    }
    assert_eq!(delivered.len(), 257);
    assert_eq!(delivered.last(), Some(&300));
    assert_eq!(delivered[255], 256);
    request(
        &runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"claude"}),
    );
    assert_eq!(observer.receiver.recv().await.unwrap().cursor.sequence, 301);
    runtime.detach_clients().unwrap();
    assert!(observer.receiver.recv().await.is_none());
}

#[test]
fn interrupted_restart_repairs_tool_activity_and_preserves_search_diversity() {
    let database = TestDatabase::new();
    drop(database.open());
    // Simulate durable records left by an interrupted process, without a live second runtime.
    let connection = rusqlite::Connection::open(&database.0).unwrap();
    connection.execute("UPDATE sessions SET data=json_set(data,'$.status','running') WHERE id='session-pane-lifetime'", []).unwrap();
    let message = json!({"id":"crash-message","role":"assistant","createdAt":"2026-09-25T19:00:00Z","blocks":[{"type":"tool","id":"crash-tool","kind":"read","title":"Crash inspection","detail":"Simulated","status":"running"}]});
    connection.execute("INSERT INTO messages(id,conversation_id,ordinal,data) VALUES ('crash-message','conv-pane-lifetime',999,?1)", [message.to_string()]).unwrap();
    // Fifty same-chat hits must not consume the resource-level result limit.
    for _ in 0..60 {
        connection.execute("INSERT INTO search_documents(resource_id,title,body) VALUES ('conv-pane-lifetime','Common title','diversitytoken')", []).unwrap();
    }
    connection.execute("INSERT INTO search_documents(resource_id,title,body) VALUES ('conv-navigation','Other title','diversitytoken')", []).unwrap();
    drop(connection);
    let runtime = database.open();
    let conversation = request(
        &runtime,
        "conversation.get",
        json!({"resourceId":"conv-pane-lifetime"}),
    );
    let message = conversation["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "crash-message")
        .unwrap();
    assert_eq!(message["blocks"][0]["status"], "failed");
    assert_eq!(
        request(&runtime, "search.query", json!({"query":"diversitytoken"}))["results"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn rejected_final_write_does_not_leave_a_phantom_running_session() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let connection = rusqlite::Connection::open(&database.0).unwrap();
    connection
        .execute_batch(
            "CREATE TRIGGER test_reject_final BEFORE INSERT ON messages
        WHEN json_extract(new.data,'$.role')='assistant'
         AND json_array_length(new.data,'$.blocks')=3
        BEGIN SELECT RAISE(FAIL,'injected final write failure'); END;",
        )
        .unwrap();
    drop(connection);
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    request(
        &runtime,
        "turn.start",
        turn("write-failure", "Inspect the boundary"),
    );
    assert_eq!(finished(&mut observer.receiver).await, "failed");
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    assert_eq!(
        workspace["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == "session-pane-lifetime")
            .unwrap()["status"],
        "failed"
    );
}
