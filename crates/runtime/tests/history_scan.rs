mod history_support;
use history_support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_scan_indexes_history_without_creating_conversations() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;

    let summary = scan(&rt, "codex").await;
    assert_eq!(summary["discovered"], 3);
    assert_eq!(summary["complete"], true);
    assert_eq!(summary["missing"], 0);
    let listed = entries(&rt, json!({ "providerId": "codex" })).await;
    assert_eq!(listed.len(), 3);
    assert!(
        listed
            .iter()
            .all(|e| e.origin == "external" && e.resource_id.is_none())
    );
    // Discovery is metadata only: no transcript was read, no conversation
    // made, no project added, nothing searchable.
    assert_eq!(codex.reads(), 0);
    let workspace = workspace(&rt).await;
    assert_eq!(conversations(&workspace), 0);
    assert_eq!(workspace["projects"].as_array().unwrap().len(), 1);
    assert!(search(&rt, "quokkaword").await.is_empty());
    let a = entry(&rt, "Fix the parser").await;
    assert_eq!(a.preview.as_deref(), Some("Fix the parser preview"));
    assert!(a.resumable);
    // The provider's own IDs never reach the client.
    let wire = ok(&rt, "providerHistory.list", json!({})).await.to_string();
    assert!(!wire.contains("native-"), "{wire}");
}

#[tokio::test(flavor = "multi_thread")]
async fn rescans_are_incremental_and_follow_the_provider() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    scan(&rt, "codex").await;
    let ids: Vec<String> = entries(&rt, json!({}))
        .await
        .into_iter()
        .map(|e| e.id)
        .collect();

    // The same history scanned again is the same entries, unchanged.
    let again = scan(&rt, "codex").await;
    assert_eq!(again["discovered"], 0);
    assert_eq!(again["unchanged"], 3);
    let mut same: Vec<String> = entries(&rt, json!({}))
        .await
        .into_iter()
        .map(|e| e.id)
        .collect();
    let mut before = ids.clone();
    same.sort();
    before.sort();
    assert_eq!(same, before);

    // A rename in the provider updates the entry, not its identity.
    codex.edit("native-a", |t| {
        t.item.title = Some("Fix the parser for real".into());
        t.item.revision = Some("2".into());
        t.item.updated_at = Some("2026-09-02T10:00:00Z".into());
    });
    let renamed = scan(&rt, "codex").await;
    assert_eq!(
        (renamed["updated"].clone(), renamed["unchanged"].clone()),
        (json!(1), json!(2))
    );
    let a = entry(&rt, "Fix the parser for real").await;
    assert!(ids.contains(&a.id));
    assert_eq!(a.updated_at.as_deref(), Some("2026-09-02T10:00:00Z"));

    // A conversation the provider no longer lists is marked, not dropped.
    let gone = codex.remove("native-c");
    let after = scan(&rt, "codex").await;
    assert_eq!(after["missing"], 1);
    let c = entry(&rt, "No folder").await;
    assert!(c.missing_since.is_some());
    // And clears when it is listed again.
    codex.threads.lock().unwrap().push(gone);
    scan(&rt, "codex").await;
    assert_eq!(entry(&rt, "No folder").await.missing_since, None);
    assert_eq!(entries(&rt, json!({})).await.len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn identity_is_the_provider_instance_and_native_id() {
    let temp = Temp::new();
    let codex = Scripted::new(
        "codex",
        10,
        vec![
            thread("same-title-1", "Same title", None, &["one"]),
            thread("same-title-2", "Same title", None, &["two"]),
            thread("shared-id", "From Codex", None, &["codex"]),
        ],
    );
    let claude = Scripted::new(
        "claude",
        10,
        vec![thread("shared-id", "From Claude", None, &["claude"])],
    );
    let rt = open(&temp, &[&codex, &claude]);
    scan(&rt, "codex").await;
    scan(&rt, "codex").await;
    scan(&rt, "claude").await;
    // Scanned twice, still one entry each; the same title is not the same
    // conversation, and the same ID at another provider is not either.
    assert_eq!(
        entries(&rt, json!({ "providerId": "codex" })).await.len(),
        3
    );
    assert_eq!(
        entries(&rt, json!({ "providerId": "claude" })).await.len(),
        1
    );
    assert_eq!(temp.rows("provider_history", "native_id='shared-id'"), 2);
    assert_eq!(temp.rows("provider_history", "instance_id='default'"), 4);
    // A second instance of a provider (another account or home) is a
    // separate conversation even with the same native ID.
    rusqlite::Connection::open(temp.db())
        .unwrap()
        .execute(
            "INSERT INTO provider_history(id,provider_id,instance_id,native_id,origin,discovered_at,sort_at)
             VALUES ('history-work','codex','work','shared-id','external','2026-09-01','2026-09-01')",
            [],
        )
        .unwrap();
    scan(&rt, "codex").await;
    assert_eq!(temp.rows("provider_history", "native_id='shared-id'"), 3);
    let duplicate = rusqlite::Connection::open(temp.db()).unwrap().execute(
        "INSERT INTO provider_history(id,provider_id,instance_id,native_id,origin,discovered_at,sort_at)
         VALUES ('history-dup','codex','default','shared-id','external','2026-09-01','2026-09-01')",
        [],
    );
    assert!(duplicate.is_err(), "identity is unique");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_interrupted_scan_keeps_what_it_saw_and_marks_nothing_missing() {
    let temp = Temp::new();
    let threads: Vec<Thread> = (0..5)
        .map(|i| thread(&format!("native-{i}"), &format!("Thread {i}"), None, &["x"]))
        .collect();
    let codex = Scripted::new("codex", 2, threads);
    let rt = open(&temp, &[&codex]);
    *codex.fail_list_page.lock().unwrap() = Some(1);
    let failed = call(
        &rt,
        "providerHistory.scan",
        json!({ "providerId": "codex" }),
    )
    .await;
    assert_eq!(failed.unwrap_err(), "provider_error");
    // The first page was kept.
    assert_eq!(entries(&rt, json!({})).await.len(), 2);

    *codex.fail_list_page.lock().unwrap() = None;
    assert_eq!(scan(&rt, "codex").await["discovered"], 3);
    // An interrupted scan after a conversation went away marks nothing.
    codex.remove("native-4");
    *codex.fail_list_page.lock().unwrap() = Some(1);
    assert!(
        call(
            &rt,
            "providerHistory.scan",
            json!({ "providerId": "codex" })
        )
        .await
        .is_err()
    );
    assert_eq!(
        temp.rows("provider_history", "missing_since IS NOT NULL"),
        0
    );
    *codex.fail_list_page.lock().unwrap() = None;
    assert_eq!(scan(&rt, "codex").await["missing"], 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn large_histories_are_listed_and_paged_in_bounded_steps() {
    let temp = Temp::new();
    let threads: Vec<Thread> = (0..1_050)
        .map(|i| {
            let mut t = thread(&format!("native-{i:04}"), &format!("Thread {i}"), None, &[]);
            t.item.updated_at = Some(format!("2026-09-01T10:{:02}:{:02}Z", i / 60 % 60, i % 60));
            t
        })
        .collect();
    let codex = Scripted::new("codex", 1_000, threads);
    let rt = open(&temp, &[&codex]);
    let summary = scan(&rt, "codex").await;
    assert_eq!(summary["discovered"], 1_050);
    assert_eq!(summary["complete"], true);
    assert_eq!(conversations(&workspace(&rt).await), 0);

    let mut seen = std::collections::HashSet::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0;
    loop {
        let mut params = json!({ "limit": 200 });
        if let Some(cursor) = &cursor {
            params["cursor"] = json!(cursor);
        }
        let page = call(&rt, "providerHistory.list", params).await.unwrap();
        let listed: Vec<HistoryEntry> = serde_json::from_value(page["entries"].clone()).unwrap();
        assert!(listed.len() <= 200);
        for entry in listed {
            assert!(seen.insert(entry.id), "a page never repeats an entry");
        }
        pages += 1;
        match page["cursor"].as_str() {
            Some(next) => cursor = Some(next.to_owned()),
            None => break,
        }
    }
    assert_eq!(seen.len(), 1_050);
    assert_eq!(pages, 6);
    assert_eq!(
        err(&rt, "providerHistory.list", json!({ "limit": 500 })).await,
        "invalid_request"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_conversation_jam_started_is_linked_not_duplicated() {
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
    // The provider now lists the thread JAM started.
    codex.threads.lock().unwrap().push(thread(
        &format!("jam-made-{session}"),
        "Started in JAM",
        Some(&temp.folder("project")),
        &["hello"],
    ));
    assert_eq!(scan(&rt, "codex").await["discovered"], 1);
    let linked = entry(&rt, "Started in JAM").await;
    assert_eq!(linked.origin, "jam");
    assert_eq!(linked.resource_id.as_deref(), Some(resource.as_str()));
    assert_eq!(conversations(&workspace(&rt).await), 1);
    // Linking reads nothing; the transcript is the one JAM recorded.
    assert_eq!(codex.reads(), 0);

    // Deleting the chat still works and leaves the entry indexed, unlinked.
    ok(
        &rt,
        "conversation.delete",
        json!({ "resourceId": resource }),
    )
    .await;
    assert_eq!(conversations(&workspace(&rt).await), 0);
    let unlinked = entry(&rt, "Started in JAM").await;
    assert_eq!((unlinked.id, unlinked.resource_id), (linked.id, None));
    assert_eq!(
        temp.rows("provider_bindings", &format!("session_id='{session}'")),
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn providers_without_history_say_so() {
    let temp = Temp::new();
    let rt = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider)]).unwrap();
    for (method, params, code) in [
        (
            "providerHistory.scan",
            json!({ "providerId": "mock" }),
            "unsupported",
        ),
        (
            "providerHistory.scan",
            json!({ "providerId": "codex" }),
            "provider_unavailable",
        ),
        (
            "providerHistory.scan",
            json!({ "providerId": "other" }),
            "invalid_request",
        ),
        (
            "providerHistory.list",
            json!({ "cursor": "nonsense" }),
            "invalid_request",
        ),
        (
            "providerHistory.list",
            json!({ "nativeId": "x" }),
            "invalid_request",
        ),
    ] {
        assert_eq!(
            call(&rt, method, params).await.unwrap_err(),
            code,
            "{method}"
        );
    }
    assert_eq!(
        ok(&rt, "providerHistory.list", json!({})).await,
        json!({ "entries": [] })
    );
}
