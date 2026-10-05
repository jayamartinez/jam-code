//! The provider-history contracts on their own, without the runtime: the
//! paging an adapter's `ProviderHistory` offers, as the scripted provider
//! the other `history_*` tests use implements it, and the wire entry shared
//! with `@jam/protocol`.
mod history_support;
use history_support::*;

fn threads(count: usize) -> Vec<Thread> {
    (0..count)
        .map(|i| {
            let words = ["one", "two", "three", "four", "five"];
            thread(&format!("native-{i}"), &format!("Thread {i}"), None, &words)
        })
        .collect()
}

#[tokio::test]
async fn a_listing_pages_until_it_ends() {
    let provider = Scripted::new("codex", 2, threads(5));
    let mut page = None;
    let mut seen = Vec::new();
    loop {
        let listed = provider
            .list(HistoryListRequest {
                page: page.clone(),
                folders: Vec::new(),
                limit: 10,
                config: ProviderConfig::default(),
            })
            .await
            .unwrap();
        assert!(listed.items.len() <= 2);
        seen.extend(listed.items.into_iter().map(|item| item.native_id));
        match listed.next_page {
            Some(next) => page = Some(next),
            None => break,
        }
    }
    assert_eq!(seen.len(), 5);
    // The runtime's limit is a hint the adapter keeps to.
    let small = provider
        .list(HistoryListRequest {
            page: None,
            folders: Vec::new(),
            limit: 1,
            config: ProviderConfig::default(),
        })
        .await
        .unwrap();
    assert_eq!(small.items.len(), 1);
}

#[tokio::test]
async fn a_read_pages_messages_oldest_first() {
    let provider = Scripted::new("codex", 2, threads(1));
    let read = |page: Option<String>| {
        provider.read(HistoryReadRequest {
            native_id: "native-0".into(),
            page,
            checkpoint: None,
            limit: 2,
            config: ProviderConfig::default(),
        })
    };
    let first = read(None).await.unwrap();
    let ids: Vec<&str> = first
        .messages
        .iter()
        .map(|m| m.source_id.as_str())
        .collect();
    assert_eq!(ids, ["native-0/0", "native-0/1"]);
    assert_eq!(
        first.checkpoint, None,
        "only the last page has a checkpoint"
    );
    let last = read(Some("2".into())).await.unwrap();
    assert_eq!(last.messages.len(), 1);
    assert_eq!(last.next_page, None);
    assert!(last.checkpoint.is_some());
    let gone = provider
        .read(HistoryReadRequest {
            native_id: "missing".into(),
            page: None,
            checkpoint: None,
            limit: 2,
            config: ProviderConfig::default(),
        })
        .await;
    assert_eq!(gone.unwrap_err().code, "not_found");
}

#[test]
fn the_wire_entry_matches_the_shared_fixture() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../packages/protocol/fixtures/provider-history.json"
    ))
    .unwrap();
    let entries: Vec<HistoryEntry> = serde_json::from_value(fixture["entries"].clone()).unwrap();
    assert_eq!(serde_json::to_value(&entries).unwrap(), fixture["entries"]);
    // The provider's own ID is not part of an entry.
    assert!(!fixture.to_string().contains("nativeId"));
}
