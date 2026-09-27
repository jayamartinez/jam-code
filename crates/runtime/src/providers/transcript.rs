//! Builds one turn's assistant blocks from provider events.
//!
//! Providers stream deltas and later send authoritative items. Blocks are
//! keyed by the provider's item identity, so a final item replaces what its
//! deltas built instead of appending a second copy. Updates are coalesced:
//! every change marks the transcript dirty and the adapter flushes at most
//! every `FLUSH_INTERVAL`, which bounds database writes during streaming.
use super::{ProviderUpdate, bounded};
use crate::protocol::{Interaction, MessageBlock};
use std::{collections::HashMap, time::Duration};
use tokio::{sync::mpsc, time::Instant};

pub(crate) const FLUSH_INTERVAL: Duration = Duration::from_millis(80);
/// Leaves room below the protocol's 1,000 block limit for closing notices.
const MAX_BLOCKS: usize = 900;
pub(crate) const MAX_TEXT: usize = 190_000;
pub(crate) const MAX_DETAIL: usize = 60_000;
/// One compaction notice per turn: shown when it starts, then replaced by
/// what the provider reports.
const COMPACTION: &str = "compaction";
const COMPACTING: &str = "Compacting context…";

pub(crate) struct Transcript {
    blocks: Vec<MessageBlock>,
    keys: HashMap<String, usize>,
    updates: mpsc::Sender<ProviderUpdate>,
    dirty: bool,
    last_flush: Instant,
    omitted: bool,
}

impl Transcript {
    pub fn new(updates: mpsc::Sender<ProviderUpdate>) -> Self {
        Self {
            blocks: Vec::new(),
            keys: HashMap::new(),
            updates,
            dirty: false,
            last_flush: Instant::now() - FLUSH_INTERVAL,
            omitted: false,
        }
    }

    /// Inserts or replaces the block for `key`.
    pub fn upsert(&mut self, key: &str, block: MessageBlock) {
        if let Some(index) = self.keys.get(key) {
            if self.blocks[*index] != block {
                self.blocks[*index] = block;
                self.dirty = true;
            }
            return;
        }
        if self.blocks.len() >= MAX_BLOCKS {
            if !self.omitted {
                self.omitted = true;
                self.blocks.push(MessageBlock::Notice {
                    tone: "info".into(),
                    text: "Further activity in this turn is not shown.".into(),
                });
                self.dirty = true;
            }
            return;
        }
        self.keys.insert(key.to_string(), self.blocks.len());
        self.blocks.push(block);
        self.dirty = true;
    }

    pub fn contains(&self, key: &str) -> bool {
        self.keys.contains_key(key)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut MessageBlock> {
        let index = *self.keys.get(key)?;
        self.dirty = true;
        self.blocks.get_mut(index)
    }

    /// Appends streamed text or reasoning to the block for `key`.
    pub fn append(&mut self, key: &str, reasoning: bool, delta: &str) {
        if delta.is_empty() {
            return;
        }
        match self.get_mut(key) {
            Some(MessageBlock::Text { text } | MessageBlock::Reasoning { text }) => {
                if text.len() < MAX_TEXT {
                    text.push_str(delta);
                }
            }
            Some(_) => {}
            None => self.upsert(
                key,
                if reasoning {
                    MessageBlock::Reasoning { text: delta.into() }
                } else {
                    MessageBlock::Text { text: delta.into() }
                },
            ),
        }
    }

    /// Replaces streamed text with the provider's final text.
    pub fn set_text(&mut self, key: &str, reasoning: bool, text: &str) {
        let text = bounded(text, MAX_TEXT);
        self.upsert(
            key,
            if reasoning {
                MessageBlock::Reasoning { text }
            } else {
                MessageBlock::Text { text }
            },
        );
    }

    /// Appends output to a tool block's detail, keeping it bounded.
    pub fn append_detail(&mut self, key: &str, delta: &str) {
        if let Some(MessageBlock::Tool { detail, .. }) = self.get_mut(key) {
            detail.push_str(delta);
            if detail.len() > MAX_DETAIL * 2 {
                *detail = bounded(detail, MAX_DETAIL);
            }
        }
    }

    pub fn notice(&mut self, tone: &str, text: &str) {
        self.blocks.push(MessageBlock::Notice {
            tone: tone.into(),
            text: bounded(text, 4_000),
        });
        self.dirty = true;
    }

    /// Shows a requested compaction as under way, so the turn has a visible
    /// message before the provider reports anything.
    pub fn compacting(&mut self) {
        self.compaction_notice(COMPACTING);
    }

    /// The provider's report of a compaction, requested or automatic.
    pub fn compacted(&mut self, text: &str) {
        self.compaction_notice(text);
    }

    /// Replaces a compaction notice the provider never followed up on.
    pub fn end_compaction(&mut self, text: &str) {
        if matches!(self.get_mut(COMPACTION), Some(MessageBlock::Notice { text, .. }) if text == COMPACTING)
        {
            self.compaction_notice(text);
        }
    }

    fn compaction_notice(&mut self, text: &str) {
        self.upsert(
            COMPACTION,
            MessageBlock::Notice {
                tone: "info".into(),
                text: bounded(text, 4_000),
            },
        );
    }

    pub fn interaction(&mut self, interaction: Interaction) {
        let key = format!("interaction:{}", interaction.id);
        self.upsert(&key, MessageBlock::Interaction { interaction });
    }

    pub fn update_interaction(&mut self, id: &str, update: impl FnOnce(&mut Interaction)) {
        if let Some(MessageBlock::Interaction { interaction }) =
            self.get_mut(&format!("interaction:{id}"))
        {
            update(interaction);
        }
    }

    /// Marks every unfinished tool and pending interaction as ended, such as
    /// after an interruption or a provider exit.
    pub fn settle(&mut self, reason: &str) {
        for block in &mut self.blocks {
            match block {
                MessageBlock::Tool { status, detail, .. } if status == "running" => {
                    *status = "failed".into();
                    if !detail.is_empty() {
                        detail.push_str(" · ");
                    }
                    detail.push_str(reason);
                    self.dirty = true;
                }
                MessageBlock::Interaction { interaction }
                    if interaction.status == crate::protocol::InteractionStatus::Pending =>
                {
                    interaction.status = crate::protocol::InteractionStatus::Cancelled;
                    interaction.outcome = Some(reason.into());
                    self.dirty = true;
                }
                _ => {}
            }
        }
    }

    pub fn due(&self) -> Option<Instant> {
        self.dirty.then_some(self.last_flush + FLUSH_INTERVAL)
    }

    /// Sends the blocks if anything changed. Returns false once the runtime
    /// stopped listening.
    pub async fn flush(&mut self) -> bool {
        if !self.dirty {
            return !self.updates.is_closed();
        }
        self.dirty = false;
        self.last_flush = Instant::now();
        self.updates
            .send(ProviderUpdate::Blocks(self.blocks.clone()))
            .await
            .is_ok()
    }

    pub async fn send(&self, update: ProviderUpdate) -> bool {
        self.updates.send(update).await.is_ok()
    }
}

/// Sleeps until the transcript's next flush, or forever when clean.
pub(crate) async fn until(due: Option<Instant>) {
    match due {
        Some(due) => tokio::time::sleep_until(due).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn final_text_replaces_its_deltas() {
        let (sender, mut receiver) = mpsc::channel(8);
        let mut transcript = Transcript::new(sender);
        transcript.append("m1", false, "Hel");
        transcript.append("m1", false, "lo");
        transcript.set_text("m1", false, "Hello");
        transcript.append("r1", true, "thinking");
        assert!(transcript.flush().await);
        let Some(ProviderUpdate::Blocks(blocks)) = receiver.recv().await else {
            panic!("blocks")
        };
        assert_eq!(
            blocks,
            vec![
                MessageBlock::Text {
                    text: "Hello".into()
                },
                MessageBlock::Reasoning {
                    text: "thinking".into()
                }
            ]
        );
        assert!(
            transcript.due().is_none(),
            "a clean transcript is not flushed"
        );
    }

    #[test]
    fn settle_ends_running_tools() {
        let (sender, _receiver) = mpsc::channel(8);
        let mut transcript = Transcript::new(sender);
        transcript.upsert(
            "t",
            MessageBlock::Tool {
                id: "t".into(),
                kind: "command".into(),
                title: "ls".into(),
                detail: String::new(),
                status: "running".into(),
                files: None,
            },
        );
        transcript.settle("Interrupted");
        let Some(MessageBlock::Tool { status, detail, .. }) = transcript.get_mut("t") else {
            panic!()
        };
        assert_eq!(status, "failed");
        assert_eq!(detail, "Interrupted");
    }

    #[test]
    fn a_compaction_notice_is_replaced_not_repeated() {
        let notice = |transcript: &mut Transcript| match transcript.get_mut(COMPACTION) {
            Some(MessageBlock::Notice { text, .. }) => text.clone(),
            _ => panic!("compaction notice"),
        };
        let (sender, _receiver) = mpsc::channel(8);
        let mut transcript = Transcript::new(sender);
        transcript.compacting();
        assert_eq!(notice(&mut transcript), COMPACTING);
        transcript.compacted("Compacted.");
        transcript.end_compaction("Not reported.");
        assert_eq!(notice(&mut transcript), "Compacted.");
        assert_eq!(transcript.blocks.len(), 1);

        let (sender, _receiver) = mpsc::channel(8);
        let mut unreported = Transcript::new(sender);
        unreported.compacting();
        unreported.end_compaction("Not reported.");
        assert_eq!(notice(&mut unreported), "Not reported.");
    }
}
