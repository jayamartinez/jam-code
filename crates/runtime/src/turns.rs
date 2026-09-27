use crate::{
    commands::StartTurn,
    error::JamError,
    protocol::*,
    providers::ProviderTurn,
    runtime::{RunningTask, Runtime, new_id, now},
};
use serde_json::{Value, json};
use std::sync::{Arc, atomic::Ordering};
use tokio::sync::{mpsc, watch};

impl Runtime {
    pub(crate) fn start_turn(
        self: &Arc<Self>,
        mut input: StartTurn,
        fingerprint: String,
    ) -> Result<Value, JamError> {
        let mut state = self.lock()?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err(JamError::new("unavailable", "JAM is shutting down."));
        }
        if let Some(receipt) = state.store.receipt(&input.request_id, &fingerprint)? {
            return Ok(receipt);
        }
        let mut resource = state.store.resource(&input.resource_id)?;
        let session_id = resource
            .session_id
            .clone()
            .ok_or_else(|| JamError::invalid("This resource is not a conversation."))?;
        let mut session = state.store.session(&session_id)?;
        if session.status == SessionStatus::Running {
            return Err(JamError::new(
                "conflict",
                "This session is already running. Interrupt it before starting another turn.",
            ));
        }
        // Reject before accepting persistent input if this host cannot supervise async work.
        let executor = tokio::runtime::Handle::try_current()
            .map_err(|_| JamError::new("unavailable", "The runtime executor is not available."))?;
        resource.updated_at = now();
        // Continuing a closed thread is the clearest sign it is in use again.
        resource.closed_at = None;
        if resource.title == "New conversation" {
            resource.title = if input.text.trim().is_empty() {
                "Context conversation".into()
            } else {
                input.text.trim().chars().take(80).collect()
            };
        }
        state
            .store
            .attach_snapshots(&mut input.context, &resource.id, false)?;
        let mut attached_context = input.context.clone();
        let mut blocks = Vec::new();
        if !input.context.is_empty() {
            blocks.push(MessageBlock::Context {
                items: input.context,
            });
        }
        if !input.text.is_empty() {
            blocks.push(MessageBlock::Text {
                text: input.text.clone(),
            });
        }
        let user_message = Message {
            id: new_id("message"),
            role: "user".into(),
            created_at: now(),
            blocks,
        };
        session.status = SessionStatus::Running;
        let receipt = json!({"accepted":true,"sessionId":session.id,"requestId":input.request_id});
        state.store.transaction(|| {
            state
                .store
                .attach_snapshots(&mut attached_context, &resource.id, true)?;
            state.store.save_resource(&resource)?;
            state.store.save_session(&session)?;
            state.store.save_message(&resource, &user_message)?;
            state
                .store
                .save_receipt(&input.request_id, &fingerprint, &receipt)
        })?;
        self.publish(
            &mut state,
            &resource.id,
            EventPayload::MessageUpserted {
                message: user_message,
            },
        );
        self.publish(
            &mut state,
            &resource.id,
            EventPayload::SessionUpdated {
                session: session.clone(),
            },
        );
        let (cancel, cancelled) = watch::channel(false);
        let runtime = Arc::clone(self);
        let request_id = input.request_id.clone();
        let handle = executor.spawn(async move {
            runtime
                .run_turn(resource, session, request_id, input.text, cancelled)
                .await;
        });
        state.tasks.insert(
            input.request_id,
            RunningTask {
                session_id: session_id.to_owned(),
                cancel,
                handle,
            },
        );
        Ok(receipt)
    }

    async fn run_turn(
        self: Arc<Self>,
        resource: Resource,
        session: Session,
        request_id: String,
        text: String,
        mut cancelled: watch::Receiver<bool>,
    ) {
        let (sender, mut receiver) = mpsc::channel(16);
        // The provider future is owned by this supervisor; dropping it cancels all adapter work.
        let provider = self
            .adapter
            .run_turn(ProviderTurn { text }, sender, cancelled.clone());
        tokio::pin!(provider);
        let mut provider_finished = false;
        let mut outcome_seen = false;
        let message_id = new_id("message");
        let created_at = now();
        loop {
            tokio::select! {
                biased;
                _ = cancelled.changed() => break,
                update = receiver.recv() => {
                    let Some(update) = update else { break; };
                    if *cancelled.borrow() { break; }
                    let Ok(mut state) = self.lock() else { break; };
                    if *cancelled.borrow() { break; }
                    let Ok(mut current) = state.store.session(&session.id) else { break; };
                    if current.status != SessionStatus::Running { break; }
                    let message = Message { id: message_id.clone(), role: "assistant".into(), created_at: created_at.clone(), blocks: update.blocks };
                    if let Some(status) = update.outcome { current.status = status; }
                    let saved = state.store.transaction(|| {
                        state.store.save_message(&resource, &message)?;
                        state.store.save_session(&current)
                    });
                    if saved.is_err() { break; }
                    outcome_seen = update.outcome.is_some();
                    self.publish(&mut state, &resource.id, EventPayload::MessageUpserted { message });
                    if outcome_seen { self.publish(&mut state, &resource.id, EventPayload::SessionUpdated { session: current }); }
                }
                result = &mut provider, if !provider_finished => {
                    provider_finished = true;
                    if result.is_err() { break; }
                }
            }
        }
        if let Ok(mut state) = self.lock() {
            if !outcome_seen
                && !*cancelled.borrow()
                && let Ok(mut current) = state.store.session(&session.id)
            {
                current.status = SessionStatus::Failed;
                if state.store.save_session(&current).is_ok() {
                    self.publish(
                        &mut state,
                        &resource.id,
                        EventPayload::SessionUpdated { session: current },
                    );
                }
            }
            state.tasks.remove(&request_id);
        }
    }

    pub(crate) fn interrupt(&self, session_id: &str) -> Result<bool, JamError> {
        let mut state = self.lock()?;
        let mut session = state.store.session(session_id)?;
        if session.status != SessionStatus::Running {
            return Ok(false);
        }
        session.status = SessionStatus::Interrupted;
        let interrupted_messages = state.store.transaction(|| {
            state.store.save_session(&session)?;
            state.store.interrupt_messages(&session.resource_id)
        })?;
        for task in state
            .tasks
            .values()
            .filter(|task| task.session_id == session_id)
        {
            let _ = task.cancel.send(true);
        }
        let resource_id = session.resource_id.clone();
        for message in interrupted_messages {
            self.publish(
                &mut state,
                &resource_id,
                EventPayload::MessageUpserted { message },
            );
        }
        self.publish(
            &mut state,
            &resource_id,
            EventPayload::SessionUpdated { session },
        );
        Ok(true)
    }
}
