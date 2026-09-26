//! Adapters emit normalized JAM blocks. Provider wire protocols stay in this module.
mod mock;
pub use mock::MockProvider;

use crate::{
    error::JamError,
    protocol::{MessageBlock, SessionStatus},
};
use std::{future::Future, pin::Pin};
use tokio::sync::{mpsc, watch};

pub struct ProviderTurn {
    pub text: String,
}
pub struct ProviderUpdate {
    /// An authoritative replacement for this assistant message's current blocks.
    pub blocks: Vec<MessageBlock>,
    pub outcome: Option<SessionStatus>,
}

pub type ProviderFuture = Pin<Box<dyn Future<Output = Result<(), JamError>> + Send>>;

pub trait ProviderAdapter: Send + Sync {
    fn run_turn(
        &self,
        turn: ProviderTurn,
        updates: mpsc::Sender<ProviderUpdate>,
        cancelled: watch::Receiver<bool>,
    ) -> ProviderFuture;
}
