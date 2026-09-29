//! JAM domain runtime. This crate has no UI framework or native host dependency.
pub mod appearance;
mod commands;
mod demo_cleanup;
mod error;
mod events;
mod files;
pub mod git;
mod native_files;
mod new_chat;
#[cfg(windows)]
mod process_tree;
mod projects;
pub mod protocol;
mod provider_requests;
pub mod providers;
mod runtime;
pub mod snapshots;
mod storage;
mod system_open;
pub mod terminal;
mod turns;
mod worktrees;

pub use error::JamError;

/// `CREATE_NO_WINDOW`: the desktop app has no console, so a console program
/// it starts in the background would otherwise open a visible window.
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub use events::EventReceiver;
pub use runtime::{Runtime, Subscription};
