//! JAM domain runtime. This crate has no UI framework or native host dependency.
pub mod appearance;
mod commands;
mod error;
mod events;
mod files;
pub mod git;
mod native_files;
#[cfg(windows)]
mod process_tree;
pub mod protocol;
mod provider_requests;
pub mod providers;
mod runtime;
pub mod snapshots;
mod storage;
mod system_open;
pub mod terminal;
mod turns;

pub use error::JamError;
pub use events::EventReceiver;
pub use runtime::{Runtime, Subscription};
