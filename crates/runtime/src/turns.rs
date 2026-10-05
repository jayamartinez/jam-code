use crate::{
    attachments::{AttachedFile, Attachment},
    commands::StartTurn,
    error::JamError,
    protocol::*,
    providers::{ImageInput, ProviderTurn, ProviderUpdate, TurnIo},
    runtime::{RunningTask, Runtime, State, new_id, now},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::sync::{mpsc, watch};

/// How long an interrupted adapter may take to stop its provider's turn
/// before JAM stops waiting. The session is already marked interrupted.
const INTERRUPT_DRAIN: Duration = Duration::from_secs(10);

/// A turn that starts from a queued follow-up.
pub(crate) struct FromQueue {
    pub id: String,
    /// The previous turn finished and kept the session running so this one
    /// follows it without the chat appearing to stop in between.
    pub handoff: bool,
}

/// What a Send's context resolves to before anything is committed: the
/// attachments it sends and the images an adapter may also send natively.
pub(crate) struct Resolved {
    pub attachments: Vec<Attachment>,
    pub images: Vec<ImageInput>,
    /// Which image each image attachment became, so its path can be set once
    /// the copy is in its conversation's folder.
    image_slots: Vec<(String, usize)>,
}

impl Runtime {
    /// Starts a turn. With `compact`, the turn asks the provider to compact
    /// its context instead of sending a message: nothing is added to the
    /// transcript except what the provider reports.
    pub(crate) fn start_turn(
        self: &Arc<Self>,
        input: StartTurn,
        fingerprint: String,
        compact: bool,
    ) -> Result<Value, JamError> {
        self.start_turn_from(input, fingerprint, compact, None)
    }

    /// Starts a turn, from the composer or from a queued follow-up. A queued
    /// one is removed from the queue in the transaction that starts it, so it
    /// is sent at most once, and the assets it carried become this turn's.
    pub(crate) fn start_turn_from(
        self: &Arc<Self>,
        mut input: StartTurn,
        fingerprint: String,
        compact: bool,
        queued: Option<FromQueue>,
    ) -> Result<Value, JamError> {
        // Provider checks run before the database lock is taken.
        let (provider_id, project_id, worktree_id) = {
            let state = self.lock()?;
            let resource = state.store.resource(&input.resource_id)?;
            let session_id = resource
                .session_id
                .ok_or_else(|| JamError::invalid("This resource is not a conversation."))?;
            (
                state.store.session(&session_id)?.provider_id,
                resource.project_id,
                resource.worktree_id,
            )
        };
        // So does finding the folder: a worktree is verified with Git, which
        // must never run under the database lock.
        let cwd = if provider_id == "mock" {
            None
        } else {
            let project = self.project(
                project_id
                    .as_deref()
                    .ok_or_else(|| JamError::new("not_found", "Project not found."))?,
            )?;
            Some(self.work_folder(&project, worktree_id.as_deref())?.ok_or_else(|| {
                JamError::new(
                    "project_folder_required",
                    "Add a folder to this project in its details before starting an agent chat. Agents run in the project's folder.",
                )
            })?)
        };
        let descriptor = if provider_id == "mock" {
            None
        } else {
            Some(self.provider_descriptor(&provider_id)?)
        };
        let adapter = self.providers.adapter(&provider_id).ok_or_else(|| {
            JamError::new("provider_unavailable", "That provider is not available.")
        })?;
        // Whether this turn can be steered, decided once, when it starts.
        let steering = match &descriptor {
            Some(descriptor) => descriptor.clone(),
            None => adapter.unchecked(&Default::default()),
        };
        let steer_refusal = steer_refusal(&steering);

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
        // A handoff found the session running on purpose: the turn before
        // has ended and its task is gone, and nothing else could start.
        let handed_off = queued.as_ref().is_some_and(|q| q.handoff)
            && !state
                .tasks
                .values()
                .any(|task| task.session_id == session_id);
        if session.status == SessionStatus::Running && !handed_off {
            return Err(JamError::new(
                "conflict",
                "This session is already running. Interrupt it before starting another turn.",
            ));
        }
        let queued_id = queued.as_ref().map(|q| q.id.as_str());
        if let Some(id) = queued_id
            && state.store.queued_turn(id)?.is_none()
        {
            return Err(JamError::new(
                "not_found",
                "That queued message was already sent or removed.",
            ));
        }
        // Reject before accepting persistent input if this host cannot supervise async work.
        let executor = tokio::runtime::Handle::try_current()
            .map_err(|_| JamError::new("unavailable", "The runtime executor is not available."))?;

        // Everything that can refuse the turn is checked before anything is saved.
        let settings = self.provider_settings(&state)?;
        let mut options = session.options.clone();
        if let Some(descriptor) = &descriptor {
            if !settings.enabled(&provider_id) {
                return Err(JamError::new(
                    "provider_disabled",
                    format!("{} is turned off in Settings → Providers.", descriptor.name),
                ));
            }
            if descriptor.installation == "missing" {
                return Err(JamError::new(
                    "provider_unavailable",
                    format!(
                        "{} is not installed or its executable is not valid. Check Settings → Providers.",
                        descriptor.name
                    ),
                ));
            }
            let known = |key: &str| {
                key == "model"
                    || key == "effort"
                    || key == crate::providers::SPEED
                    || descriptor
                        .options
                        .as_ref()
                        .is_some_and(|o| o.iter().any(|option| option.id == key))
            };
            // Chosen options replace the saved ones, so a choice returned to
            // its default (no speed, no model) is cleared rather than kept.
            // Saved options the provider no longer offers are dropped; chosen
            // ones are validated as sent.
            match &input.options {
                Some(chosen) => options = chosen.clone(),
                None => options.retain(|key, _| known(key)),
            }
            crate::providers::validate_option(descriptor, &options)?;
        } else if input.options.as_ref().is_some_and(|o| !o.is_empty()) {
            return Err(JamError::invalid("The demo provider has no options."));
        }
        if compact
            && descriptor
                .as_ref()
                .and_then(|d| d.capabilities.get("compact"))
                .is_none_or(|c| c.status != "supported")
        {
            return Err(JamError::new(
                "unsupported",
                "This provider cannot compact its context from JAM.",
            ));
        }
        let mut resolved = self.resolve_context(
            &state,
            &mut input.context,
            &resource.id,
            &provider_id,
            descriptor.as_ref(),
            &options,
            queued_id,
        )?;
        resource.updated_at = now();
        // Continuing an archived thread is the clearest sign it is in use again.
        resource.closed_at = None;
        if resource.title == "New conversation" && !compact {
            resource.title = if input.text.trim().is_empty() {
                "Context conversation".into()
            } else {
                input.text.trim().chars().take(80).collect()
            };
        }
        let mut attached_context = input.context.clone();
        let user_message = user_message(&input.text, input.context);
        // Compaction keeps the chat's model and options as they are.
        if descriptor.is_some() && !compact {
            session.model = crate::provider_requests::model_label(descriptor.as_ref(), &options);
            session.options = options.clone();
        }
        session.status = SessionStatus::Running;
        session.needs_input = false;
        let native_id = state.store.binding(&session.id)?.map(|b| b.native_id);
        let receipt = json!({"accepted":true,"sessionId":session.id,"requestId":input.request_id});
        // Nothing can refuse the turn from here except the database. The
        // attachments move into this conversation's folder, so the paths the
        // agent is given are final; a failed save moves them back.
        let files = self.deliverable_files(&provider_id, &mut resolved)?;
        let provider_text = compose(
            &input.text,
            &attached_context,
            &files,
            !resolved.images.is_empty(),
        );
        let saved = state.store.transaction(|| {
            // From here the attachments belong to this conversation's history.
            commit_context(&state, &mut attached_context, &resource.id, queued_id)?;
            state.store.save_resource(&resource)?;
            state.store.save_session(&session)?;
            if !compact {
                state.store.save_message(&resource, &user_message)?;
            }
            state
                .store
                .save_receipt(&input.request_id, &fingerprint, &receipt)
        });
        if let Err(error) = saved {
            self.attachments.release(&resolved.attachments);
            return Err(error);
        }
        if !compact {
            self.publish(
                &mut state,
                &resource.id,
                EventPayload::MessageUpserted {
                    message: user_message,
                },
            );
        }
        if queued.is_some() {
            self.publish_queue(&mut state, &resource.id);
        }
        self.publish(
            &mut state,
            &resource.id,
            EventPayload::SessionUpdated {
                session: session.clone(),
            },
        );
        let turn = ProviderTurn {
            session_id: session.id.clone(),
            native_id,
            cwd,
            text: provider_text,
            images: resolved.images,
            files,
            attachment_dir: self.attachments.conversation_dir(&resource.id),
            options,
            config: settings.config(&provider_id),
            compact,
        };
        let version = descriptor.as_ref().and_then(|d| d.version.clone());
        let (cancel, cancelled) = watch::channel(false);
        let (finished_tx, finished) = watch::channel(());
        let (steer, steering) = mpsc::channel(4);
        let steered = Arc::new(AtomicU64::new(0));
        // An interrupted turn may still be stopping inside its provider. The
        // new turn is accepted now, but its provider work waits for that.
        let previous: Vec<watch::Receiver<()>> = state
            .tasks
            .values()
            .filter(|task| task.session_id == session_id)
            .map(|task| task.finished.clone())
            .collect();
        let runtime = Arc::clone(self);
        let request_id = input.request_id.clone();
        let supervised = Supervised {
            resource,
            session,
            request_id: request_id.clone(),
            version,
            steered: Arc::clone(&steered),
        };
        let handle = executor.spawn(async move {
            let _finished = finished_tx;
            let _ = tokio::time::timeout(INTERRUPT_DRAIN + Duration::from_secs(2), async {
                for mut previous in previous {
                    while previous.changed().await.is_ok() {}
                }
            })
            .await;
            runtime
                .run_turn(supervised, adapter, turn, cancelled, steering)
                .await;
        });
        state.tasks.insert(
            request_id,
            RunningTask {
                session_id: session_id.to_owned(),
                cancel,
                handle,
                finished,
                steer,
                steer_refusal: if compact {
                    Some("A compaction cannot be steered. Queue the message instead.".into())
                } else {
                    steer_refusal
                },
                steered,
            },
        );
        Ok(receipt)
    }

    /// Resolves a Send's context against the runtime's stores without
    /// committing anything: staged snapshots and attachments must exist and be
    /// unsent (and, for a queued follow-up, be the ones it carries), and an
    /// image is refused here when the chosen model cannot take it.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn resolve_context(
        &self,
        state: &State,
        context: &mut [ContextItem],
        resource_id: &str,
        provider_id: &str,
        descriptor: Option<&ProviderDescriptor>,
        options: &BTreeMap<String, String>,
        queued: Option<&str>,
    ) -> Result<Resolved, JamError> {
        state
            .store
            .attach_snapshots(context, resource_id, false, queued)?;
        let attachments = state
            .store
            .send_attachments(context, resource_id, false, queued)?;
        // Images the reader explicitly sent, resolved only now, on Send.
        let mut images = Vec::new();
        let mut image_slots: Vec<(String, usize)> = Vec::new();
        if provider_id != "mock" {
            for item in context.iter() {
                if !matches!(item.kind, ContextKind::Snapshot) {
                    continue;
                }
                let Some(asset) = item.asset_id.as_deref() else {
                    continue;
                };
                images.push(ImageInput {
                    media_type: "image/jpeg".into(),
                    bytes: Arc::new(self.snapshots.assets.read(asset, false)?),
                    path: self.snapshots.assets.image_path(asset).ok(),
                    label: item.label.clone(),
                });
            }
            // An attached image is also sent natively, from JAM's own copy.
            for attachment in &attachments {
                if attachment.kind == AttachmentKind::Image {
                    // Its path is set once the copy is in its final folder.
                    image_slots.push((attachment.id.clone(), images.len()));
                    images.push(ImageInput {
                        media_type: attachment.media_type.clone(),
                        bytes: Arc::new(self.attachments.read(attachment)?),
                        path: None,
                        label: attachment.name.clone(),
                    });
                }
            }
        }
        if !images.is_empty()
            && let Some(descriptor) = descriptor
        {
            let model_images = descriptor
                .models
                .as_deref()
                .and_then(|models| match options.get("model") {
                    Some(id) => models.iter().find(|m| &m.id == id),
                    None => models.iter().find(|m| m.is_default),
                })
                .and_then(|m| m.images.as_deref());
            let capability = descriptor
                .capabilities
                .get("images")
                .map(|c| c.status.as_str());
            if model_images == Some("unsupported") || capability == Some("unsupported") {
                return Err(JamError::new(
                    "unsupported",
                    format!(
                        "{} does not accept images with this model. Remove the image or choose another model.",
                        descriptor.name
                    ),
                ));
            }
        }
        Ok(Resolved {
            attachments,
            images,
            image_slots,
        })
    }

    /// Moves the attachments into their conversation's folder and lists them
    /// by the path of JAM's copy. On failure they are moved back.
    pub(crate) fn deliverable_files(
        &self,
        provider_id: &str,
        resolved: &mut Resolved,
    ) -> Result<Vec<AttachedFile>, JamError> {
        self.attachments.claim(&resolved.attachments)?;
        let mut files = Vec::new();
        if provider_id == "mock" {
            return Ok(files);
        }
        for attachment in &resolved.attachments {
            let path = match self.attachments.path(attachment) {
                Ok(path) => path,
                Err(error) => {
                    self.attachments.release(&resolved.attachments);
                    return Err(error);
                }
            };
            if let Some((_, slot)) = resolved
                .image_slots
                .iter()
                .find(|(id, _)| *id == attachment.id)
            {
                resolved.images[*slot].path = Some(path.clone());
            }
            files.push(AttachedFile {
                name: attachment.name.clone(),
                media_type: attachment.media_type.clone(),
                path,
            });
        }
        Ok(files)
    }

    async fn run_turn(
        self: Arc<Self>,
        supervised: Supervised,
        adapter: Arc<dyn crate::providers::ProviderAdapter>,
        turn: ProviderTurn,
        mut cancelled: watch::Receiver<bool>,
        steering: mpsc::Receiver<crate::providers::SteerInput>,
    ) {
        let Supervised {
            resource,
            session,
            request_id,
            version,
            steered,
        } = supervised;
        let (sender, mut receiver) = mpsc::channel(64);
        // The provider future is owned by this supervisor, never by a view.
        let provider = adapter.run_turn(
            turn,
            TurnIo {
                updates: sender,
                cancelled: cancelled.clone(),
                interactions: self.interactions.clone(),
                steering,
            },
        );
        tokio::pin!(provider);
        let mut provider_finished = false;
        let mut outcome_seen = false;
        // The previous turn ended and a queued follow-up goes next.
        let mut handoff = false;
        let mut failure: Option<String> = None;
        let mut reply = Reply::new();
        let mut seen_steers = 0;
        let mut last_blocks: Vec<MessageBlock> = Vec::new();
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
                    // A message steered in since the last update starts a new
                    // reply below it; what came before stays above it.
                    let steers = steered.load(Ordering::Acquire);
                    if steers != seen_steers {
                        seen_steers = steers;
                        reply.split(last_blocks.len());
                    }
                    match update {
                        ProviderUpdate::Blocks(blocks) => {
                            last_blocks = blocks.clone();
                            let messages = reply.messages(&blocks, None);
                            let waiting = waiting_for_reader(&blocks);
                            let session_changed = waiting != current.needs_input;
                            current.needs_input = waiting;
                            let saved = state.store.transaction(|| {
                                for message in &messages {
                                    state.store.save_message(&resource, message)?;
                                }
                                // A chat that starts waiting for the reader rises in its lists.
                                if session_changed && waiting {
                                    state.store.touch_resource(&resource.id)?;
                                }
                                state.store.save_session(&current)
                            });
                            if saved.is_err() { break; }
                            for message in messages {
                                self.publish(&mut state, &resource.id, EventPayload::MessageUpserted { message });
                            }
                            if session_changed {
                                self.publish(&mut state, &resource.id, EventPayload::SessionUpdated { session: current });
                            }
                        }
                        ProviderUpdate::Native(native_id) => {
                            // Who created the provider's conversation is the
                            // binding's `origin` column; a resumed one keeps it.
                            let data = json!({"version": version});
                            if state.store.save_binding(&session.id, &current.provider_id, &native_id, &data).is_err() { break; }
                        }
                        ProviderUpdate::Model(model) => {
                            if current.model != model {
                                current.model = model.chars().take(256).collect();
                                if state.store.save_session(&current).is_err() { break; }
                                self.publish(&mut state, &resource.id, EventPayload::SessionUpdated { session: current });
                            }
                        }
                        ProviderUpdate::Usage(usage) => {
                            if current.usage.as_ref() != Some(&usage) {
                                current.usage = Some(usage);
                                if state.store.save_session(&current).is_err() { break; }
                                self.publish(&mut state, &resource.id, EventPayload::SessionUpdated { session: current });
                            }
                        }
                        ProviderUpdate::Finished(status) => {
                            // A completed turn with a follow-up waiting keeps
                            // the session running: the follow-up starts as
                            // soon as this task has ended, and the chat never
                            // reports finishing in between. A failed or
                            // interrupted turn leaves the queue waiting.
                            handoff = status == SessionStatus::Idle
                                && state.store.queue_ready(&resource.id).unwrap_or(false);
                            current.status = if handoff { SessionStatus::Running } else { status };
                            current.needs_input = false;
                            // The reply records when its turn ended.
                            let messages = reply.messages(&last_blocks, Some(&now()));
                            let saved = state.store.transaction(|| {
                                for message in &messages {
                                    state.store.save_message(&resource, message)?;
                                }
                                // So does one that has just finished.
                                state.store.touch_resource(&resource.id)?;
                                state.store.save_session(&current)
                            });
                            if saved.is_err() { handoff = false; break; }
                            outcome_seen = true;
                            for message in messages {
                                self.publish(&mut state, &resource.id, EventPayload::MessageUpserted { message });
                            }
                            self.publish(&mut state, &resource.id, EventPayload::SessionUpdated { session: current });
                        }
                    }
                }
                result = &mut provider, if !provider_finished => {
                    provider_finished = true;
                    if let Err(error) = result {
                        failure = Some(error.message);
                        break;
                    }
                }
            }
        }
        // After an explicit interrupt the adapter still asks its provider to
        // stop. Its updates are no longer applied: the interrupted state and
        // transcript already saved must not be overwritten.
        if *cancelled.borrow() && !provider_finished {
            let _ = tokio::time::timeout(INTERRUPT_DRAIN, async {
                loop {
                    tokio::select! {
                        _ = &mut provider => break,
                        update = receiver.recv() => if update.is_none() { break },
                    }
                }
            })
            .await;
        }
        if let Ok(mut state) = self.lock() {
            if !outcome_seen
                && !*cancelled.borrow()
                && let Ok(mut current) = state.store.session(&session.id)
                && current.status == SessionStatus::Running
            {
                // The adapter ended without an outcome: a start failure or an
                // adapter error. Say so in the transcript, never silently.
                let text = failure
                    .unwrap_or_else(|| "The provider stopped without finishing this turn.".into());
                let mut blocks = last_blocks;
                for block in &mut blocks {
                    if let MessageBlock::Tool { status, .. } = block
                        && status == "running"
                    {
                        *status = "failed".into();
                    }
                }
                blocks.push(MessageBlock::Notice {
                    tone: "error".into(),
                    text,
                });
                let messages = reply.messages(&blocks, Some(&now()));
                current.status = SessionStatus::Failed;
                current.needs_input = false;
                let saved = state.store.transaction(|| {
                    for message in &messages {
                        state.store.save_message(&resource, message)?;
                    }
                    state.store.touch_resource(&resource.id)?;
                    state.store.save_session(&current)
                });
                if saved.is_ok() {
                    for message in messages {
                        self.publish(
                            &mut state,
                            &resource.id,
                            EventPayload::MessageUpserted { message },
                        );
                    }
                    self.publish(
                        &mut state,
                        &resource.id,
                        EventPayload::SessionUpdated { session: current },
                    );
                }
            }
            state.tasks.remove(&request_id);
        }
        // Stop pressed during the handoff marks the session interrupted, and
        // the queue then waits; otherwise the next follow-up starts now.
        if handoff && !*cancelled.borrow() {
            let runtime = Arc::clone(&self);
            let resource_id = resource.id.clone();
            // Starting a turn checks providers and folders, which may block.
            let _ = tokio::task::spawn_blocking(move || {
                runtime.dispatch_queue(&resource_id, true);
            })
            .await;
        }
    }

    /// Interrupts the running turn. This is not closing the conversation,
    /// cancelling queued input or ending the provider process: the adapter
    /// asks its provider to stop the current turn, and the session stays
    /// resumable. Queued follow-ups stay queued and wait for the reader.
    pub(crate) fn interrupt(&self, session_id: &str) -> Result<bool, JamError> {
        let mut state = self.lock()?;
        let mut session = state.store.session(session_id)?;
        if session.status != SessionStatus::Running {
            return Ok(false);
        }
        session.status = SessionStatus::Interrupted;
        session.needs_input = false;
        let interrupted_messages = state.store.transaction(|| {
            state.store.save_session(&session)?;
            state.store.touch_resource(&session.resource_id)?;
            state
                .store
                .interrupt_messages(&session.resource_id, InteractionStatus::Cancelled)
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

/// What a turn's supervisor needs besides the adapter and its channels.
struct Supervised {
    resource: Resource,
    session: Session,
    request_id: String,
    version: Option<String>,
    /// Counts messages steered into this turn.
    steered: Arc<AtomicU64>,
}

/// A turn's reply as transcript messages. An adapter reports the whole turn's
/// blocks each time; a message steered into the turn splits them, so the
/// reply continues in a new message below the steered one.
struct Reply {
    segments: Vec<Segment>,
}

struct Segment {
    id: String,
    created_at: String,
    /// The first of the turn's blocks this message holds.
    start: usize,
    /// When a later steer ended this part of the reply.
    completed_at: Option<String>,
    /// What was last saved, so unchanged parts are not saved again.
    saved: Option<Message>,
}

impl Segment {
    fn new(start: usize) -> Self {
        Self {
            id: new_id("message"),
            created_at: now(),
            start,
            completed_at: None,
            saved: None,
        }
    }
}

impl Reply {
    fn new() -> Self {
        Self {
            segments: vec![Segment::new(0)],
        }
    }

    /// Starts a new message at block `at`. Nothing before it is shown yet
    /// when the current message is still empty, so that one simply continues.
    fn split(&mut self, at: usize) {
        let last = self.segments.last_mut().expect("a reply has a message");
        if at <= last.start {
            return;
        }
        last.completed_at = Some(now());
        self.segments.push(Segment::new(at));
    }

    /// The messages whose content changed. `completed` ends the turn.
    fn messages(&mut self, blocks: &[MessageBlock], completed: Option<&str>) -> Vec<Message> {
        let starts: Vec<usize> = self.segments.iter().map(|s| s.start).collect();
        let mut changed = Vec::new();
        for (index, segment) in self.segments.iter_mut().enumerate() {
            let start = segment.start.min(blocks.len());
            let end = starts
                .get(index + 1)
                .copied()
                .unwrap_or(blocks.len())
                .clamp(start, blocks.len());
            let part = &blocks[start..end];
            if part.is_empty() {
                continue;
            }
            let message = Message {
                id: segment.id.clone(),
                role: "assistant".into(),
                created_at: segment.created_at.clone(),
                blocks: part.to_vec(),
                completed_at: segment
                    .completed_at
                    .clone()
                    .or_else(|| completed.map(str::to_owned)),
            };
            if segment.saved.as_ref() != Some(&message) {
                segment.saved = Some(message.clone());
                changed.push(message);
            }
        }
        changed
    }
}

/// Why a turn on this provider cannot be steered, or None when it can.
fn steer_refusal(descriptor: &ProviderDescriptor) -> Option<String> {
    let capability = descriptor.capabilities.get("steering");
    match capability.map(|c| c.status.as_str()) {
        Some("supported" | "conditional") => None,
        _ => Some(
            capability
                .and_then(|c| c.reason.clone())
                .unwrap_or_else(|| format!("{} cannot be steered from JAM.", descriptor.name)),
        ),
    }
}

/// The transcript message for what the reader sent.
pub(crate) fn user_message(text: &str, context: Vec<ContextItem>) -> Message {
    let mut blocks = Vec::new();
    if !context.is_empty() {
        blocks.push(MessageBlock::Context { items: context });
    }
    if !text.is_empty() {
        blocks.push(MessageBlock::Text { text: text.into() });
    }
    Message {
        id: new_id("message"),
        role: "user".into(),
        created_at: now(),
        blocks,
        completed_at: None,
    }
}

/// Commits a Send's snapshots and attachments to its conversation, inside the
/// caller's transaction. A queued follow-up's assets stop belonging to it.
pub(crate) fn commit_context(
    state: &State,
    context: &mut [ContextItem],
    resource_id: &str,
    queued: Option<&str>,
) -> Result<(), JamError> {
    state
        .store
        .attach_snapshots(context, resource_id, true, queued)?;
    state
        .store
        .send_attachments(context, resource_id, true, queued)?;
    if let Some(id) = queued {
        state.store.dequeue_sent(id)?;
    }
    Ok(())
}

fn waiting_for_reader(blocks: &[MessageBlock]) -> bool {
    blocks.iter().any(|block| {
        matches!(block, MessageBlock::Interaction { interaction }
            if interaction.status == InteractionStatus::Pending)
    })
}

/// The text a provider receives: the reader's words, then the context they
/// staged, each with its provenance, then where each attached file is.
/// Images also travel separately, to a provider that takes them.
pub(crate) fn compose(
    text: &str,
    context: &[ContextItem],
    files: &[AttachedFile],
    has_images: bool,
) -> String {
    let mut out = text.to_string();
    let mut notes = Vec::new();
    for item in context {
        match item.kind {
            ContextKind::Snapshot => {
                notes.push(format!("- Snapshot: {} (attached image)", item.label));
                continue;
            }
            // Listed below with the path of JAM's copy.
            ContextKind::Attachment => continue,
            _ => {}
        }
        let mut note = format!("- {}", item.label);
        if let Some(uri) = &item.source.uri {
            note.push_str(&format!(" ({uri})"));
        }
        if let Some(selection) = &item.source.selection {
            note.push_str(&format!("\n```\n{selection}\n```"));
        }
        notes.push(note);
    }
    let section = |out: &mut String, heading: &str, body: &str| {
        if !out.trim().is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(heading);
        out.push_str(body);
    };
    if !notes.is_empty() {
        section(&mut out, "Context attached in JAM:\n", &notes.join("\n"));
    }
    if !files.is_empty() {
        // Any agent can open a file by its path, whatever its provider's
        // protocol carries; the file is not pasted in, so it costs no context
        // until the agent reads what it needs.
        let lines: Vec<String> = files
            .iter()
            .map(|file| format!("- {}: {}", file.name, file.path.display()))
            .collect();
        section(
            &mut out,
            "Files attached in JAM (copies saved at these paths; open them as needed):\n",
            &lines.join("\n"),
        );
    }
    if out.trim().is_empty() && has_images {
        out = "See the attached image.".into();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str) -> MessageBlock {
        MessageBlock::Text { text: value.into() }
    }

    #[test]
    fn a_steer_continues_the_reply_in_a_new_message() {
        let mut reply = Reply::new();
        let first = reply.messages(&[text("a")], None);
        assert_eq!(first.len(), 1);
        // Unchanged blocks are not saved again.
        assert!(reply.messages(&[text("a")], None).is_empty());
        reply.split(1);
        let next = reply.messages(&[text("a"), text("b")], None);
        // The earlier part is re-saved once, now ended by the steer.
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].id, first[0].id);
        assert!(next[0].completed_at.is_some());
        assert_eq!(next[1].blocks, vec![text("b")]);
        assert_ne!(next[1].id, first[0].id);
        let done = reply.messages(&[text("a"), text("b")], Some("2026-10-04T00:00:00Z"));
        assert_eq!(done.len(), 1);
        assert_eq!(
            done[0].completed_at.as_deref(),
            Some("2026-10-04T00:00:00Z")
        );
    }

    #[test]
    fn a_steer_before_any_reply_keeps_one_message() {
        let mut reply = Reply::new();
        reply.split(0);
        let messages = reply.messages(&[text("a")], None);
        assert_eq!(messages.len(), 1);
        assert_eq!(reply.segments.len(), 1);
    }

    #[test]
    fn context_is_composed_with_provenance() {
        let item = ContextItem {
            id: "c1".into(),
            kind: ContextKind::Code,
            label: "src/a.rs:1-2".into(),
            source: ContextSource {
                resource_id: None,
                uri: Some("src/a.rs".into()),
                selection: Some("fn a() {}".into()),
            },
            asset_id: None,
            attachment: None,
        };
        let text = compose("Explain this", &[item], &[], false);
        assert!(
            text.starts_with("Explain this\n\nContext attached in JAM:\n- src/a.rs:1-2 (src/a.rs)")
        );
        assert!(text.contains("fn a() {}"));
        assert_eq!(compose("", &[], &[], true), "See the attached image.");
    }

    #[test]
    fn attached_files_are_listed_by_the_path_of_jams_copy() {
        let attached = |name: &str, kind| ContextItem {
            id: name.into(),
            kind: ContextKind::Attachment,
            label: name.into(),
            source: ContextSource {
                resource_id: None,
                uri: None,
                selection: None,
            },
            asset_id: Some(name.into()),
            attachment: Some(AttachmentInfo {
                name: name.into(),
                media_type: "x".into(),
                kind,
                bytes: 1,
            }),
        };
        let context = [
            attached("spec.pdf", AttachmentKind::File),
            attached("failure.png", AttachmentKind::Image),
        ];
        let file = |name: &str| AttachedFile {
            name: name.into(),
            media_type: "x".into(),
            path: std::path::PathBuf::from("copies").join(name),
        };
        let files = [file("spec.pdf"), file("failure.png")];
        let separator = std::path::MAIN_SEPARATOR;
        assert_eq!(
            compose("Why?", &context, &files, true),
            format!(
                "Why?\n\nFiles attached in JAM (copies saved at these paths; open them as needed):\n\
                 - spec.pdf: copies{separator}spec.pdf\n- failure.png: copies{separator}failure.png"
            )
        );
        // Files alone are a complete message, and nothing is pasted in.
        assert!(compose("", &context, &files, false).starts_with("Files attached in JAM"));
        // The demo provider is given no paths.
        assert_eq!(compose("Hi", &context, &[], false), "Hi");
    }
}
