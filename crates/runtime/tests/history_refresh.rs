mod history_support;
use history_support::*;

/// Syncs "Fix the parser" into the project; its resource ID.
async fn synced(rt: &Arc<Runtime>, temp: &Temp) -> String {
    add_project(rt, &temp.folder("project")).await;
    scan(rt, "codex").await;
    let parser = entry(rt, "Fix the parser").await;
    let synced = ok(
        rt,
        "providerHistory.sync",
        json!({ "historyId": parser.id }),
    )
    .await;
    synced["resource"]["id"].as_str().unwrap().to_owned()
}

async fn refresh(rt: &Arc<Runtime>, resource_id: &str) -> bool {
    ok(
        rt,
        "providerHistory.refresh",
        json!({ "resourceId": resource_id }),
    )
    .await["refreshed"]
        .as_bool()
        .unwrap()
}

async fn texts(rt: &Arc<Runtime>, resource_id: &str) -> Vec<String> {
    let conversation = ok(rt, "conversation.get", json!({ "resourceId": resource_id })).await;
    conversation["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            m["blocks"][0]["text"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        })
        .collect()
}

/// The provider's conversation moves on, as when the reader keeps working in
/// Claude Code or Codex directly.
fn continue_outside(codex: &Scripted, words: &[&str]) {
    codex.edit("native-a", |thread| {
        let start = thread.messages.len();
        for (offset, word) in words.iter().enumerate() {
            let index = start + offset;
            let role = if index % 2 == 0 { "user" } else { "assistant" };
            thread
                .messages
                .push(message(&format!("native-a/{index}"), role, word));
        }
        thread.item.revision = Some(format!("{}", start + words.len()));
        thread.item.updated_at = Some("2026-09-02T10:00:00Z".into());
    });
}

#[tokio::test(flavor = "multi_thread")]
async fn a_synced_chat_catches_up_only_when_its_provider_moved_on() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    let resource_id = synced(&rt, &temp).await;
    let reads = codex.reads();

    // Unchanged: nothing is read again.
    assert!(!refresh(&rt, &resource_id).await);
    assert_eq!(codex.reads(), reads);

    continue_outside(&codex, &["one more thing", "done that"]);
    assert!(refresh(&rt, &resource_id).await);
    let after = texts(&rt, &resource_id).await;
    assert_eq!(after.len(), 7);
    assert_eq!(after[5..], ["one more thing", "done that"]);
    // Asked again, nothing changed, and nothing is added twice.
    assert!(!refresh(&rt, &resource_id).await);
    assert_eq!(texts(&rt, &resource_id).await.len(), 7);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chat_continued_in_jam_or_gone_from_the_provider_is_left_as_it_is() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    let resource_id = synced(&rt, &temp).await;

    ok(
        &rt,
        "turn.start",
        json!({ "resourceId": resource_id, "text": "carry on", "context": [], "requestId": "continue-1" }),
    )
    .await;
    idle(&rt, &resource_id).await;
    let before = texts(&rt, &resource_id).await;
    continue_outside(&codex, &["elsewhere"]);
    assert!(!refresh(&rt, &resource_id).await);
    assert_eq!(texts(&rt, &resource_id).await, before);

    // A conversation that is no projection, and one the provider lost.
    let other = Temp::new();
    let gone = Scripted::new("codex", 2, three(&other));
    let rt = open(&other, &[&gone]);
    let resource_id = synced(&rt, &other).await;
    gone.remove("native-a");
    assert!(!refresh(&rt, &resource_id).await);
    let settings = workspace(&rt).await["resources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["kind"] == "settings")
        .map(|r| r["id"].as_str().unwrap().to_owned());
    if let Some(settings) = settings {
        assert!(!refresh(&rt, &settings).await);
    }
}
