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

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_projection_leaves_a_tombstone_until_restored() {
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
    assert_eq!(temp.rows("provider_bindings", "native_id='native-a'"), 0);
    assert!(search(&rt, "quokkaword").await.is_empty());
    assert_eq!(codex.threads.lock().unwrap().len(), 3);
    assert_eq!(codex.threads.lock().unwrap()[0].messages.len(), 5);
    // It is a tombstone: hidden, and a rescan does not bring it back.
    assert!(entries(&rt, json!({})).await.iter().all(|e| e.id != a.id));
    let ignored = entries(&rt, json!({ "ignored": true })).await;
    assert_eq!(ignored.len(), 1);
    assert_eq!(
        (ignored[0].id.as_str(), ignored[0].resource_id.as_deref()),
        (a.id.as_str(), None)
    );
    assert_eq!(scan(&rt, "codex").await["discovered"], 0);
    assert_eq!(conversations(&workspace(&rt).await), 0);
    assert_eq!(entries(&rt, json!({ "ignored": true })).await.len(), 1);
    assert_eq!(sync(&rt, &a.id).await.unwrap_err(), "conflict");

    // Restoring lists it again, and syncing makes a new projection.
    let restored = ok(&rt, "providerHistory.restore", json!({ "historyId": a.id })).await;
    assert!(restored["entry"]["ignoredAt"].is_null());
    assert_eq!(entries(&rt, json!({})).await.len(), 3);
    let again = sync(&rt, &a.id).await.unwrap();
    assert_ne!(again["resource"]["id"], resource.as_str());
    assert_eq!(search(&rt, "quokkaword").await.len(), 1);

    // An entry that was never synced is ignored and restored directly; a
    // synced one is removed by deleting its chat.
    let b = entry(&rt, "Elsewhere").await;
    ok(&rt, "providerHistory.ignore", json!({ "historyId": b.id })).await;
    scan(&rt, "codex").await;
    assert!(entries(&rt, json!({})).await.iter().all(|e| e.id != b.id));
    ok(&rt, "providerHistory.restore", json!({ "historyId": b.id })).await;
    assert!(entries(&rt, json!({})).await.iter().any(|e| e.id == b.id));
    assert_eq!(
        err(&rt, "providerHistory.ignore", json!({ "historyId": a.id })).await,
        "conflict"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_chat_jam_started_keeps_its_semantics() {
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
    let native = format!("jam-made-{session}");
    assert_eq!(
        temp.rows(
            "provider_bindings",
            &format!("native_id='{native}' AND origin='jam'")
        ),
        1
    );

    ok(
        &rt,
        "conversation.delete",
        json!({ "resourceId": resource }),
    )
    .await;
    for (table, filter) in [
        ("resources", format!("id='{resource}'")),
        ("sessions", format!("id='{session}'")),
        ("messages", format!("conversation_id='{resource}'")),
        ("search_documents", format!("resource_id='{resource}'")),
        ("provider_bindings", format!("session_id='{session}'")),
    ] {
        assert_eq!(temp.rows(table, &filter), 0, "{table}");
    }
    // The provider still has the thread; scanning it later does not bring
    // the deleted chat back as someone else's conversation.
    codex
        .threads
        .lock()
        .unwrap()
        .push(thread(&native, "Started in JAM", None, &["hello"]));
    assert_eq!(scan(&rt, "codex").await["discovered"], 0);
    assert!(entries(&rt, json!({})).await.is_empty());
    let tombstone = entries(&rt, json!({ "ignored": true })).await;
    assert_eq!(tombstone.len(), 1);
    assert_eq!(tombstone[0].origin, "jam");
    assert_eq!(conversations(&workspace(&rt).await), 0);
}
