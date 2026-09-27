//! Codex `ThreadItem`s and approval requests → JAM blocks and interactions.
//! Pure functions over provider JSON, so each shape is fixture-tested.
use crate::{
    protocol::{
        FileChange, Interaction, InteractionChoice, InteractionQuestion, InteractionStatus,
        MessageBlock, QuestionOption,
    },
    providers::{Answer, bounded, plain, transcript::MAX_DETAIL},
};
use serde_json::{Value, json};
use std::path::Path;

fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// What a completed or started item contributes to the transcript.
pub(crate) enum ItemBlock {
    Text(String),
    Reasoning(String),
    Block(MessageBlock),
    Notice(&'static str, String),
    Skip,
}

pub(crate) fn item(item: &Value, cwd: Option<&Path>) -> ItemBlock {
    let id = text(item, "id").unwrap_or_default().to_string();
    match text(item, "type").unwrap_or_default() {
        "agentMessage" => ItemBlock::Text(text(item, "text").unwrap_or_default().to_string()),
        "reasoning" => {
            let summary = strings(item.get("summary"));
            if summary.is_empty() {
                ItemBlock::Skip
            } else {
                ItemBlock::Reasoning(summary.join("\n\n"))
            }
        }
        "plan" => ItemBlock::Text(text(item, "text").unwrap_or_default().to_string()),
        "commandExecution" => ItemBlock::Block(command(&id, item)),
        "fileChange" => ItemBlock::Block(file_change(&id, item, cwd)),
        "mcpToolCall" => {
            let server = text(item, "server").unwrap_or("MCP");
            let tool = text(item, "tool").unwrap_or("tool");
            let mut detail = item
                .get("arguments")
                .filter(|a| !a.is_null())
                .map(|a| bounded(&a.to_string(), 2_000))
                .unwrap_or_default();
            if let Some(error) = item.pointer("/error/message").and_then(Value::as_str) {
                detail = format!("{detail}\n{}", plain(error)).trim().to_string();
            }
            ItemBlock::Block(MessageBlock::Tool {
                id,
                kind: "tool".into(),
                title: bounded(&format!("{server} · {tool}"), 200),
                detail,
                status: status(text(item, "status"), None),
                files: None,
            })
        }
        "dynamicToolCall" => ItemBlock::Block(MessageBlock::Tool {
            id,
            kind: "tool".into(),
            title: text(item, "tool").unwrap_or("Tool").to_string(),
            detail: String::new(),
            status: status(text(item, "status"), None),
            files: None,
        }),
        "webSearch" => ItemBlock::Block(MessageBlock::Tool {
            id,
            kind: "web".into(),
            title: "Search the web".into(),
            detail: text(item, "query").unwrap_or_default().to_string(),
            status: "completed".into(),
            files: None,
        }),
        "imageView" => ItemBlock::Block(MessageBlock::Tool {
            id,
            kind: "read".into(),
            title: "View image".into(),
            detail: display_path(text(item, "path").unwrap_or_default(), cwd),
            status: "completed".into(),
            files: None,
        }),
        "collabAgentToolCall" | "subAgentActivity" => ItemBlock::Block(MessageBlock::Tool {
            id,
            kind: "agent".into(),
            title: "Sub-agent".into(),
            detail: text(item, "prompt")
                .or_else(|| text(item, "description"))
                .unwrap_or_default()
                .chars()
                .take(2_000)
                .collect(),
            status: status(text(item, "status"), None),
            files: None,
        }),
        "contextCompaction" => ItemBlock::Notice(
            "info",
            "Codex compacted this conversation's context.".into(),
        ),
        "enteredReviewMode" => ItemBlock::Notice("info", "Codex started a review.".into()),
        "exitedReviewMode" => ItemBlock::Notice("info", "Codex finished its review.".into()),
        // userMessage echoes JAM's own input; everything else unknown stays
        // out of the transcript rather than appearing as raw JSON.
        _ => ItemBlock::Skip,
    }
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// Maps Codex item status to a JAM tool status.
fn status(value: Option<&str>, exit_code: Option<i64>) -> String {
    match value {
        Some("inProgress") => "running",
        Some("completed") if exit_code.is_none_or(|code| code == 0) => "completed",
        Some("completed" | "failed" | "declined") => "failed",
        _ => "running",
    }
    .into()
}

fn command(id: &str, item: &Value) -> MessageBlock {
    let command = text(item, "command").unwrap_or_default();
    let exit = item.get("exitCode").and_then(Value::as_i64);
    let mut detail = item
        .get("aggregatedOutput")
        .and_then(Value::as_str)
        .map(|output| bounded(output, MAX_DETAIL))
        .unwrap_or_default();
    let state = text(item, "status");
    if state == Some("declined") {
        detail = "Declined".into();
    } else if let Some(code) = exit.filter(|code| *code != 0) {
        detail = format!("{detail}\nExit code {code}").trim().to_string();
    }
    // A single read or search reads better as what it did than as its shell.
    let actions = item
        .get("commandActions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let (kind, title) = match actions.as_slice() {
        [action] => match text(action, "type") {
            Some("read") => (
                "read",
                format!("Read {}", text(action, "name").unwrap_or(command)),
            ),
            Some("search") => (
                "search",
                match text(action, "query") {
                    Some(query) => format!("Search {query}"),
                    None => command.to_string(),
                },
            ),
            Some("listFiles") => (
                "read",
                format!("List {}", text(action, "path").unwrap_or(".")),
            ),
            _ => ("command", command.to_string()),
        },
        _ => ("command", command.to_string()),
    };
    MessageBlock::Tool {
        id: id.into(),
        kind: kind.into(),
        title: bounded(&title, 500),
        detail,
        status: status(state, exit),
        files: None,
    }
}

/// Counts added and removed lines in a unified diff, ignoring file headers.
pub(crate) fn diff_counts(diff: &str) -> (u32, u32) {
    let mut added = 0;
    let mut removed = 0;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            added += 1;
        } else if line.starts_with('-') {
            removed += 1;
        }
    }
    (added, removed)
}

/// A change's line counts. Codex sends an added or deleted file's content
/// rather than a unified diff, so every line of it counts.
fn change_counts(change: &Value) -> (u32, u32) {
    let diff = text(change, "diff").unwrap_or_default();
    let hunks = diff.starts_with("@@") || diff.contains("\n@@");
    let lines = || u32::try_from(diff.lines().count()).unwrap_or(u32::MAX);
    match change.pointer("/kind/type").and_then(Value::as_str) {
        Some("add") if !hunks => (lines(), 0),
        Some("delete") if !hunks => (0, lines()),
        _ => diff_counts(diff),
    }
}

fn display_path(path: &str, cwd: Option<&Path>) -> String {
    cwd.and_then(|cwd| Path::new(path).strip_prefix(cwd).ok())
        .map(|relative| relative.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

pub(crate) fn changes(item: &Value, cwd: Option<&Path>) -> Vec<FileChange> {
    item.get("changes")
        .and_then(Value::as_array)
        .map(|changes| {
            changes
                .iter()
                .take(1000)
                .map(|change| {
                    let (added, removed) = change_counts(change);
                    FileChange {
                        path: display_path(text(change, "path").unwrap_or_default(), cwd),
                        added,
                        removed,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn file_change(id: &str, item: &Value, cwd: Option<&Path>) -> MessageBlock {
    let files = changes(item, cwd);
    let state = text(item, "status");
    MessageBlock::Tool {
        id: id.into(),
        kind: "edit".into(),
        title: match files.as_slice() {
            [one] => format!("Edit {}", one.path),
            many => format!("Edited {} files", many.len()),
        },
        detail: if state == Some("declined") {
            "Declined".into()
        } else {
            String::new()
        },
        status: status(state, None),
        files: Some(files),
    }
}

fn choice(id: &str, label: &str, tone: &str) -> InteractionChoice {
    InteractionChoice {
        id: id.into(),
        label: label.into(),
        tone: tone.into(),
    }
}

/// A Codex server request JAM presents to the reader, or `None` if JAM
/// cannot present it.
pub(crate) fn interaction(
    id: String,
    method: &str,
    params: &Value,
    file_detail: Option<String>,
) -> Option<Interaction> {
    let reason = text(params, "reason").map(|r| bounded(&plain(r), 2_000));
    let standard = || {
        vec![
            choice("accept", "Allow once", "allow"),
            choice("acceptForSession", "Allow for this session", "allow"),
            choice("decline", "Deny", "deny"),
            choice("cancel", "Deny and stop", "deny"),
        ]
    };
    let mut interaction = Interaction {
        id,
        kind: String::new(),
        title: String::new(),
        detail: None,
        reason,
        choices: Vec::new(),
        questions: None,
        status: InteractionStatus::Pending,
        outcome: None,
        tool_id: None,
    };
    interaction.tool_id = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    match method {
        "item/commandExecution/requestApproval" => {
            interaction.kind = "command".into();
            let host = params
                .pointer("/networkApprovalContext/host")
                .and_then(Value::as_str);
            interaction.title = match host {
                Some(host) => format!("Codex wants network access to {host}"),
                None => "Codex wants to run a command".into(),
            };
            interaction.detail = text(params, "command").map(|c| bounded(c, 8_000));
            interaction.choices = standard();
            if let Some(prefix) = params
                .get("proposedExecpolicyAmendment")
                .and_then(Value::as_array)
                .filter(|p| !p.is_empty())
            {
                let words: Vec<&str> = prefix.iter().filter_map(Value::as_str).collect();
                interaction.choices.insert(
                    2,
                    choice(
                        "execpolicy",
                        &bounded(&format!("Always allow `{}`", words.join(" ")), 200),
                        "allow",
                    ),
                );
            }
        }
        "item/fileChange/requestApproval" => {
            interaction.kind = "file-change".into();
            interaction.title = "Codex wants to edit files".into();
            interaction.detail = file_detail;
            interaction.choices = standard();
        }
        "item/permissions/requestApproval" => {
            interaction.kind = "tool".into();
            interaction.title = "Codex requests additional permissions".into();
            interaction.detail = params
                .get("permissions")
                .map(|p| bounded(&p.to_string(), 2_000));
            interaction.choices = vec![
                choice("turn", "Allow for this turn", "allow"),
                choice("session", "Allow for this session", "allow"),
                choice("deny", "Deny", "deny"),
            ];
        }
        "item/tool/requestUserInput" => {
            interaction.kind = "question".into();
            interaction.title = "Codex asks".into();
            let questions = params.get("questions").and_then(Value::as_array)?;
            interaction.questions = Some(
                questions
                    .iter()
                    .take(8)
                    .map(|q| InteractionQuestion {
                        id: text(q, "id").unwrap_or_default().into(),
                        header: text(q, "header").map(str::to_owned),
                        question: text(q, "question").unwrap_or_default().into(),
                        options: q
                            .get("options")
                            .and_then(Value::as_array)
                            .map(|options| {
                                options
                                    .iter()
                                    .take(16)
                                    .map(|o| QuestionOption {
                                        label: text(o, "label").unwrap_or_default().into(),
                                        description: text(o, "description").map(str::to_owned),
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                        multi_select: false,
                        allow_other: q.get("isOther").and_then(Value::as_bool).unwrap_or(false)
                            || q.get("options").is_none_or(Value::is_null),
                    })
                    .collect(),
            );
        }
        _ => return None,
    }
    Some(interaction)
}

/// The Codex response for the reader's answer, and how the transcript
/// records it.
pub(crate) fn response(method: &str, params: &Value, answer: &Answer) -> (Value, String) {
    match (method, answer) {
        ("item/permissions/requestApproval", Answer::Choice(choice)) => match choice.as_str() {
            "turn" | "session" => (
                json!({"permissions": params.get("permissions").cloned().unwrap_or(json!({})), "scope": choice}),
                if choice == "turn" {
                    "Allowed for this turn"
                } else {
                    "Allowed for this session"
                }
                .into(),
            ),
            _ => (json!({"permissions": {}, "scope": "turn"}), "Denied".into()),
        },
        ("item/tool/requestUserInput", Answer::Answers(answers)) => (
            json!({"answers": answers.iter().map(|(k, v)| (k.clone(), json!({"answers": v}))).collect::<serde_json::Map<_, _>>()}),
            answers
                .values()
                .flatten()
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
        ),
        (_, Answer::Choice(choice)) => {
            let decision = match choice.as_str() {
                "execpolicy" => json!({"acceptWithExecpolicyAmendment": {
                    "execpolicy_amendment": params.get("proposedExecpolicyAmendment").cloned().unwrap_or(json!([]))
                }}),
                other => json!(other),
            };
            let outcome = match choice.as_str() {
                "accept" => "Allowed once",
                "acceptForSession" => "Allowed for this session",
                "execpolicy" => "Always allowed",
                "decline" => "Denied",
                _ => "Denied and stopped",
            };
            (json!({"decision": decision}), outcome.into())
        }
        (_, Answer::Answers(_)) => (json!({"decision": "decline"}), "Denied".into()),
    }
}

/// The response that withdraws JAM's side of a request when the turn is
/// interrupted: never an approval.
pub(crate) fn cancellation(method: &str) -> Value {
    match method {
        "item/permissions/requestApproval" => json!({"permissions": {}, "scope": "turn"}),
        "item/tool/requestUserInput" => json!({"answers": {}}),
        _ => json!({"decision": "cancel"}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_items_become_command_blocks() {
        let completed = json!({"type":"commandExecution","id":"c1","command":"pnpm check","cwd":"/p","status":"completed","commandActions":[{"type":"unknown","command":"pnpm check"}],"aggregatedOutput":"ok\n","exitCode":0});
        let ItemBlock::Block(MessageBlock::Tool {
            kind,
            title,
            detail,
            status,
            ..
        }) = item(&completed, None)
        else {
            panic!()
        };
        assert_eq!(
            (
                kind.as_str(),
                title.as_str(),
                detail.as_str(),
                status.as_str()
            ),
            ("command", "pnpm check", "ok\n", "completed")
        );
        let failed = json!({"type":"commandExecution","id":"c2","command":"false","status":"completed","exitCode":1,"aggregatedOutput":""});
        let ItemBlock::Block(MessageBlock::Tool { status, detail, .. }) = item(&failed, None)
        else {
            panic!()
        };
        assert_eq!(status, "failed");
        assert_eq!(detail, "Exit code 1");
        let read = json!({"type":"commandExecution","id":"c3","command":"cat src/a.rs","status":"inProgress","commandActions":[{"type":"read","command":"cat src/a.rs","name":"a.rs","path":"src/a.rs"}]});
        let ItemBlock::Block(MessageBlock::Tool {
            kind,
            title,
            status,
            ..
        }) = item(&read, None)
        else {
            panic!()
        };
        assert_eq!(
            (kind.as_str(), title.as_str(), status.as_str()),
            ("read", "Read a.rs", "running")
        );
    }

    #[test]
    fn file_changes_count_lines_relative_to_the_project() {
        let change = json!({"type":"fileChange","id":"f1","status":"completed","changes":[{"path":"/p/src/a.rs","kind":{"type":"update","move_path":null},"diff":"--- a\n+++ b\n@@\n-old\n+new\n+more\n"}]});
        let ItemBlock::Block(MessageBlock::Tool { title, files, .. }) =
            item(&change, Some(Path::new("/p")))
        else {
            panic!()
        };
        assert_eq!(title, "Edit src/a.rs");
        assert_eq!(
            files.unwrap(),
            vec![FileChange {
                path: "src/a.rs".into(),
                added: 2,
                removed: 1
            }]
        );
    }

    #[test]
    fn added_and_deleted_files_count_their_content() {
        let change = json!({"changes":[
            {"path":"/p/new.txt","kind":{"type":"add"},"diff":"hello\nworld\n"},
            {"path":"/p/old.txt","kind":{"type":"delete"},"diff":"gone\n"}
        ]});
        let counts: Vec<(u32, u32)> = changes(&change, None)
            .into_iter()
            .map(|file| (file.added, file.removed))
            .collect();
        assert_eq!(counts, vec![(2, 0), (0, 1)]);
    }

    #[test]
    fn unknown_items_are_not_rendered() {
        assert!(matches!(
            item(&json!({"type":"somethingNew","id":"x"}), None),
            ItemBlock::Skip
        ));
        assert!(matches!(
            item(&json!({"type":"userMessage","id":"u"}), None),
            ItemBlock::Skip
        ));
    }

    #[test]
    fn approvals_offer_only_codex_decisions() {
        let params = json!({"threadId":"t","turnId":"u","itemId":"c","command":"rm -rf build","reason":"clean \u{1b}[1mbuild\u{1b}[0m","proposedExecpolicyAmendment":["rm","-rf"]});
        let approval = interaction(
            "interaction-1".into(),
            "item/commandExecution/requestApproval",
            &params,
            None,
        )
        .unwrap();
        let ids: Vec<_> = approval.choices.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "accept",
                "acceptForSession",
                "execpolicy",
                "decline",
                "cancel"
            ]
        );
        assert_eq!(approval.reason.as_deref(), Some("clean build"));
        let (reply, outcome) = response(
            "item/commandExecution/requestApproval",
            &params,
            &Answer::Choice("execpolicy".into()),
        );
        assert_eq!(
            reply,
            json!({"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["rm","-rf"]}}})
        );
        assert_eq!(outcome, "Always allowed");
        let (reply, _) = response(
            "item/fileChange/requestApproval",
            &json!({}),
            &Answer::Choice("decline".into()),
        );
        assert_eq!(reply, json!({"decision":"decline"}));
        assert_eq!(
            cancellation("item/fileChange/requestApproval"),
            json!({"decision":"cancel"})
        );
        assert!(
            interaction(
                "i".into(),
                "mcpServer/elicitation/request",
                &json!({}),
                None
            )
            .is_none()
        );
    }
}
