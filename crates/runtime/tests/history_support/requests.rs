//! Provider-history requests the history tests make.
use super::*;

pub async fn scan(runtime: &Arc<Runtime>, provider: &str) -> Value {
    call(
        runtime,
        "providerHistory.scan",
        json!({ "providerId": provider }),
    )
    .await
    .unwrap()
}

pub async fn entries(runtime: &Arc<Runtime>, params: Value) -> Vec<HistoryEntry> {
    let listed = call(runtime, "providerHistory.list", params).await.unwrap();
    serde_json::from_value(listed["entries"].clone()).unwrap()
}

pub async fn entry(runtime: &Arc<Runtime>, title: &str) -> HistoryEntry {
    let mut all = entries(runtime, json!({})).await;
    all.extend(entries(runtime, json!({ "ignored": true })).await);
    all.into_iter()
        .find(|entry| entry.title.as_deref() == Some(title))
        .unwrap_or_else(|| panic!("no entry titled {title}"))
}

/// A request that must succeed.
pub async fn ok(rt: &Arc<Runtime>, method: &str, params: Value) -> Value {
    call(rt, method, params)
        .await
        .unwrap_or_else(|code| panic!("{method}: {code}"))
}

/// A request that must fail; its error code.
pub async fn err(rt: &Arc<Runtime>, method: &str, params: Value) -> String {
    call(rt, method, params).await.unwrap_err()
}
