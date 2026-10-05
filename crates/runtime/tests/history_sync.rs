mod history_support;
use history_support::*;

async fn sync(rt: &Arc<Runtime>, history_id: &str) -> Result<Value, String> {
    call(
        rt,
        "providerHistory.sync",
        json!({ "historyId": history_id }),
    )
    .await
}

async fn transcript(rt: &Arc<Runtime>, resource_id: &str) -> Vec<Value> {
    call(rt, "conversation.get", json!({ "resourceId": resource_id }))
        .await
        .unwrap()["messages"]
        .as_array()
        .unwrap()
        .clone()
}

#[tokio::test(flavor = "multi_thread")]
async fn only_a_linked_entry_is_synced() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    // Listed, not opened: no project, conversation or access.
    for title in ["Elsewhere", "No folder"] {
        let unlinked = entry(&rt, title).await;
        assert_eq!(
            sync(&rt, &unlinked.id).await.unwrap_err(),
            "project_folder_required"
        );
    }
    assert_eq!(codex.reads(), 0);
    assert_eq!(conversations(&workspace(&rt).await), 0);
    assert_eq!(sync(&rt, "history-none").await.unwrap_err(), "not_found");
}

#[tokio::test(flavor = "multi_thread")]
async fn syncing_a_chat_jam_started_reads_nothing() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 10, Vec::new());
    let rt = open(&temp, &[&codex]);
    let project = add_project(&rt, &temp.folder("project")).await;
    let created = ok(
        &rt,
        "conversation.create",
        json!({ "projectId": project, "presentation": "codex", "providerId": "codex" }),
    )
    .await;
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    let session = created["session"]["id"].as_str().unwrap().to_owned();
    ok(
        &rt,
        "turn.start",
        json!({ "resourceId": resource, "text": "hello", "context": [], "requestId": "r1" }),
    )
    .await;
    idle(&rt, &resource).await;
    codex.threads.lock().unwrap().push(thread(
        &format!("jam-made-{session}"),
        "Started in JAM",
        Some(&temp.folder("project")),
        &["hello"],
    ));
    scan(&rt, "codex").await;
    let linked = entry(&rt, "Started in JAM").await;
    // JAM recorded this transcript itself.
    sync(&rt, &linked.id).await.unwrap();
    assert_eq!(codex.reads(), 0);
    assert_eq!(transcript(&rt, &resource).await.len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn sync_materializes_lazily_idempotently_and_survives_restart() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    let project = add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let a = entry(&rt, "Fix the parser").await;

    let synced = sync(&rt, &a.id).await.unwrap();
    let resource = synced["resource"]["id"].as_str().unwrap().to_owned();
    let session = synced["session"]["id"].as_str().unwrap().to_owned();
    assert_eq!(synced["resource"]["projectId"], project.as_str());
    assert_eq!(synced["resource"]["title"], "Fix the parser");
    assert_eq!(synced["resource"]["updatedAt"], "2026-09-01T10:00:00Z");
    assert_eq!(synced["session"]["providerId"], "codex");
    assert_eq!(synced["session"]["presentation"], "codex");
    assert_eq!(synced["entry"]["resourceId"], resource.as_str());
    // Five messages, read two at a time.
    assert_eq!(codex.reads(), 3);
    let messages = transcript(&rt, &resource).await;
    assert_eq!(messages.len(), 5);
    assert_eq!(messages[0]["blocks"][0]["text"], "parser quokkaword");
    assert_eq!(
        temp.rows(
            "provider_bindings",
            &format!("session_id='{session}' AND native_id='native-a' AND origin='external' AND instance_id='default'")
        ),
        1
    );
    // Only the synced one became a conversation.
    assert_eq!(conversations(&workspace(&rt).await), 1);
    assert_eq!(search(&rt, "quokkaword").await.len(), 1);

    // Unchanged: nothing is read again.
    sync(&rt, &a.id).await.unwrap();
    assert_eq!(codex.reads(), 3);

    // The provider's conversation goes on outside JAM.
    codex.edit("native-a", |t| {
        t.messages
            .push(message("native-a/5", "user", "one more numbatword"));
        t.messages[1].blocks = vec![MessageBlock::Text {
            text: "fixed it, edited".into(),
        }];
        t.item.revision = Some("2".into());
        t.item.updated_at = Some("2026-09-03T10:00:00Z".into());
    });
    scan(&rt, "codex").await;
    assert!(entry(&rt, "Fix the parser").await.changed);
    sync(&rt, &a.id).await.unwrap();
    let after = transcript(&rt, &resource).await;
    assert_eq!(after.len(), 6, "no message is added twice");
    let ids = |list: &[Value]| list.iter().map(|m| m["id"].clone()).collect::<Vec<_>>();
    assert_eq!(
        ids(&after[..5]),
        ids(&messages),
        "messages keep their JAM IDs"
    );
    assert_eq!(after[1]["blocks"][0]["text"], "fixed it, edited");
    assert!(!entry(&rt, "Fix the parser").await.changed);
    // Each message is one search document, however often it was synced.
    assert_eq!(
        temp.rows("messages", &format!("conversation_id='{resource}'")),
        6
    );
    assert_eq!(
        temp.rows("search_documents", &format!("resource_id='{resource}'")),
        6
    );
    assert_eq!(search(&rt, "numbatword").await.len(), 1);
    assert_eq!(search(&rt, "quokkaword").await.len(), 1);

    drop(rt);
    let rt = open(&temp, &[&codex]);
    let reopened = entry(&rt, "Fix the parser").await;
    assert_eq!(reopened.resource_id.as_deref(), Some(resource.as_str()));
    assert!(reopened.synced_at.is_some() && !reopened.changed);
    assert_eq!(transcript(&rt, &resource).await.len(), 6);
    assert_eq!(scan(&rt, "codex").await["discovered"], 0);
    assert_eq!(conversations(&workspace(&rt).await), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn sync_never_rewrites_what_belongs_to_jam() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    let project = add_project(&rt, &temp.folder("project")).await;
    let other = add_project(&rt, &temp.folder("other")).await;
    scan(&rt, "codex").await;

    let a = entry(&rt, "Fix the parser").await;
    let resource = sync(&rt, &a.id).await.unwrap()["resource"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    ok(
        &rt,
        "thread.setPinned",
        json!({ "resourceId": resource, "pinned": true }),
    )
    .await;
    ok(
        &rt,
        "thread.setClosed",
        json!({ "resourceId": resource, "closed": true }),
    )
    .await;
    codex.edit("native-a", |t| {
        t.item.title = Some("Parser, renamed".into());
        t.item.cwd = Some(temp.folder("other"));
        t.item.revision = Some("2".into());
        t.messages.push(message("native-a/5", "assistant", "more"));
    });
    scan(&rt, "codex").await;
    let synced = sync(&rt, &a.id).await.unwrap();
    assert_eq!(synced["resource"]["pinned"], true);
    assert!(synced["resource"]["closedAt"].is_string(), "still archived");
    assert_eq!(
        synced["resource"]["projectId"],
        project.as_str(),
        "keeps its project"
    );
    assert_eq!(synced["resource"]["title"], "Parser, renamed");
    // The title follows into search.
    assert_eq!(
        temp.rows(
            "search_documents",
            &format!("resource_id='{resource}' AND title<>'Parser, renamed'")
        ),
        0
    );

    // The reader's choice of project outlasts what the provider reports.
    let b = entry(&rt, "Elsewhere").await;
    let chosen = ok(
        &rt,
        "providerHistory.associate",
        json!({ "historyId": b.id, "projectId": other }),
    )
    .await;
    assert_eq!(chosen["entry"]["projectId"], other.as_str());
    codex.edit("native-b", |t| t.item.cwd = Some(temp.folder("project")));
    scan(&rt, "codex").await;
    assert_eq!(
        entry(&rt, "Elsewhere").await.project_id.as_deref(),
        Some(other.as_str())
    );
    let synced = sync(&rt, &b.id).await.unwrap();
    assert_eq!(synced["resource"]["projectId"], other.as_str());
    // Once it is a conversation, its project is JAM's.
    assert_eq!(
        err(
            &rt,
            "providerHistory.associate",
            json!({ "historyId": b.id, "projectId": project })
        )
        .await,
        "conflict"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_synced_conversation_resumes_by_its_provider_id() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let a = entry(&rt, "Fix the parser").await;
    let resource = sync(&rt, &a.id).await.unwrap()["resource"]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    ok(
        &rt,
        "turn.start",
        json!({ "resourceId": resource, "text": "keep going", "context": [], "requestId": "r1" }),
    )
    .await;
    idle(&rt, &resource).await;
    let (native, cwd) = codex.turns.lock().unwrap()[0].clone();
    assert_eq!(native.as_deref(), Some("native-a"));
    assert_eq!(
        std::fs::canonicalize(cwd.unwrap()).unwrap(),
        std::fs::canonicalize(temp.folder("project")).unwrap()
    );
    assert_eq!(transcript(&rt, &resource).await.len(), 7);
    // Resuming keeps who created it.
    assert_eq!(
        temp.rows(
            "provider_bindings",
            "native_id='native-a' AND origin='external'"
        ),
        1
    );

    // Continued in JAM, the transcript is JAM's: a later provider change is
    // not merged into it, so nothing is duplicated.
    codex.edit("native-a", |t| {
        t.messages.push(message("native-a/5", "user", "keep going"));
        t.messages
            .push(message("native-a/6", "assistant", "continued in jam"));
        t.item.revision = Some("2".into());
    });
    scan(&rt, "codex").await;
    let reads = codex.reads();
    sync(&rt, &a.id).await.unwrap();
    assert_eq!(codex.reads(), reads);
    assert_eq!(transcript(&rt, &resource).await.len(), 7);
    assert!(!entry(&rt, "Fix the parser").await.changed);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_conversation_the_provider_lost_is_not_found() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let a = entry(&rt, "Fix the parser").await;
    codex.remove("native-a");
    assert_eq!(sync(&rt, &a.id).await.unwrap_err(), "not_found");
    assert!(entry(&rt, "Fix the parser").await.missing_since.is_some());
    assert_eq!(conversations(&workspace(&rt).await), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_conversation_without_a_revision_is_read_on_every_sync() {
    let temp = Temp::new();
    let mut unversioned = thread(
        "native-u",
        "Unversioned",
        Some(&temp.folder("project")),
        &["first"],
    );
    unversioned.item.revision = None;
    unversioned.item.updated_at = None;
    let codex = Scripted::new("codex", 10, vec![unversioned]);
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let entry = entry(&rt, "Unversioned").await;
    let resource = sync(&rt, &entry.id).await.unwrap()["resource"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    codex.edit("native-u", |t| {
        t.messages
            .push(message("native-u/1", "assistant", "second"))
    });
    // Nothing tells JAM it changed, so it reads again rather than assume not.
    sync(&rt, &entry.id).await.unwrap();
    assert_eq!(codex.reads(), 2);
    assert_eq!(transcript(&rt, &resource).await.len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_projection_keeps_the_entry_and_the_providers_history() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let a = entry(&rt, "Fix the parser").await;
    let resource = sync(&rt, &a.id).await.unwrap()["resource"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    ok(
        &rt,
        "conversation.delete",
        json!({ "resourceId": resource }),
    )
    .await;
    // JAM's projection is gone; the provider's own history is not.
    assert_eq!(conversations(&workspace(&rt).await), 0);
    assert_eq!(
        temp.rows("messages", &format!("conversation_id='{resource}'")),
        0
    );
    assert!(search(&rt, "quokkaword").await.is_empty());
    assert_eq!(codex.threads.lock().unwrap()[0].messages.len(), 5);
    // The entry stays indexed, unsynced; a rescan creates no conversation.
    let unlinked = entry(&rt, "Fix the parser").await;
    assert_eq!((unlinked.resource_id, unlinked.synced_at), (None, None));
    scan(&rt, "codex").await;
    assert_eq!(conversations(&workspace(&rt).await), 0);
}
