//! Provider adapters. Each one speaks its provider's own wire protocol and
//! emits normalized JAM blocks; no provider message shape leaves its module.
//!
//! The runtime owns every adapter and every process an adapter starts. A
//! turn is driven by a runtime task (`turns.rs`), never by a view.
mod access;
mod claude;
mod codex;
pub(crate) mod discovery;
mod interactions;
mod manager;
mod mock;
pub(crate) mod process;
mod transcript;

pub use claude::ClaudeAdapter;
pub use codex::CodexAdapter;
pub use interactions::{Answer, Interactions};
pub use manager::ProviderConfig;
pub(crate) use manager::{
    ProviderManager, ProviderSettings, SETTINGS_KEY, validate_options as validate_option,
};
pub use mock::MockProvider;
pub(crate) use transcript::Transcript;

/// The session option naming a faster speed a model offers (`ProviderModel::speeds`).
/// Absent means the provider's standard speed.
pub(crate) const SPEED: &str = "speed";

use crate::{
    error::JamError,
    protocol::{CAPABILITIES, CapabilitySupport, ProviderDescriptor, SessionStatus, SessionUsage},
};
use std::{collections::BTreeMap, future::Future, path::PathBuf, pin::Pin, sync::Arc};
use tokio::sync::{mpsc, watch};

/// An image the reader explicitly sent, resolved by the runtime.
#[derive(Clone)]
pub struct ImageInput {
    pub media_type: String,
    pub bytes: Arc<Vec<u8>>,
    /// A runtime-owned copy of the image, for providers that read files.
    pub path: Option<PathBuf>,
    /// Provenance shown to the provider, such as a snapshot's window title.
    pub label: String,
}

/// Everything an adapter needs for one explicit Send.
#[derive(Clone)]
pub struct ProviderTurn {
    /// JAM's session ID. Never sent to a provider.
    pub session_id: String,
    /// The provider's own session or thread ID from an earlier turn.
    pub native_id: Option<String>,
    /// The project's folder. Real providers never run without one.
    pub cwd: Option<PathBuf>,
    /// The reader's words plus any text context, already composed.
    pub text: String,
    pub images: Vec<ImageInput>,
    /// Every file attached to this turn, as JAM's own copy. Their paths are
    /// already in `text`, which is how any agent can open them; an adapter
    /// whose provider takes a type natively may send it from here as well.
    pub files: Vec<crate::attachments::AttachedFile>,
    /// The one folder holding this conversation's attachments, for an agent
    /// that must be told which folders it may read. Absent until it has any.
    pub attachment_dir: Option<PathBuf>,
    /// Session options (`model`, `effort`, provider-specific ids).
    pub options: BTreeMap<String, String>,
    pub config: ProviderConfig,
    /// Compact the provider's context instead of sending a message.
    pub compact: bool,
}

/// What an adapter reports while a turn runs.
#[derive(Debug)]
pub enum ProviderUpdate {
    /// An authoritative replacement for this turn's assistant blocks.
    Blocks(Vec<crate::protocol::MessageBlock>),
    /// The provider's own session/thread ID, to persist for resume.
    Native(String),
    /// The model the provider actually used, for display.
    Model(String),
    Usage(SessionUsage),
    /// The turn ended. `Idle` is success.
    Finished(SessionStatus),
}

/// The channels a turn is driven through.
pub struct TurnIo {
    pub updates: mpsc::Sender<ProviderUpdate>,
    /// Becomes true on an explicit interrupt or JAM shutdown.
    pub cancelled: watch::Receiver<bool>,
    pub interactions: Interactions,
}

pub type ProviderFuture = Pin<Box<dyn Future<Output = Result<(), JamError>> + Send>>;
pub type ProbeFuture = Pin<Box<dyn Future<Output = ProviderDescriptor> + Send>>;

pub trait ProviderAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    /// The descriptor before anything has been checked: everything unknown.
    fn unchecked(&self, config: &ProviderConfig) -> ProviderDescriptor;
    /// Detection, authentication and discovery. Must not start a turn or
    /// make an inference request.
    fn probe(&self, config: ProviderConfig) -> ProbeFuture;
    /// Runs one turn. On cancellation the adapter asks its provider to
    /// interrupt and returns once it has, or when the runtime stops waiting.
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture;
    /// Stops any process kept for this session. Explicit lifecycle only.
    fn release(&self, _session_id: &str) {}
    /// Terminates every process this adapter owns, with everything they
    /// started. May block briefly; the manager calls it off the async threads.
    fn shutdown(&self) {}
}

/// A descriptor with every capability set to one state.
pub(crate) fn descriptor(id: &str, name: &str, status: &str, reason: &str) -> ProviderDescriptor {
    ProviderDescriptor {
        id: id.into(),
        name: name.into(),
        installation: "unknown".into(),
        authentication: "unknown".into(),
        enabled: false,
        is_default: false,
        running: false,
        capabilities: CAPABILITIES
            .iter()
            .map(|key| ((*key).to_string(), CapabilitySupport::with(status, reason)))
            .collect(),
        running_count: None,
        version: None,
        executable: None,
        executable_source: None,
        executable_override: None,
        status: None,
        account: None,
        models: None,
        options: None,
        defaults: None,
        favorite_models: Vec::new(),
        hidden_models: Vec::new(),
        checked_at: None,
    }
}

pub(crate) fn set_capability(
    descriptor: &mut ProviderDescriptor,
    key: &str,
    status: &str,
    reason: Option<&str>,
) {
    descriptor.capabilities.insert(
        key.into(),
        CapabilitySupport {
            status: status.into(),
            reason: reason.map(Into::into),
        },
    );
}

/// Bounded text for a block: keeps the head and the end of long output.
/// Lines kept in a file change's preview, and its size limit.
const PREVIEW_LINES: usize = 120;
const PREVIEW_BYTES: usize = 12_000;

/// A bounded diff preview from `(marker, line)` pairs, where the marker is
/// `+`, `-`, ` ` or `@`. None when there is nothing to show.
pub(crate) fn diff_preview<'a>(lines: impl IntoIterator<Item = (char, &'a str)>) -> Option<String> {
    let mut out = String::new();
    for (count, (marker, line)) in lines.into_iter().enumerate() {
        if count == PREVIEW_LINES || out.len() + line.len() + 2 > PREVIEW_BYTES {
            break;
        }
        out.push(marker);
        out.push_str(&line.chars().take(400).collect::<String>());
        out.push('\n');
    }
    (!out.is_empty()).then(|| out.trim_end_matches('\n').to_string())
}

pub(crate) fn bounded(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    if count <= limit {
        return text.to_string();
    }
    let keep = limit.saturating_sub(40) / 2;
    let head: String = text.chars().take(keep).collect();
    let tail: String = text.chars().skip(count - keep).collect();
    format!(
        "{head}\n… {} characters omitted …\n{tail}",
        count - keep * 2
    )
}

/// Removes terminal escape sequences and control characters a provider may
/// include in a human-readable reason before JAM displays it.
pub(crate) fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if c.is_control() && c != '\n' && c != '\t' {
            continue;
        }
        out.push(c);
    }
    out
}

/// Longest provider-reported plan or sign-in method JAM shows.
pub(crate) const ACCOUNT_LABEL_LIMIT: usize = 128;
/// Longest provider-reported account identity (an email is at most 254).
pub(crate) const ACCOUNT_IDENTITY_LIMIT: usize = 256;

/// One provider-reported account field as display text: a trimmed, single
/// line of at most `limit` characters. Anything else, including a value that
/// is too long or not a string, is unknown rather than cut or guessed.
pub(crate) fn account_text(value: Option<&serde_json::Value>, limit: usize) -> Option<String> {
    account_label(value?.as_str()?, limit)
}

/// [`account_text`] for a value already read as a string.
pub(crate) fn account_label(text: &str, limit: usize) -> Option<String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > limit || text.chars().any(char::is_control) {
        return None;
    }
    Some(text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn account_text_is_bounded_plain_and_otherwise_unknown() {
        let field = |value: serde_json::Value| account_text(Some(&value), 16);
        assert_eq!(field(json!("  Claude Max ")).as_deref(), Some("Claude Max"));
        assert_eq!(field(json!("a".repeat(16))), Some("a".repeat(16)));
        assert_eq!(field(json!("a".repeat(17))), None);
        assert_eq!(field(json!("line\nbreak")), None);
        assert_eq!(field(json!("\u{1b}[31mred")), None);
        assert_eq!(field(json!("   ")), None);
        assert_eq!(field(json!(42)), None);
        assert_eq!(field(json!(null)), None);
        assert_eq!(account_text(None, 16), None);
    }

    #[test]
    fn long_text_keeps_both_ends() {
        let text = "a".repeat(100) + &"b".repeat(100);
        let out = bounded(&text, 100);
        assert!(out.starts_with("aaa") && out.ends_with("bbb"));
        assert!(out.contains("omitted"));
        assert_eq!(bounded("short", 100), "short");
    }

    #[test]
    fn escapes_are_removed_from_display_text() {
        assert_eq!(plain("\u{1b}[31mred\u{1b}[0m\u{7}!"), "red!");
    }
}
