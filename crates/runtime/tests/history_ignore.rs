mod history_support;
use history_support::*;

#[tokio::test(flavor = "multi_thread")]
async fn ignored_entries_stay_hidden_until_restored() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 10, three(&temp));
    let rt = open(&temp, &[&codex]);
    scan(&rt, "codex").await;
    let b = entry(&rt, "Elsewhere").await;
    let ignored = ok(&rt, "providerHistory.ignore", json!({ "historyId": b.id })).await;
    assert!(ignored["entry"]["ignoredAt"].is_string());
    // A rescan neither shows it again nor indexes it twice.
    assert_eq!(scan(&rt, "codex").await["discovered"], 0);
    assert!(entries(&rt, json!({})).await.iter().all(|e| e.id != b.id));
    let tombstones = entries(&rt, json!({ "ignored": true })).await;
    assert_eq!(tombstones.len(), 1);
    assert_eq!(tombstones[0].id, b.id);
    // The provider's history is untouched.
    assert_eq!(codex.threads.lock().unwrap().len(), 3);
    ok(&rt, "providerHistory.restore", json!({ "historyId": b.id })).await;
    assert!(entries(&rt, json!({})).await.iter().any(|e| e.id == b.id));
    assert!(entries(&rt, json!({ "ignored": true })).await.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn ignoring_an_unknown_entry_is_not_found() {
    let temp = Temp::new();
    let rt = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider)]).unwrap();
    for method in ["providerHistory.ignore", "providerHistory.restore"] {
        let code = call(&rt, method, json!({ "historyId": "history-none" })).await;
        assert_eq!(code.unwrap_err(), "not_found", "{method}");
    }
}
