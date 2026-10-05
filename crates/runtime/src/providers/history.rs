//! The provider-history contract: how an adapter lets JAM discover and read
//! conversations that live in its provider's own history (Codex threads,
//! Claude Code sessions), including ones created outside JAM.
//!
//! The provider's record stays canonical. An adapter only reports it; the
//! runtime (`crate::history`) owns JAM's index of it, its projection into a
//! JAM conversation, tombstones and project association.
//!
//! Listing and reading are separate on purpose. A listing is cheap metadata
//! for many conversations and never carries a transcript; a read returns one
//! conversation's messages, a page at a time, when the reader syncs it.
//! Resuming needs nothing here: a synced conversation has an ordinary
//! provider binding, and `ProviderAdapter::run_turn` resumes it by its ID.
use super::ProviderConfig;
use crate::{error::JamError, protocol::MessageBlock};
use std::{future::Future, pin::Pin};

pub type HistoryFuture<T> = Pin<Box<dyn Future<Output = Result<T, JamError>> + Send>>;

/// Implemented by an adapter whose provider exposes its history; returned by
/// `ProviderAdapter::history`. Both calls run without the database lock and
/// must not start a turn or make an inference request.
pub trait ProviderHistory: Send + Sync {
    /// One page of discovery metadata. Pages continue from `page`, an opaque
    /// token from the previous page's `next_page`; the last page has none.
    ///
    /// A listing should be complete: a conversation that a complete listing
    /// leaves out is marked missing. An adapter without a reliable order or
    /// cursor may return everything in one page.
    fn list(&self, request: HistoryListRequest) -> HistoryFuture<HistoryPage>;

    /// One page of one conversation's messages, oldest first. A conversation
    /// the provider no longer has is `not_found`.
    fn read(&self, request: HistoryReadRequest) -> HistoryFuture<HistoryTranscript>;

    /// One conversation's current metadata, without its messages: cheap
    /// enough to ask whenever the reader opens a synced conversation, so it
    /// is read again only when it changed. `None` when the provider no
    /// longer has it.
    fn item(&self, request: HistoryItemRequest) -> HistoryFuture<Option<HistoryItem>>;
}

#[derive(Debug, Clone)]
pub struct HistoryItemRequest {
    pub native_id: String,
    pub config: ProviderConfig,
}

#[derive(Debug, Clone)]
pub struct HistoryListRequest {
    pub page: Option<String>,
    /// Only conversations from these folders, when any are given. A hint: an
    /// adapter that cannot filter returns everything, and the runtime matches
    /// folders itself. A filtered listing marks nothing missing.
    pub folders: Vec<String>,
    /// The most items the runtime wants in this page. A hint; the runtime
    /// bounds what it accepts.
    pub limit: usize,
    pub config: ProviderConfig,
}

#[derive(Debug, Clone, Default)]
pub struct HistoryPage {
    pub items: Vec<HistoryItem>,
    pub next_page: Option<String>,
}

/// Discovery metadata for one conversation. Everything except `native_id`
/// is optional, untrusted display data, bounded and cleaned by the runtime.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HistoryItem {
    /// The provider's own ID: a Codex thread ID or a Claude session ID.
    /// Identity is this ID and nothing else.
    pub native_id: String,
    pub title: Option<String>,
    /// A short excerpt, only when the provider has one cheaply.
    pub preview: Option<String>,
    /// RFC 3339.
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// Any token that changes whenever the conversation does (a version, an
    /// update time, a file's size and modification time). Absent means the
    /// runtime compares `updated_at`.
    pub revision: Option<String>,
    /// The folder the conversation worked in, as the provider reports it.
    /// Never trusted as access: it only matches an existing JAM project.
    pub cwd: Option<String>,
    /// The Git branch it last worked on, as the provider reports it.
    pub branch: Option<String>,
    /// Whether `run_turn` can continue it by `native_id`.
    pub resumable: bool,
}

#[derive(Debug, Clone)]
pub struct HistoryReadRequest {
    pub native_id: String,
    /// Continues from the previous page's `next_page`.
    pub page: Option<String>,
    /// The `checkpoint` the last complete sync ended with. An adapter that
    /// can read on from there returns only newer messages; one that cannot
    /// ignores it and returns them all, which is equally correct.
    pub checkpoint: Option<String>,
    pub limit: usize,
    pub config: ProviderConfig,
}

#[derive(Debug, Clone, Default)]
pub struct HistoryTranscript {
    /// Current metadata, when the read learned it; replaces the listing's.
    pub item: Option<HistoryItem>,
    pub messages: Vec<HistoryMessage>,
    pub next_page: Option<String>,
    /// On the last page: where a later sync may read on from.
    pub checkpoint: Option<String>,
}

/// One message from a provider's history, already normalized to JAM blocks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryMessage {
    /// Stable within its conversation: the provider's own message or item ID
    /// where it has one, otherwise a key the adapter derives from the
    /// message's position in the provider's record (such as a turn and item
    /// index). Never derived from the text alone. A repeated sync updates the
    /// message with the same `source_id` instead of adding another.
    pub source_id: String,
    /// `user` or `assistant`.
    pub role: String,
    pub created_at: Option<String>,
    pub blocks: Vec<MessageBlock>,
}
