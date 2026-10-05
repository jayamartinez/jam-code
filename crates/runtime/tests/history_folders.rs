mod history_support;
use history_support::*;

/// What `providerHistory.findInFolders` answers for one folder.
async fn found(rt: &Arc<Runtime>, folder: &str) -> (Vec<HistoryEntry>, u64) {
    let result = ok(
        rt,
        "providerHistory.findInFolders",
        json!({ "paths": [folder] }),
    )
    .await;
    (
        serde_json::from_value(result["entries"].clone()).unwrap(),
        result["total"].as_u64().unwrap(),
    )
}

#[tokio::test(flavor = "multi_thread")]
async fn a_folder_offers_its_chats_from_every_provider_before_it_is_a_project() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let claude = Scripted::new(
        "claude",
        10,
        vec![
            thread(
                "session-1",
                "Claude in the folder",
                Some(&temp.folder("project")),
                &["hi"],
            ),
            thread(
                "session-2",
                "Claude inside it",
                Some(&temp.folder("project/src")),
                &["hi"],
            ),
        ],
    );
    let rt = open(&temp, &[&codex, &claude]);
    let folder = temp.folder("project");

    let (entries, total) = found(&rt, &folder).await;
    assert_eq!(total, 2);
    let mut titles: Vec<_> = entries.iter().filter_map(|e| e.title.clone()).collect();
    titles.sort();
    assert_eq!(titles, ["Claude in the folder", "Fix the parser"]);
    // Offered, not added: no project, no conversation, nothing read.
    assert!(entries.iter().all(|entry| entry.project_id.is_none()));
    assert_eq!(conversations(&workspace(&rt).await), 0);
    assert_eq!(codex.reads() + claude.reads(), 0);

    // Once the folder is a project, the same chats come back linked to it.
    let project = add_project(&rt, &folder).await;
    let (entries, total) = found(&rt, &folder).await;
    assert_eq!(total, 2);
    for entry in &entries {
        assert_eq!(entry.project_id.as_deref(), Some(project.as_str()));
        ok(
            &rt,
            "providerHistory.sync",
            json!({ "historyId": entry.id }),
        )
        .await;
    }
    assert_eq!(conversations(&workspace(&rt).await), 2);
    // Chats already in JAM Code are not offered again.
    assert_eq!(found(&rt, &folder).await.1, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_folder_scan_skips_removed_chats_and_marks_nothing_missing() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    scan(&rt, "codex").await;
    let parser = entry(&rt, "Fix the parser").await;
    ok(
        &rt,
        "providerHistory.ignore",
        json!({ "historyId": parser.id }),
    )
    .await;
    codex.remove("native-b");

    assert_eq!(found(&rt, &temp.folder("project")).await.1, 0);
    // A listing narrowed to a folder is not complete, so what it did not
    // see is not missing.
    assert_eq!(entry(&rt, "Elsewhere").await.missing_since, None);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_provider_that_cannot_answer_leaves_the_others() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    *codex.fail_list_page.lock().unwrap() = Some(0);
    let claude = Scripted::new(
        "claude",
        10,
        vec![thread(
            "session-1",
            "Claude",
            Some(&temp.folder("project")),
            &["hi"],
        )],
    );
    let rt = open(&temp, &[&codex, &claude]);
    let (entries, total) = found(&rt, &temp.folder("project")).await;
    assert_eq!(total, 1);
    assert_eq!(entries[0].title.as_deref(), Some("Claude"));

    assert_eq!(
        err(&rt, "providerHistory.findInFolders", json!({ "paths": [] })).await,
        "invalid_request"
    );
    let many: Vec<String> = (0..17).map(|i| temp.folder(&format!("f{i}"))).collect();
    assert_eq!(
        err(
            &rt,
            "providerHistory.findInFolders",
            json!({ "paths": many })
        )
        .await,
        "invalid_request"
    );
}
