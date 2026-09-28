//! Claude tool calls and permission requests → JAM blocks and interactions.
//! Pure functions over Claude Code's stream-json shapes, fixture-tested.
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

/// A project-relative, `/`-separated path when `path` is inside `cwd`, the
/// form file links and the runtime's path checks use on every platform.
fn relative(path: &str, cwd: Option<&Path>) -> String {
    cwd.and_then(|cwd| Path::new(path).strip_prefix(cwd).ok())
        .map(|p| p.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"))
        .unwrap_or_else(|| path.to_string())
}

fn line_count(text: &str) -> u32 {
    if text.is_empty() {
        0
    } else {
        text.lines().count() as u32
    }
}

/// Files an editing tool changes, with line counts derived from its input.
fn edits(name: &str, input: &Value, cwd: Option<&Path>) -> Option<Vec<FileChange>> {
    let path = relative(
        text(input, "file_path").or_else(|| text(input, "notebook_path"))?,
        cwd,
    );
    let (added, removed) = match name {
        "Write" => (line_count(text(input, "content").unwrap_or_default()), 0),
        "Edit" => (
            line_count(text(input, "new_string").unwrap_or_default()),
            line_count(text(input, "old_string").unwrap_or_default()),
        ),
        "MultiEdit" => input
            .get("edits")
            .and_then(Value::as_array)
            .map(|edits| {
                edits.iter().fold((0, 0), |(a, r), edit| {
                    (
                        a + line_count(text(edit, "new_string").unwrap_or_default()),
                        r + line_count(text(edit, "old_string").unwrap_or_default()),
                    )
                })
            })
            .unwrap_or((0, 0)),
        "NotebookEdit" => (line_count(text(input, "new_source").unwrap_or_default()), 0),
        _ => return None,
    };
    fn edit_lines(edit: &Value) -> Vec<(char, &str)> {
        let old = text(edit, "old_string").unwrap_or_default();
        let new = text(edit, "new_string").unwrap_or_default();
        old.lines()
            .map(|line| ('-', line))
            .chain(new.lines().map(|line| ('+', line)))
            .collect()
    }
    let lines: Vec<(char, &str)> = match name {
        "Write" => text(input, "content")
            .unwrap_or_default()
            .lines()
            .map(|line| ('+', line))
            .collect(),
        "NotebookEdit" => text(input, "new_source")
            .unwrap_or_default()
            .lines()
            .map(|line| ('+', line))
            .collect(),
        "Edit" => edit_lines(input),
        _ => input
            .get("edits")
            .and_then(Value::as_array)
            .map(|edits| {
                edits
                    .iter()
                    .enumerate()
                    .flat_map(|(index, edit)| {
                        let gap = (index > 0).then_some(('@', ""));
                        gap.into_iter().chain(edit_lines(edit))
                    })
                    .collect()
            })
            .unwrap_or_default(),
    };
    Some(vec![FileChange {
        path,
        added,
        removed,
        diff: super::super::diff_preview(lines),
    }])
}

/// Tools that exist only to ask the reader. Their interaction card is the
/// whole record, so no separate tool row repeats them.
pub(crate) fn hidden(name: &str) -> bool {
    matches!(name, "AskUserQuestion" | "ExitPlanMode")
}

/// A tool call as JAM presents it. `input` may still be partial while it
/// streams; the final assistant message replaces it.
pub(crate) fn tool_block(
    id: &str,
    name: &str,
    input: &Value,
    status: &str,
    cwd: Option<&Path>,
) -> MessageBlock {
    let file = || {
        text(input, "file_path")
            .or_else(|| text(input, "notebook_path"))
            .or_else(|| text(input, "path"))
            .map(|p| relative(p, cwd))
            .unwrap_or_default()
    };
    let (kind, title, detail, files) = match name {
        "Bash" | "PowerShell" => (
            "command",
            text(input, "command").unwrap_or("Command").to_string(),
            String::new(),
            None,
        ),
        "Read" => ("read", format!("Read {}", file()), String::new(), None),
        "Glob" => (
            "search",
            format!("Find {}", text(input, "pattern").unwrap_or_default()),
            String::new(),
            None,
        ),
        "Grep" => (
            "search",
            format!("Search {}", text(input, "pattern").unwrap_or_default()),
            text(input, "path")
                .map(|p| relative(p, cwd))
                .unwrap_or_default(),
            None,
        ),
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => (
            "edit",
            format!(
                "{} {}",
                if name == "Write" { "Write" } else { "Edit" },
                file()
            ),
            String::new(),
            edits(name, input, cwd),
        ),
        "WebFetch" => (
            "web",
            format!("Fetch {}", text(input, "url").unwrap_or_default()),
            String::new(),
            None,
        ),
        "WebSearch" => (
            "web",
            "Search the web".to_string(),
            text(input, "query").unwrap_or_default().to_string(),
            None,
        ),
        "Agent" | "Task" => (
            "agent",
            text(input, "description")
                .map(|d| format!("Sub-agent · {d}"))
                .unwrap_or_else(|| "Sub-agent".into()),
            String::new(),
            None,
        ),
        "TodoWrite" => (
            "tool",
            "Update plan".to_string(),
            input
                .get("todos")
                .and_then(Value::as_array)
                .map(|todos| {
                    todos
                        .iter()
                        .map(|t| {
                            let mark = match text(t, "status") {
                                Some("completed") => "✓",
                                Some("in_progress") => "▸",
                                _ => "·",
                            };
                            format!("{mark} {}", text(t, "content").unwrap_or_default())
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default(),
            None,
        ),
        other => (
            "tool",
            other
                .strip_prefix("mcp__")
                .map(|rest| rest.replacen("__", " · ", 1))
                .unwrap_or_else(|| other.to_string()),
            if input.as_object().is_some_and(|o| !o.is_empty()) {
                bounded(&input.to_string(), 2_000)
            } else {
                String::new()
            },
            None,
        ),
    };
    MessageBlock::Tool {
        id: id.into(),
        kind: kind.into(),
        title: bounded(&title, 500),
        detail,
        status: status.into(),
        files,
    }
}

/// The readable text of a `tool_result` content value.
pub(crate) fn result_text(content: Option<&Value>) -> String {
    let text = match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| match text(part, "type") {
                Some("text") => text(part, "text").map(str::to_owned),
                Some("image") => Some("[image]".into()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    bounded(&text, MAX_DETAIL)
}

/// Whether a tool's output belongs in its block. File reads and edits are
/// summarized by title and counts; their content is not repeated.
pub(crate) fn shows_output(kind: &str) -> bool {
    matches!(kind, "command" | "search" | "web" | "tool")
}

fn choice(id: &str, label: &str, tone: &str) -> InteractionChoice {
    InteractionChoice {
        id: id.into(),
        label: label.into(),
        tone: tone.into(),
    }
}

/// A `can_use_tool` request as a JAM interaction.
pub(crate) fn permission(id: String, request: &Value, cwd: Option<&Path>) -> Interaction {
    let name = text(request, "tool_name").unwrap_or("tool");
    let input = request.get("input").cloned().unwrap_or(json!({}));
    let reason = text(request, "decision_reason")
        .map(|r| bounded(&plain(r), 2_000))
        .filter(|r| !r.trim().is_empty());
    let mut interaction = Interaction {
        id,
        kind: "tool".into(),
        title: String::new(),
        detail: None,
        reason,
        choices: vec![
            choice("allow", "Allow once", "allow"),
            choice("allowSession", "Allow for this session", "allow"),
            choice("deny", "Deny", "deny"),
            choice("denyStop", "Deny and stop", "deny"),
        ],
        questions: None,
        status: InteractionStatus::Pending,
        outcome: None,
        tool_id: None,
    };
    interaction.tool_id = text(request, "tool_use_id")
        .filter(|_| !hidden(name))
        .map(str::to_owned);
    match name {
        "AskUserQuestion" => {
            interaction.kind = "question".into();
            interaction.title = "Claude asks".into();
            interaction.reason = None;
            interaction.choices = Vec::new();
            interaction.questions = Some(
                input
                    .get("questions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .take(8)
                    .map(|q| {
                        let question = text(q, "question").unwrap_or_default().to_string();
                        InteractionQuestion {
                            // Claude Code looks answers up by the question's text.
                            id: question.chars().take(64).collect(),
                            header: text(q, "header").map(str::to_owned),
                            question,
                            options: q
                                .get("options")
                                .and_then(Value::as_array)
                                .into_iter()
                                .flatten()
                                .take(16)
                                .map(|o| QuestionOption {
                                    label: text(o, "label").unwrap_or_default().into(),
                                    description: text(o, "description").map(str::to_owned),
                                })
                                .collect(),
                            multi_select: q
                                .get("multiSelect")
                                .and_then(Value::as_bool)
                                .unwrap_or(false),
                            allow_other: true,
                        }
                    })
                    .collect(),
            );
        }
        "ExitPlanMode" => {
            interaction.kind = "plan".into();
            interaction.title = "Claude proposes a plan".into();
            interaction.detail = text(&input, "plan").map(|p| bounded(p, 40_000));
            interaction.choices = vec![
                choice("allow", "Approve plan", "allow"),
                choice("deny", "Keep planning", "deny"),
            ];
        }
        "Bash" | "PowerShell" => {
            interaction.kind = "command".into();
            interaction.title = "Claude wants to run a command".into();
            interaction.detail = text(&input, "command").map(|c| bounded(c, 8_000));
            if interaction.reason.is_none() {
                interaction.reason = text(&input, "description").map(str::to_owned);
            }
        }
        "Edit" | "MultiEdit" | "Write" | "NotebookEdit" => {
            interaction.kind = "file-change".into();
            let path = text(&input, "file_path")
                .or_else(|| text(&input, "notebook_path"))
                .map(|p| relative(p, cwd))
                .unwrap_or_default();
            interaction.title = format!("Claude wants to edit {path}");
            if let Some(MessageBlock::Tool {
                files: Some(files), ..
            }) = Some(tool_block("", name, &input, "running", cwd))
            {
                interaction.detail = Some(
                    files
                        .iter()
                        .map(|f| format!("{} (+{} −{})", f.path, f.added, f.removed))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
        }
        _ => {
            let display = text(request, "display_name")
                .or_else(|| text(request, "title"))
                .unwrap_or(name);
            interaction.title = bounded(&format!("Claude wants to use {}", plain(display)), 300);
            if let MessageBlock::Tool { title, detail, .. } =
                tool_block("", name, &input, "running", cwd)
            {
                interaction.detail = Some(
                    [title, detail]
                        .into_iter()
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
            }
        }
    }
    interaction
}

/// The `can_use_tool` response for the reader's answer.
pub(crate) fn permission_response(request: &Value, answer: &Answer) -> (Value, String) {
    let name = text(request, "tool_name").unwrap_or_default();
    let input = request.get("input").cloned().unwrap_or(json!({}));
    let tool_use_id = request.get("tool_use_id").cloned().unwrap_or(Value::Null);
    let allow = |updated_input: Value, permissions: Option<Value>| {
        let mut response =
            json!({"behavior": "allow", "updatedInput": updated_input, "toolUseID": tool_use_id});
        if let Some(permissions) = permissions {
            response["updatedPermissions"] = permissions;
        }
        response
    };
    let deny = |message: &str, interrupt: bool| json!({"behavior": "deny", "message": message, "interrupt": interrupt, "toolUseID": tool_use_id});
    match answer {
        Answer::Answers(answers) => {
            let questions = input.get("questions").cloned().unwrap_or(json!([]));
            let mut by_text = serde_json::Map::new();
            for question in questions.as_array().into_iter().flatten() {
                let full = text(question, "question").unwrap_or_default();
                let key: String = full.chars().take(64).collect();
                if let Some(values) = answers.get(&key) {
                    by_text.insert(full.to_string(), json!(values.join(", ")));
                }
            }
            let outcome = answers
                .values()
                .flatten()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            (
                allow(json!({"questions": questions, "answers": by_text}), None),
                outcome,
            )
        }
        Answer::Choice(choice) => match (name, choice.as_str()) {
            ("ExitPlanMode", "allow") => (
                allow(
                    input,
                    Some(json!([{"type": "setMode", "mode": "default", "destination": "session"}])),
                ),
                "Plan approved".into(),
            ),
            ("ExitPlanMode", _) => (
                deny(
                    "The user wants to keep planning before any changes are made.",
                    false,
                ),
                "Kept planning".into(),
            ),
            (_, "allow") => (allow(input, None), "Allowed once".into()),
            (_, "allowSession") => {
                // Claude's own suggestions, kept to this session rather than
                // saved to settings files; otherwise a session rule for the tool.
                let suggestions: Vec<Value> = request
                    .get("permission_suggestions")
                    .and_then(Value::as_array)
                    .map(|s| {
                        s.iter()
                            .cloned()
                            .map(|mut suggestion| {
                                suggestion["destination"] = json!("session");
                                suggestion
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                let permissions = if suggestions.is_empty() {
                    json!([{"type": "addRules", "rules": [{"toolName": name}], "behavior": "allow", "destination": "session"}])
                } else {
                    Value::Array(suggestions)
                };
                (
                    allow(input, Some(permissions)),
                    "Allowed for this session".into(),
                )
            }
            (_, "denyStop") => (
                deny("The user denied this and stopped the turn.", true),
                "Denied and stopped".into(),
            ),
            _ => (
                deny("The user denied this tool use.", false),
                "Denied".into(),
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn tools_are_classified_without_provider_shapes() {
        let cwd = Some(Path::new("/p"));
        let MessageBlock::Tool {
            kind, title, files, ..
        } = tool_block(
            "t1",
            "Edit",
            &json!({"file_path":"/p/src/a.ts","old_string":"a\nb","new_string":"c"}),
            "running",
            cwd,
        )
        else {
            panic!()
        };
        assert_eq!((kind.as_str(), title.as_str()), ("edit", "Edit src/a.ts"));
        assert_eq!(
            files.unwrap(),
            vec![FileChange {
                path: "src/a.ts".into(),
                added: 1,
                removed: 2,
                diff: Some("-a\n-b\n+c".into()),
            }]
        );
        let MessageBlock::Tool { kind, title, .. } = tool_block(
            "t2",
            "Bash",
            &json!({"command":"pnpm check"}),
            "running",
            cwd,
        ) else {
            panic!()
        };
        assert_eq!((kind.as_str(), title.as_str()), ("command", "pnpm check"));
        let MessageBlock::Tool { kind, title, .. } = tool_block(
            "t3",
            "mcp__github__create_issue",
            &json!({}),
            "running",
            cwd,
        ) else {
            panic!()
        };
        assert_eq!(
            (kind.as_str(), title.as_str()),
            ("tool", "github · create_issue")
        );
    }

    #[test]
    fn questions_are_answered_by_question_text() {
        let request = json!({"subtype":"can_use_tool","tool_name":"AskUserQuestion","tool_use_id":"tu1","input":{"questions":[{"question":"Which approach?","header":"Approach","multiSelect":false,"options":[{"label":"A","description":"first"},{"label":"B","description":"second"}]}]}});
        let interaction = permission("interaction-1".into(), &request, None);
        assert_eq!(interaction.kind, "question");
        let question = &interaction.questions.as_ref().unwrap()[0];
        assert_eq!(question.id, "Which approach?");
        let answer = Answer::Answers(BTreeMap::from([(
            question.id.clone(),
            vec!["B".to_string()],
        )]));
        let (response, outcome) = permission_response(&request, &answer);
        assert_eq!(response["behavior"], "allow");
        assert_eq!(
            response["updatedInput"]["answers"],
            json!({"Which approach?": "B"})
        );
        assert_eq!(
            response["updatedInput"]["questions"],
            request["input"]["questions"]
        );
        assert_eq!(outcome, "B");
    }

    #[test]
    fn session_approval_never_writes_settings_files() {
        let request = json!({"tool_name":"Bash","tool_use_id":"tu","input":{"command":"ls"},"permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"ls:*"}],"behavior":"allow","destination":"localSettings"}],"decision_reason":"\u{1b}[2mneeds approval\u{1b}[0m"});
        let interaction = permission("i".into(), &request, None);
        assert_eq!(interaction.kind, "command");
        assert_eq!(interaction.reason.as_deref(), Some("needs approval"));
        let (response, _) = permission_response(&request, &Answer::Choice("allowSession".into()));
        assert_eq!(response["updatedPermissions"][0]["destination"], "session");
        assert_eq!(response["updatedInput"], json!({"command":"ls"}));
        let (response, outcome) = permission_response(&request, &Answer::Choice("denyStop".into()));
        assert_eq!(
            (
                response["behavior"].as_str(),
                response["interrupt"].as_bool()
            ),
            (Some("deny"), Some(true))
        );
        assert_eq!(outcome, "Denied and stopped");
    }

    #[test]
    fn tool_results_are_bounded_text() {
        assert_eq!(
            result_text(Some(&json!([{"type":"text","text":"a"},{"type":"image"}]))),
            "a\n[image]"
        );
        assert_eq!(result_text(Some(&json!("plain"))), "plain");
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::relative;
    use std::path::Path;

    #[test]
    fn windows_paths_become_project_relative_links() {
        let cwd = Path::new(r"C:\work\café repo");
        assert_eq!(
            relative(r"C:\work\café repo\src\nested dir\a.ts", Some(cwd)),
            "src/nested dir/a.ts"
        );
        assert_eq!(
            relative(r"D:\elsewhere\a.ts", Some(cwd)),
            r"D:\elsewhere\a.ts"
        );
    }
}
