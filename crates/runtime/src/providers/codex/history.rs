//! Codex's own thread history, read through `codex app-server`: `thread/list`
//! for metadata and `thread/turns/list` for one thread's turns, both paged by
//! Codex's cursors. Both run on the shared app-server and count as activity,
//! so its idle shutdown waits for them. Nothing here starts a turn.
use super::{
    CodexAdapter,
    items::{self, ItemBlock},
};
use crate::{
    error::JamError,
    protocol::MessageBlock,
    providers::{
        HistoryFuture, HistoryItem, HistoryItemRequest, HistoryListRequest, HistoryMessage,
        HistoryPage, HistoryReadRequest, HistoryTranscript, ProviderConfig, ProviderHistory,
    },
};
use serde_json::{Value, json};
use std::{path::Path, sync::atomic::Ordering};

/// The most threads or turns asked for in one page.
const PAGE_LIMIT: usize = 100;

impl CodexAdapter {
    async fn history_request(
        &self,
        config: &ProviderConfig,
        method: &str,
        params: Value,
    ) -> Result<Value, JamError> {
        self.inner.active.fetch_add(1, Ordering::AcqRel);
        let result = async {
            let server = self.server(config).await?;
            server
                .connection
                .request(method, params)
                .await
                .map_err(|error| {
                    // Codex answers a thread it has no record of with
                    // "thread not loaded" (codex-cli 0.160).
                    let message = error.message.to_lowercase();
                    let missing =
                        message.contains("not found") || message.contains("thread not loaded");
                    let error = error.into_jam("Codex could not read its history");
                    if missing {
                        JamError::new("not_found", error.message)
                    } else {
                        error
                    }
                })
        }
        .await;
        self.inner.active.fetch_sub(1, Ordering::AcqRel);
        self.schedule_idle_shutdown();
        result
    }
}

impl ProviderHistory for CodexAdapter {
    fn list(&self, request: HistoryListRequest) -> HistoryFuture<HistoryPage> {
        let adapter = self.clone();
        Box::pin(async move {
            let mut params = json!({
                "limit": request.limit.clamp(1, PAGE_LIMIT),
                "sortKey": "updated_at",
            });
            if let Some(page) = request.page {
                params["cursor"] = json!(page);
            }
            if !request.folders.is_empty() {
                params["cwd"] = json!(request.folders);
            }
            let result = adapter
                .history_request(&request.config, "thread/list", params)
                .await?;
            Ok(list_page(&result))
        })
    }

    fn item(&self, request: HistoryItemRequest) -> HistoryFuture<Option<HistoryItem>> {
        let adapter = self.clone();
        Box::pin(async move {
            let params = json!({ "threadId": request.native_id, "includeTurns": false });
            match adapter
                .history_request(&request.config, "thread/read", params)
                .await
            {
                Ok(result) => Ok(result.get("thread").and_then(thread_item)),
                Err(error) if error.code == "not_found" => Ok(None),
                Err(error) => Err(error),
            }
        })
    }

    fn read(&self, request: HistoryReadRequest) -> HistoryFuture<HistoryTranscript> {
        let adapter = self.clone();
        Box::pin(async move {
            let mut params = json!({
                "threadId": request.native_id,
                "limit": request.limit.clamp(1, PAGE_LIMIT),
                "sortDirection": "asc",
                "itemsView": "full",
            });
            if let Some(page) = &request.page {
                params["cursor"] = json!(page);
            }
            let result = adapter
                .history_request(&request.config, "thread/turns/list", params)
                .await?;
            let turns = result.get("data").and_then(Value::as_array);
            let next_page = text(&result, "nextCursor").map(str::to_owned);
            Ok(HistoryTranscript {
                item: None,
                messages: turns.map(|turns| messages(turns)).unwrap_or_default(),
                checkpoint: None,
                next_page,
            })
        })
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// A Unix time in seconds as RFC 3339.
fn unix(value: Option<&Value>) -> Option<String> {
    let seconds = value?.as_i64()?;
    time::OffsetDateTime::from_unix_timestamp(seconds)
        .ok()?
        .format(&time::format_description::well_known::Rfc3339)
        .ok()
}

/// One `thread/list` page. Sub-agent threads belong to their parent and
/// ephemeral ones are never saved, so neither is listed.
fn list_page(result: &Value) -> HistoryPage {
    let items = result
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|thread| {
            thread.get("parentThreadId").is_none_or(Value::is_null)
                && thread.get("ephemeral").and_then(Value::as_bool) != Some(true)
        })
        .filter_map(thread_item)
        .collect();
    HistoryPage {
        items,
        next_page: text(result, "nextCursor").map(str::to_owned),
    }
}

/// One thread's listing metadata.
fn thread_item(thread: &Value) -> Option<HistoryItem> {
    Some(HistoryItem {
        native_id: text(thread, "id")?.to_owned(),
        // Codex shows a thread without a name by its first message.
        title: text(thread, "name")
            .or_else(|| text(thread, "preview"))
            .map(str::to_owned),
        preview: text(thread, "preview").map(str::to_owned),
        created_at: unix(thread.get("createdAt")),
        updated_at: unix(thread.get("updatedAt")),
        revision: thread.get("updatedAt").map(Value::to_string),
        cwd: text(thread, "cwd").map(str::to_owned),
        branch: thread
            .pointer("/gitInfo/branch")
            .and_then(Value::as_str)
            .map(str::to_owned),
        resumable: true,
    })
}

/// A page of turns as JAM messages: each user message as its own, and what
/// the agent did after it as one reply. Codex's item and turn IDs keep them
/// stable across syncs.
fn messages(turns: &[Value]) -> Vec<HistoryMessage> {
    let mut out = Vec::new();
    for turn in turns {
        let Some(turn_id) = text(turn, "id") else {
            continue;
        };
        let started = unix(turn.get("startedAt"));
        let ended = unix(turn.get("completedAt")).or_else(|| started.clone());
        let mut reply: Vec<MessageBlock> = Vec::new();
        let mut replies = 0;
        let mut flush = |reply: &mut Vec<MessageBlock>, out: &mut Vec<HistoryMessage>| {
            if reply.is_empty() {
                return;
            }
            let source_id = match replies {
                0 => format!("{turn_id}/reply"),
                n => format!("{turn_id}/reply-{n}"),
            };
            replies += 1;
            out.push(HistoryMessage {
                source_id,
                role: "assistant".into(),
                created_at: ended.clone(),
                blocks: std::mem::take(reply),
            });
        };
        for item in turn
            .get("items")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if text(item, "type") == Some("userMessage") {
                flush(&mut reply, &mut out);
                let Some(id) = text(item, "id") else { continue };
                let words = user_text(item);
                if !words.is_empty() {
                    out.push(HistoryMessage {
                        source_id: id.to_owned(),
                        role: "user".into(),
                        created_at: started.clone(),
                        blocks: vec![MessageBlock::Text { text: words }],
                    });
                }
                continue;
            }
            match items::item(item, None::<&Path>) {
                ItemBlock::Text(text) if !text.is_empty() => {
                    reply.push(MessageBlock::Text { text });
                }
                ItemBlock::Reasoning(text) => reply.push(MessageBlock::Reasoning { text }),
                ItemBlock::Block(block) => reply.push(block),
                ItemBlock::Notice(tone, text) => reply.push(MessageBlock::Notice {
                    tone: tone.into(),
                    text,
                }),
                ItemBlock::Text(_) | ItemBlock::Skip => {}
            }
        }
        flush(&mut reply, &mut out);
    }
    out
}

/// The text a user message carried. Images and other inputs are named, not
/// copied: they belong to the provider's record.
fn user_text(item: &Value) -> String {
    item.get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|input| match text(input, "type") {
            Some("text") => text(input, "text").map(str::to_owned),
            Some("image" | "localImage") => Some("[image]".into()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_listing_keeps_saved_top_level_threads() {
        let page = list_page(&json!({
            "data": [
                {"id": "t1", "name": "Fix the parser", "preview": "the parser", "cwd": "/work/jam",
                 "createdAt": 1_790_000_000, "updatedAt": 1_790_000_600, "gitInfo": {"branch": "feat/parser"}},
                {"id": "t2", "parentThreadId": "t1", "cwd": "/work/jam"},
                {"id": "t3", "ephemeral": true},
                {"name": "no id"},
                {"id": "t4", "name": null, "preview": "Rename the tabs", "cwd": "/work/jam"}
            ],
            "nextCursor": "next"
        }));
        assert_eq!(page.items.len(), 2);
        // Without a name, Codex's first message names it.
        assert_eq!(page.items[1].title.as_deref(), Some("Rename the tabs"));
        let item = &page.items[0];
        assert_eq!(item.native_id, "t1");
        assert_eq!(item.title.as_deref(), Some("Fix the parser"));
        assert_eq!(item.cwd.as_deref(), Some("/work/jam"));
        assert_eq!(item.branch.as_deref(), Some("feat/parser"));
        assert_eq!(item.updated_at.as_deref(), Some("2026-09-21T14:23:20Z"));
        assert_eq!(item.revision.as_deref(), Some("1790000600"));
        assert_eq!(page.next_page.as_deref(), Some("next"));
    }

    #[test]
    fn turns_become_user_messages_and_one_reply_each() {
        let turns = json!([
            {"id": "turn-1", "startedAt": 1_790_000_000, "completedAt": 1_790_000_060, "items": [
                {"type": "userMessage", "id": "u1", "content": [{"type": "text", "text": "Fix it"},
                                                                 {"type": "localImage", "path": "/x.png"}]},
                {"type": "reasoning", "id": "r1", "summary": ["Looking"]},
                {"type": "agentMessage", "id": "a1", "text": "Done."}
            ]},
            {"id": "turn-2", "items": [
                {"type": "userMessage", "id": "u2", "content": [{"type": "text", "text": "Thanks"}]}
            ]}
        ]);
        let out = messages(turns.as_array().unwrap());
        let ids: Vec<&str> = out.iter().map(|m| m.source_id.as_str()).collect();
        assert_eq!(ids, ["u1", "turn-1/reply", "u2"]);
        assert_eq!(
            out[0].blocks,
            vec![MessageBlock::Text {
                text: "Fix it\n[image]".into()
            }]
        );
        assert_eq!(out[1].role, "assistant");
        assert_eq!(out[1].blocks.len(), 2);
        assert_eq!(out[1].created_at.as_deref(), Some("2026-09-21T14:14:20Z"));
    }
}
