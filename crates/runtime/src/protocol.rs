//! Version 1 JSON contract, mirrored by `@jam/protocol` and shared fixture tests.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

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
    /// How the project's badge is drawn. Absent means its initials.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<ProjectIcon>,
    /// Local folders: the first selects Git review and read-only files.
    /// A future remote host must authorize project access separately.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    /// Pinned projects sort first in the sidebar.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// When the project was removed from JAM. A removed project, and
    /// everything in it, is left out of the workspace until its folder is
    /// added again; its folder is never touched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_at: Option<String>,
    /// Set in a workspace read when the first folder is gone or unreadable.
    /// Computed, never stored.
    #[serde(
        default,
        skip_deserializing,
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub folder_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIcon {
    /// `initials`, `preset`, `emoji` or `image`.
    pub kind: String,
    /// A preset name, an emoji, or an image data URL the client already squared.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// Color role for a preset or the initials.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tone: Option<String>,
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
    /// Project-relative path for file resources. Never an absolute local path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub pinned: bool,
    pub updated_at: String,
    /// When the reader archived this thread (the field keeps its earlier
    /// name). Archiving is always explicit: JAM may suggest it, but never
    /// archives a thread by itself, and it changes nothing else about it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
    /// When the reader last answered "Keep open" to an idle suggestion.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close_suggestion_dismissed_at: Option<String>,
    /// The JAM worktree this resource works in; absent means the project's
    /// own folder. Set by the runtime, never a path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
}

/// A worktree JAM created for a chat: its own branch and folder beside the
/// repository. JAM records it and never deletes it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub id: String,
    pub project_id: String,
    pub branch: String,
    /// The branch it started from.
    pub base_branch: String,
    /// Its folder, for display; requests address it by ID.
    pub path: String,
    pub created_at: String,
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
    /// Provider-specific choices (`model`, `effort`, permission options).
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub options: BTreeMap<String, String>,
    /// An approval or question waits for the reader.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub needs_input: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<SessionUsage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    /// A file the reader chose outside the project, copied into JAM's storage.
    Attachment,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextItem {
    pub id: String,
    pub kind: ContextKind,
    pub label: String,
    pub source: ContextSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
    /// What an attachment is, as the runtime recorded it at import.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment: Option<AttachmentInfo>,
}

/// What an attachment is to an agent: a file it opens by path, or an image
/// that is also sent natively when the model accepts images.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AttachmentKind {
    File,
    Image,
}

/// Display metadata for an attached file. Never its original location.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AttachmentInfo {
    pub name: String,
    pub media_type: String,
    pub kind: AttachmentKind,
    /// The chosen file's size.
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileChange {
    pub path: String,
    pub added: u32,
    pub removed: u32,
    /// A bounded preview of the changed lines, each prefixed with `+`, `-`,
    /// ` ` (context) or `@` (a gap between hunks).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractionChoice {
    pub id: String,
    pub label: String,
    /// `allow`, `deny` or `neutral`: presentation only.
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InteractionQuestion {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    pub question: String,
    pub options: Vec<QuestionOption>,
    pub multi_select: bool,
    pub allow_other: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InteractionStatus {
    Pending,
    Resolved,
    Cancelled,
    Expired,
}

/// A provider asking the reader. The JAM ID is stable; the provider's own
/// request ID never leaves the adapter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Interaction {
    pub id: String,
    /// `command`, `file-change`, `tool`, `question` or `plan`.
    pub kind: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub choices: Vec<InteractionChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub questions: Option<Vec<InteractionQuestion>>,
    pub status: InteractionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    /// The tool block this request is about, when there is one: the
    /// approval is shown inside that block rather than as its own card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MessageBlock {
    Text {
        text: String,
    },
    /// A provider-reported reasoning summary.
    Reasoning {
        text: String,
    },
    Tool {
        id: String,
        /// `read`, `search`, `edit`, `command`, `tool`, `web` or `agent`.
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
    Interaction {
        interaction: Interaction,
    },
    Notice {
        /// `info`, `warning` or `error`.
        tone: String,
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub role: String,
    pub created_at: String,
    pub blocks: Vec<MessageBlock>,
    /// When the turn that wrote an assistant message ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

impl Message {
    pub fn searchable_text(&self) -> String {
        self.blocks
            .iter()
            .map(|block| match block {
                MessageBlock::Text { text } | MessageBlock::Notice { text, .. } => text.clone(),
                // A provider's reasoning summary is not something said to the reader.
                MessageBlock::Reasoning { .. } => String::new(),
                MessageBlock::Interaction { interaction } => format!(
                    "{} {}",
                    interaction.title,
                    interaction.detail.as_deref().unwrap_or_default()
                ),
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
    pub providers: Vec<ProviderDescriptor>,
    #[serde(default)]
    pub worktrees: Vec<Worktree>,
    /// The sidebar's sections, top to bottom, once the reader has arranged
    /// them; absent means the default order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sidebar_sections: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilitySupport {
    /// `supported`, `unsupported`, `unknown` or `conditional`.
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl CapabilitySupport {
    pub fn supported() -> Self {
        Self {
            status: "supported".into(),
            reason: None,
        }
    }
    pub fn with(status: &str, reason: impl Into<String>) -> Self {
        Self {
            status: status.into(),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub efforts: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_effort: Option<String>,
    /// Faster speeds this model offers besides standard, as the provider
    /// names them; chosen through the `speed` option.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub speeds: Vec<OptionValue>,
    /// An older version the provider has superseded; shown under Legacy.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub legacy: bool,
    /// `supported`, `unsupported` or `unknown`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OptionValue {
    pub value: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderOption {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub values: Vec<OptionValue>,
    pub default: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderStatus {
    /// `info`, `warning` or `error`.
    pub tone: String,
    pub message: String,
}

/// The signed-in account as the provider's CLI reports it; absent fields are
/// unknown. `identity` (usually an email) is personal data: it lives only in
/// the live descriptor and is never persisted, logged or put in an error.
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProviderAccount {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
}

/// Debug output leaves the identity out, so a stray `{:?}` cannot log it.
impl std::fmt::Debug for ProviderAccount {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderAccount")
            .field("method", &self.method)
            .field("plan", &self.plan)
            .field("identity", &self.identity.as_ref().map(|_| "<hidden>"))
            .finish()
    }
}

/// Installation, authentication, enablement, default and running are
/// independent. Anything a provider did not report stays absent or unknown.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    /// `installed`, `missing`, `unknown` or `builtin`.
    pub installation: String,
    /// `authenticated`, `unauthenticated`, `unknown` or `not-required`.
    pub authentication: String,
    pub enabled: bool,
    pub is_default: bool,
    pub running: bool,
    pub capabilities: BTreeMap<String, CapabilitySupport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_override: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProviderStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<ProviderAccount>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<ProviderModel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<ProviderOption>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub defaults: Option<BTreeMap<String, String>>,
    /// Model IDs the reader starred, in the order they were starred.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub favorite_models: Vec<String>,
    /// Model IDs the reader hid from the model picker.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden_models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
}

/// Every capability JAM describes, in display order.
pub const CAPABILITIES: [&str; 15] = [
    "create",
    "resume",
    "fork",
    "interrupt",
    "streaming",
    "toolApproval",
    "userInput",
    "images",
    "steering",
    "queue",
    "modelSelection",
    "effort",
    "permissionModes",
    "usage",
    "compact",
];

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

/// One conversation in a provider's own history, as JAM indexed it. The
/// provider's ID never appears here: the client addresses the entry by JAM's
/// `id`, and the provider's record stays canonical.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub provider_id: String,
    /// Who created the provider's conversation: `jam` or `external`.
    pub origin: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<String>,
    /// As the provider reported them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    pub discovered_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub synced_at: Option<String>,
    /// The JAM conversation projecting it, once it has been synced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
    /// The trusted project it belongs to. Absent means unlinked.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    /// The folder the provider reported, for display only. It grants nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    /// The provider stopped listing it in a complete scan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing_since: Option<String>,
    /// Removed from JAM by the reader; scans keep it hidden until restored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignored_at: Option<String>,
    /// The provider's conversation changed since it was last synced.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub changed: bool,
    pub resumable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    /// Project-relative path, resolved by the runtime.
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_children: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub project_id: String,
    pub path: String,
    pub entries: Vec<DirectoryEntry>,
    pub truncated: bool,
    /// True while the tree is the isolated demo workspace, not this computer.
    pub demo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    pub project_id: String,
    pub path: String,
    pub language: String,
    pub text: String,
    pub truncated: bool,
    pub writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub demo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSaved {
    pub project_id: String,
    pub path: String,
    pub saved_at: String,
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
