use super::{ProviderAdapter, ProviderFuture, ProviderTurn, ProviderUpdate};
use crate::protocol::{MessageBlock, SessionStatus};
use std::time::Duration;
use tokio::sync::{mpsc, watch};

/// Deliberately performs no I/O, process invocation, model call or file mutation.
pub struct MockProvider;

impl ProviderAdapter for MockProvider {
    fn run_turn(
        &self,
        turn: ProviderTurn,
        updates: mpsc::Sender<ProviderUpdate>,
        mut cancelled: watch::Receiver<bool>,
    ) -> ProviderFuture {
        Box::pin(async move {
            let fail = turn.text.trim() == "/fail";
            for index in 0..4 {
                tokio::select! {
                    biased;
                    _ = cancelled.changed() => return Ok(()),
                    _ = tokio::time::sleep(Duration::from_millis(350)) => {}
                }
                let mut blocks = vec![MessageBlock::Text { text: "I'll trace the resource and session boundaries, then summarize the result. This is a simulated provider turn.".into() }];
                if index >= 1 {
                    blocks.push(MessageBlock::Tool {
                        id: "mock-inspection".into(),
                        kind: "read".into(),
                        title: "Inspect resource ownership".into(),
                        detail: "Simulated inspection · no files were read or changed".into(),
                        status: if index == 1 {
                            "running"
                        } else if fail {
                            "failed"
                        } else {
                            "completed"
                        }
                        .into(),
                        files: None,
                    });
                }
                if index == 3 {
                    blocks.push(MessageBlock::Text { text: if fail {
                    "The mock provider encountered the requested test failure. Your message remains saved; start another turn to continue."
                } else {
                    "The runtime owns the session; a pane only presents its resource. Detaching a view leaves work available in history. This mock turn is complete, and the transcript is saved locally. No commands ran and no repository files changed."
                }.into() });
                }
                let outcome = (index == 3).then_some(if fail {
                    SessionStatus::Failed
                } else {
                    SessionStatus::Idle
                });
                if updates
                    .send(ProviderUpdate { blocks, outcome })
                    .await
                    .is_err()
                {
                    return Ok(());
                }
            }
            Ok(())
        })
    }
}
