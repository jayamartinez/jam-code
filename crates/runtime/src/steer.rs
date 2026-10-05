//! Steering: a message the reader sends into the running turn.
//!
//! Only a provider with a real steering mechanism is steered (its `steering`
//! capability); JAM never emulates one by interrupting and starting another
//! turn. The message is delivered first and recorded once the provider has
//! taken it, so the transcript never shows a message the agent did not get,
//! and a refused steer leaves nothing behind: the reader can queue it instead.
use crate::{
    commands::StartTurn,
    error::JamError,
    protocol::*,
    provider_requests::block_on,
    providers::SteerInput,
    runtime::Runtime,
    turns::{commit_context, compose, user_message},
};
use serde_json::{Value, json};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::sync::{mpsc::error::TrySendError, oneshot};

/// How long a provider may take to accept or refuse a steered message.
const STEER_TIMEOUT: Duration = Duration::from_secs(15);

impl Runtime {
    /// Steers the running turn with `input`. `queued` names the follow-up it
    /// comes from, which leaves the queue when the steer is recorded.
    pub(crate) fn steer(
        self: &Arc<Self>,
        mut input: StartTurn,
        fingerprint: String,
        queued: Option<String>,
    ) -> Result<Value, JamError> {
        let provider_id = {
            let state = self.lock()?;
            let resource = state.store.resource(&input.resource_id)?;
            let session_id = resource
                .session_id
                .ok_or_else(|| JamError::invalid("This resource is not a conversation."))?;
            state.store.session(&session_id)?.provider_id
        };
        let descriptor = if provider_id == "mock" {
            None
        } else {
            Some(self.provider_descriptor(&provider_id)?)
        };

        // Everything that can refuse the steer is checked before delivery.
        let (resource, session, mut resolved, sender, steered) = {
            let mut state = self.lock()?;
            if self.shutting_down.load(Ordering::Acquire) {
                return Err(JamError::new("unavailable", "JAM is shutting down."));
            }
            if let Some(receipt) = state.store.receipt(&input.request_id, &fingerprint)? {
                return Ok(receipt);
            }
            if state.steering.contains(&input.request_id) {
                return Err(JamError::new(
                    "conflict",
                    "This message is already being sent.",
                ));
            }
            let resource = state.store.resource(&input.resource_id)?;
            let session_id = resource
                .session_id
                .clone()
                .ok_or_else(|| JamError::invalid("This resource is not a conversation."))?;
            let session = state.store.session(&session_id)?;
            let task = state
                .tasks
                .values()
                .find(|task| task.session_id == session_id && !*task.cancel.borrow())
                .filter(|_| session.status == SessionStatus::Running)
                .ok_or_else(|| {
                    JamError::new(
                        "conflict",
                        "No turn is running to steer. Send the message instead.",
                    )
                })?;
            if let Some(reason) = &task.steer_refusal {
                return Err(JamError::new("unsupported", reason.clone()));
            }
            let (sender, steered) = (task.steer.clone(), Arc::clone(&task.steered));
            if let Some(id) = queued.as_deref()
                && !state
                    .store
                    .queued_turn(id)?
                    .is_some_and(|turn| turn.resource_id == resource.id)
            {
                return Err(JamError::new(
                    "not_found",
                    "That queued message was already sent or removed.",
                ));
            }
            let resolved = self.resolve_context(
                &state,
                &mut input.context,
                &resource.id,
                &provider_id,
                descriptor.as_ref(),
                &session.options,
                queued.as_deref(),
            )?;
            state.steering.insert(input.request_id.clone());
            (resource, session, resolved, sender, steered)
        };

        // Delivery waits on the provider, never under the database lock.
        let delivered = (|| {
            let files = self.deliverable_files(&provider_id, &mut resolved)?;
            let text = compose(
                &input.text,
                &input.context,
                &files,
                !resolved.images.is_empty(),
            );
            let (reply, answer) = oneshot::channel();
            let steer = SteerInput {
                text,
                images: resolved.images.clone(),
                reply,
            };
            let outcome = match sender.try_send(steer) {
                Ok(()) => match block_on(tokio::time::timeout(STEER_TIMEOUT, answer)) {
                    Some(Ok(Ok(result))) => result,
                    Some(Ok(Err(_))) => Err(JamError::new(
                        "stale",
                        "The turn ended before the message was delivered. Send or queue it again.",
                    )),
                    Some(Err(_)) => Err(JamError::new(
                        "unavailable",
                        "The agent did not answer in time, so the message may not have been delivered.",
                    )),
                    None => Err(JamError::new(
                        "unavailable",
                        "The runtime executor is not available.",
                    )),
                },
                Err(TrySendError::Full(_)) => Err(JamError::new(
                    "conflict",
                    "Another message is being steered into this turn. Try again in a moment.",
                )),
                // The adapter dropped its receiver: its provider is not steered.
                Err(TrySendError::Closed(_)) => Err(JamError::new(
                    "unsupported",
                    "This agent cannot take a message while it works. Queue it instead.",
                )),
            };
            if outcome.is_err() {
                self.attachments.release(&resolved.attachments);
            }
            outcome
        })();
        let mut state = self.lock()?;
        state.steering.remove(&input.request_id);
        delivered?;

        // The provider has the message: record it where it now belongs.
        let mut context = input.context.clone();
        let message = user_message(&input.text, input.context);
        let receipt = json!({
            "accepted": true,
            "sessionId": session.id,
            "requestId": input.request_id,
            "steered": true,
        });
        state.store.transaction(|| {
            commit_context(&state, &mut context, &resource.id, queued.as_deref())?;
            state.store.save_message(&resource, &message)?;
            state.store.touch_resource(&resource.id)?;
            state
                .store
                .save_receipt(&input.request_id, &fingerprint, &receipt)
        })?;
        // The reply continues below this message.
        steered.fetch_add(1, Ordering::AcqRel);
        self.publish(
            &mut state,
            &resource.id,
            EventPayload::MessageUpserted { message },
        );
        if queued.is_some() {
            self.publish_queue(&mut state, &resource.id);
        }
        Ok(receipt)
    }
}
