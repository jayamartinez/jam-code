//! Version 1 JSON contract, mirrored by `@jam/protocol` and shared fixture tests.
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub protocol_version: u32,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub initials: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub pinned: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Presentation {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Idle,
    Running,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub resource_id: String,
    pub provider_id: String,
    pub presentation: Presentation,
    pub status: SessionStatus,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContextKind {
    File,
    Code,
    Diff,
    BrowserElement,
    BrowserRegion,
    Terminal,
    Message,
    Snapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextItem {
    pub id: String,
    pub kind: ContextKind,
    pub label: String,
    pub source: ContextSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub added: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MessageBlock {
    Text {
        text: String,
    },
    Tool {
        id: String,
        kind: String,
        title: String,
        detail: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        files: Option<Vec<FileChange>>,
    },
    Context {
        items: Vec<ContextItem>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    pub created_at: String,
    pub blocks: Vec<MessageBlock>,
}

impl Message {
    pub fn searchable_text(&self) -> String {
        self.blocks
            .iter()
            .map(|block| match block {
                MessageBlock::Text { text } => text.clone(),
                MessageBlock::Tool {
                    title,
                    detail,
                    files,
                    ..
                } => format!(
                    "{title} {detail} {}",
                    files
                        .as_ref()
                        .map(|f| f
                            .iter()
                            .map(|f| f.path.as_str())
                            .collect::<Vec<_>>()
                            .join(" "))
                        .unwrap_or_default()
                ),
                MessageBlock::Context { items } => items
                    .iter()
                    .map(|c| c.label.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    pub runtime_id: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub resource_id: String,
    pub session_id: String,
    pub messages: Vec<Message>,
    pub cursor: Cursor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub protocol_version: u32,
    pub runtime_id: String,
    pub sequence: u64,
    pub projects: Vec<Project>,
    pub resources: Vec<Resource>,
    pub sessions: Vec<Session>,
    pub providers: Vec<Value>,
}

#[derive(Debug, Deserialize)]
pub struct DemoFixture {
    pub workspace: WorkspaceSnapshot,
    pub conversations: Vec<Conversation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub resource_id: String,
    pub title: String,
    pub project_id: String,
    pub provider_id: String,
    pub presentation: Presentation,
    pub pinned: bool,
    pub snippet: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscriptionScope {
    pub resource_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub protocol_version: u32,
    pub cursor: Cursor,
    pub resource_id: String,
    #[serde(flatten)]
    pub payload: EventPayload,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum EventPayload {
    #[serde(rename = "message.upserted")]
    MessageUpserted { message: Message },
    #[serde(rename = "session.updated")]
    SessionUpdated { session: Session },
}
