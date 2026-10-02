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

#[test]
fn file_resources_keep_one_identity_per_path_and_survive_restart() {
    let database = TestDatabase::new();
    let runtime = database.open();

    // A directory listing resolves one level; nested files are not shipped yet.
    let root = request(
        &runtime,
        "directory.list",
        json!({"projectId":"project-jam","path":""}),
    );
    let names: Vec<&str> = root["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"src") && names.contains(&"package.json"));
    assert!(!names.contains(&"registry.ts"));
    assert_eq!(root["demo"], json!(true));

    // Opening the same file twice is the same resource, not a duplicate record.
    let first = request(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"file","path":"src/session/registry.ts"}),
    );
    let again = request(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"file","path":"src/session/registry.ts"}),
    );
    assert_eq!(first["resource"]["id"], again["resource"]["id"]);
    assert_eq!(first["resource"]["title"], json!("registry.ts"));
    let other = request(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"file","path":"src/panes/layout.ts"}),
    );
    assert_ne!(first["resource"]["id"], other["resource"]["id"]);

    // A file browser is its own resource kind, distinct from the review surface.
    let browser = request(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"file-browser"}),
    );
    assert_eq!(browser["resource"]["kind"], json!("file-browser"));
    assert_ne!(browser["resource"]["id"], first["resource"]["id"]);

    let contents = request(
        &runtime,
        "file.read",
        json!({"projectId":"project-jam","path":"src/session/registry.ts"}),
    );
    assert_eq!(contents["language"], json!("typescript"));
    assert_eq!(contents["writable"], json!(true));
    assert!(
        contents["text"]
            .as_str()
            .unwrap()
            .contains("export function attach")
    );

    // Paths that would leave the project, and unknown targets, fail loudly.
    for path in ["../../etc/passwd", "/etc/passwd", "src/../../x"] {
        assert!(
            runtime
                .request(Request {
                    protocol_version: 1,
                    method: "file.read".into(),
                    params: json!({"projectId":"project-jam","path":path}),
                })
                .is_err(),
            "{path} must be rejected"
        );
    }
    assert!(
        runtime
            .request(Request {
                protocol_version: 1,
                method: "resource.open".into(),
                params: json!({"projectId":"project-jam","kind":"file","path":"does/not/exist.ts"}),
            })
            .is_err()
    );
    assert!(
        runtime
            .request(Request {
                protocol_version: 1,
                method: "resource.open".into(),
                params: json!({"projectId":"project-jam","kind":"settings"}),
            })
            .is_err()
    );

    // The record is durable, so reopening after a restart keeps its identity.
    drop(runtime);
    let reopened = database.open();
    let after = request(
        &reopened,
        "resource.open",
        json!({"projectId":"project-jam","kind":"file","path":"src/session/registry.ts"}),
    );
    assert_eq!(after["resource"]["id"], first["resource"]["id"]);
    let workspace = request(&reopened, "workspace.get", json!({}));
    let files = workspace["resources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|resource| resource["path"] == json!("src/session/registry.ts"))
        .count();
    assert_eq!(files, 1);
}

#[test]
fn saving_a_file_persists_the_working_copy_across_restart() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let path = "src/session/registry.ts";
    let original = request(
        &runtime,
        "file.read",
        json!({"projectId":"project-jam","path":path}),
    );
    let edited = format!("{}\n// edited\n", original["text"].as_str().unwrap());

    let receipt = request(
        &runtime,
        "file.write",
        json!({"projectId":"project-jam","path":path,"text":edited}),
    );
    assert_eq!(receipt["path"], json!(path));
    assert!(receipt["savedAt"].as_str().is_some());

    let after = request(
        &runtime,
        "file.read",
        json!({"projectId":"project-jam","path":path}),
    );
    assert_eq!(after["text"], json!(edited));

    // A save is a durable working copy, not an in-memory overlay.
    drop(runtime);
    let reopened = database.open();
    let restored = request(
        &reopened,
        "file.read",
        json!({"projectId":"project-jam","path":path}),
    );
    assert_eq!(restored["text"], json!(edited));

    // Another file in the same project is untouched by that save.
    let other = request(
        &reopened,
        "file.read",
        json!({"projectId":"project-jam","path":"src/panes/layout.ts"}),
    );
    assert!(!other["text"].as_str().unwrap().contains("// edited"));

    // Writes outside the project, or to paths it does not contain, fail.
    for bad in [
        json!({"projectId":"project-jam","path":"../escape.ts","text":"x"}),
        json!({"projectId":"project-jam","path":"does/not/exist.ts","text":"x"}),
        json!({"projectId":"project-missing","path":"a.ts","text":"x"}),
    ] {
        assert!(
            reopened
                .request(Request {
                    protocol_version: 1,
                    method: "file.write".into(),
                    params: bad.clone(),
                })
                .is_err(),
            "{bad} must be rejected"
        );
    }
}

#[test]
fn editing_a_project_persists_name_paths_and_icon() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let updated = request(
        &runtime,
        "project.update",
        json!({
            "projectId": "project-jam",
            "name": "Jam Studio",
            "paths": ["/Users/me/dev/jam", "C:\\Users\\me\\dev\\jam", "\\\\server\\share\\jam"],
            "icon": {"kind": "emoji", "value": "🍓"}
        }),
    );
    assert_eq!(updated["project"]["name"], json!("Jam Studio"));
    // Initials follow the new name.
    assert_eq!(updated["project"]["initials"], json!("JS"));
    assert_eq!(updated["project"]["paths"].as_array().unwrap().len(), 3);

    let preset = request(
        &runtime,
        "project.update",
        json!({"projectId":"project-jam","icon":{"kind":"preset","value":"rocket","tone":"green"}}),
    );
    assert_eq!(preset["project"]["icon"]["value"], json!("rocket"));
    assert_eq!(preset["project"]["name"], json!("Jam Studio"));

    // Everything survives a restart.
    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    let project = workspace["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == json!("project-jam"))
        .unwrap()
        .clone();
    assert_eq!(project["name"], json!("Jam Studio"));
    assert_eq!(project["icon"]["tone"], json!("green"));
    assert_eq!(project["paths"][1], json!("C:\\Users\\me\\dev\\jam"));

    // Plain initials in the default tone clears the icon entirely.
    let cleared = request(
        &reopened,
        "project.update",
        json!({"projectId":"project-jam","icon":{"kind":"initials"}}),
    );
    assert!(cleared["project"].get("icon").is_none());

    for bad in [
        json!({"projectId":"project-jam","name":"   "}),
        json!({"projectId":"project-jam","paths":["relative/path"]}),
        json!({"projectId":"project-jam","icon":{"kind":"preset","value":"not-a-preset"}}),
        json!({"projectId":"project-jam","icon":{"kind":"preset","value":"rocket","tone":"neon"}}),
        json!({"projectId":"project-jam","icon":{"kind":"emoji","value":"<script>"}}),
        json!({"projectId":"project-jam","icon":{"kind":"image","value":"https://evil.example/x.png"}}),
        json!({"projectId":"project-missing","name":"x"}),
    ] {
        assert!(
            reopened
                .request(Request {
                    protocol_version: 1,
                    method: "project.update".into(),
                    params: bad.clone(),
                })
                .is_err(),
            "{bad} must be rejected"
        );
    }
}

fn resource_in(workspace: &Value, id: &str) -> Value {
    workspace["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == json!(id))
        .unwrap()
        .clone()
}

#[tokio::test]
async fn closing_a_thread_is_explicit_durable_and_undone_by_sending() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let closed = request(
        &runtime,
        "thread.setClosed",
        json!({"resourceId":"conv-pane-lifetime","closed":true}),
    );
    assert!(closed["resource"]["closedAt"].is_string());
    let kept = request(
        &runtime,
        "thread.keepOpen",
        json!({"resourceId":"conv-navigation"}),
    );
    assert!(kept["resource"]["closeSuggestionDismissedAt"].is_string());
    assert!(kept["resource"].get("closedAt").is_none());

    // Only conversations are threads.
    for (method, params) in [
        (
            "thread.setClosed",
            json!({"resourceId":"diff-pane","closed":true}),
        ),
        ("thread.keepOpen", json!({"resourceId":"diff-pane"})),
        (
            "thread.setClosed",
            json!({"resourceId":"conv-missing","closed":true}),
        ),
    ] {
        assert!(
            runtime
                .request(Request {
                    protocol_version: 1,
                    method: method.into(),
                    params,
                })
                .is_err()
        );
    }

    // Both survive a restart.
    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    assert!(resource_in(&workspace, "conv-pane-lifetime")["closedAt"].is_string());
    assert!(resource_in(&workspace, "conv-navigation")["closeSuggestionDismissedAt"].is_string());

    // Sending into a closed thread reopens it.
    let mut observer = reopened.subscribe(SubscriptionScope::default()).unwrap();
    request(
        &reopened,
        "turn.start",
        turn("reopen-by-send", "Back to this"),
    );
    assert_eq!(finished(&mut observer.receiver).await, "idle");
    let workspace = request(&reopened, "workspace.get", json!({}));
    assert!(
        resource_in(&workspace, "conv-pane-lifetime")
            .get("closedAt")
            .is_none()
    );

    // Reopening explicitly works too.
    request(
        &reopened,
        "thread.setClosed",
        json!({"resourceId":"conv-layout","closed":true}),
    );
    let reopened_thread = request(
        &reopened,
        "thread.setClosed",
        json!({"resourceId":"conv-layout","closed":false}),
    );
    assert!(reopened_thread["resource"].get("closedAt").is_none());
}

#[tokio::test]
async fn archiving_waits_for_the_agent_and_keeps_the_chat_whole_and_searchable() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let archive = |archived: bool| Request {
        protocol_version: 1,
        method: "thread.setClosed".into(),
        params: json!({"resourceId":"conv-pane-lifetime","closed":archived}),
    };
    let before = resource_in(
        &request(&runtime, "workspace.get", json!({})),
        "conv-pane-lifetime",
    );

    // A working chat is not put away mid-turn; archiving never interrupts.
    let mut observer = runtime.subscribe(SubscriptionScope::default()).unwrap();
    request(
        &runtime,
        "turn.start",
        turn("archive-busy", "Remember uniquewordonyx"),
    );
    assert_eq!(runtime.request(archive(true)).unwrap_err().code, "conflict");
    assert_eq!(finished(&mut observer.receiver).await, "idle");

    // Nor is one whose agent waits for an answer.
    request(&runtime, "turn.start", turn("archive-waiting", "/approval"));
    let session_id = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(event) = observer.receiver.recv().await {
            if let EventPayload::SessionUpdated { session } = event.payload
                && session.needs_input
            {
                return session.id;
            }
        }
        panic!("the demo provider never asked")
    })
    .await
    .expect("the approval arrives within the deadline");
    assert_eq!(runtime.request(archive(true)).unwrap_err().code, "conflict");
    request(&runtime, "turn.interrupt", json!({"sessionId":session_id}));

    // Settled, it archives. Nothing but `closedAt` changes.
    let archived = runtime.request(archive(true)).unwrap()["resource"].clone();
    assert!(archived["closedAt"].is_string());
    for field in ["projectId", "sessionId", "pinned", "title"] {
        assert_eq!(archived[field], before[field], "{field} is kept");
    }
    assert_eq!(archived["pinned"], json!(true));
    let workspace = request(&runtime, "workspace.get", json!({}));
    assert!(
        workspace["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|session| session["id"] == json!(session_id))
    );
    // Search still finds an archived chat, after a restart too.
    drop(observer);
    runtime.shutdown().await.unwrap();
    drop(runtime);
    let reopened = database.open();
    let found = request(&reopened, "search.query", json!({"query":"uniquewordonyx"}));
    assert_eq!(found["results"][0]["resourceId"], "conv-pane-lifetime");
    let transcript = request(
        &reopened,
        "conversation.get",
        json!({"resourceId":"conv-pane-lifetime"}),
    );
    assert!(!transcript["messages"].as_array().unwrap().is_empty());
    // Reopening is always allowed.
    assert!(
        reopened.request(archive(false)).unwrap()["resource"]
            .get("closedAt")
            .is_none()
    );
}

#[test]
fn pinning_a_chat_is_explicit_and_durable() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let pin = |runtime: &Arc<Runtime>, id: &str, pinned: bool| {
        runtime.request(Request {
            protocol_version: 1,
            method: "thread.setPinned".into(),
            params: json!({"resourceId":id,"pinned":pinned}),
        })
    };
    // conv-browser starts unpinned; conv-pane-lifetime is pinned by the fixture.
    let before = request(&runtime, "workspace.get", json!({}));
    assert_eq!(resource_in(&before, "conv-browser")["pinned"], json!(false));
    let pinned = pin(&runtime, "conv-browser", true).unwrap();
    assert_eq!(pinned["resource"]["pinned"], json!(true));
    let unpinned = pin(&runtime, "conv-pane-lifetime", false).unwrap();
    assert_eq!(unpinned["resource"]["pinned"], json!(false));
    // Nothing else about either chat changes.
    for field in ["title", "projectId", "sessionId", "updatedAt"] {
        assert_eq!(
            pinned["resource"][field],
            resource_in(&before, "conv-browser")[field]
        );
    }
    // Only conversations are pinned this way.
    assert_eq!(
        pin(&runtime, "diff-pane", true).unwrap_err().code,
        "invalid_request"
    );
    assert_eq!(
        pin(&runtime, "conv-missing", true).unwrap_err().code,
        "not_found"
    );

    // Both survive a restart, and the pinned search filter follows them.
    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    assert_eq!(
        resource_in(&workspace, "conv-browser")["pinned"],
        json!(true)
    );
    assert_eq!(
        resource_in(&workspace, "conv-pane-lifetime")["pinned"],
        json!(false)
    );
    let found = request(
        &reopened,
        "search.query",
        json!({"query":"PTY","pinned":true}),
    );
    assert!(
        !found["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|result| result["resourceId"] == "conv-pane-lifetime")
    );
}

#[test]
fn pinning_a_project_persists_and_unpinning_clears_it() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let pinned = request(
        &runtime,
        "project.update",
        json!({"projectId":"project-orbit","pinned":true}),
    );
    assert_eq!(pinned["project"]["pinned"], json!(true));
    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    let orbit = workspace["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == json!("project-orbit"))
        .unwrap()
        .clone();
    assert_eq!(orbit["pinned"], json!(true));
    let unpinned = request(
        &reopened,
        "project.update",
        json!({"projectId":"project-orbit","pinned":false}),
    );
    assert!(unpinned["project"].get("pinned").is_none());
}

#[test]
fn every_browser_open_is_a_distinct_durable_resource() {
    let database = TestDatabase::new();
    let runtime = database.open();
    let open = |runtime: &Arc<Runtime>| {
        request(
            runtime,
            "resource.open",
            json!({"projectId":"project-jam","kind":"browser"}),
        )["resource"]
            .clone()
    };
    // Two browsers in one project are two pages with their own history.
    let first = open(&runtime);
    let second = open(&runtime);
    assert_eq!(first["kind"], json!("browser"));
    assert_ne!(first["id"], second["id"]);
    // The id doubles as the host's native view label, so its shape matters.
    assert!(first["id"].as_str().unwrap().starts_with("browser-"));
    assert!(
        runtime
            .request(Request {
                protocol_version: 1,
                method: "resource.open".into(),
                params: json!({"projectId":"project-jam","kind":"browser","path":"x"}),
            })
            .is_err()
    );

    drop(runtime);
    let reopened = database.open();
    let workspace = request(&reopened, "workspace.get", json!({}));
    for browser in [&first, &second] {
        let id = browser["id"].as_str().unwrap();
        assert_eq!(resource_in(&workspace, id)["kind"], json!("browser"));
    }
}

fn appearance_defaults() -> Value {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../packages/protocol/fixtures/appearance.json"
    ))
    .unwrap();
    fixture["defaults"].clone()
}

#[test]
fn appearance_is_a_runtime_setting_that_survives_restart() {
    let database = TestDatabase::new();
    let runtime = database.open();

    // Nothing is stored until the reader changes something.
    assert_eq!(request(&runtime, "appearance.get", json!({})), json!({}));

    let mut appearance = appearance_defaults();
    appearance["theme"] = json!("frost");
    appearance["accent"] = json!("custom");
    appearance["customAccent"] = json!("#3366cc");
    appearance["codeFont"] = json!("JetBrains Mono");
    appearance["paneOpacity"] = json!(88);
    let saved = request(
        &runtime,
        "appearance.update",
        json!({ "appearance": appearance }),
    );
    assert_eq!(saved["appearance"], appearance);

    let wallpaper = json!({
        "dataUrl": "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
        "name": "harbour.jpg",
        "width": 1920,
        "height": 1080,
    });
    let receipt = request(
        &runtime,
        "appearance.setWallpaper",
        json!({ "wallpaper": wallpaper }),
    );
    assert!(receipt["updatedAt"].as_str().is_some());

    // Invalid updates are rejected before anything is written.
    for bad in [
        json!({ "appearance": { "theme": "frost" } }),
        json!({ "appearance": Value::Null }),
        json!({ "appearance": { "surprise": 1 } }),
    ] {
        assert!(
            runtime
                .request(Request {
                    protocol_version: 1,
                    method: "appearance.update".into(),
                    params: bad.clone(),
                })
                .is_err(),
            "{bad} must be rejected"
        );
    }
    let mut out_of_range = appearance.clone();
    out_of_range["uiFontSize"] = json!(64);
    assert!(
        runtime
            .request(Request {
                protocol_version: 1,
                method: "appearance.update".into(),
                params: json!({ "appearance": out_of_range }),
            })
            .is_err()
    );
    assert!(
        runtime
            .request(Request {
                protocol_version: 1,
                method: "appearance.setWallpaper".into(),
                params: json!({ "wallpaper": { "dataUrl": "file:///etc/passwd", "name": "x", "width": 1, "height": 1 } }),
            })
            .is_err()
    );

    drop(runtime);
    let reopened = database.open();
    let restored = request(&reopened, "appearance.get", json!({}));
    assert_eq!(restored["appearance"], appearance);
    assert_eq!(restored["wallpaper"], wallpaper);

    // Omitting the wallpaper forgets it; the appearance record is untouched.
    request(&reopened, "appearance.setWallpaper", json!({}));
    let cleared = request(&reopened, "appearance.get", json!({}));
    assert!(cleared.get("wallpaper").is_none());
    assert_eq!(cleared["appearance"], appearance);
}
