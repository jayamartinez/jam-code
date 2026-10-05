use crate::{
    attachments::AttachedFile,
    commands::StartTurn,
    error::JamError,
    protocol::*,
    providers::{ImageInput, ProviderTurn, ProviderUpdate, TurnIo},
    runtime::{RunningTask, Runtime, new_id, now},
};
use serde_json::{Value, json};
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::sync::{mpsc, watch};

/// How long an interrupted adapter may take to stop its provider's turn
/// before JAM stops waiting. The session is already marked interrupted.
const INTERRUPT_DRAIN: Duration = Duration::from_secs(10);

impl Runtime {
    /// Starts a turn. With `compact`, the turn asks the provider to compact
    /// its context instead of sending a message: nothing is added to the
    /// transcript except what the provider reports.
    pub(crate) fn start_turn(
        self: &Arc<Self>,
        mut input: StartTurn,
        fingerprint: String,
        compact: bool,
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
        state
            .store
            .attach_snapshots(&mut input.context, &resource.id, false, None)?;
        let attachments =
            state
                .store
                .send_attachments(&mut input.context, &resource.id, false, None)?;
        // Images the reader explicitly sent, resolved only now, on Send.
        let mut images = Vec::new();
        let mut image_slots: Vec<(String, usize)> = Vec::new();
        if provider_id != "mock" {
            for item in &input.context {
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
            && let Some(descriptor) = &descriptor
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
            completed_at: None,
        };
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
        self.attachments.claim(&attachments)?;
        let mut files = Vec::new();
        if provider_id != "mock" {
            for attachment in &attachments {
                let path = match self.attachments.path(attachment) {
                    Ok(path) => path,
                    Err(error) => {
                        self.attachments.release(&attachments);
                        return Err(error);
                    }
                };
                if let Some((_, slot)) = image_slots.iter().find(|(id, _)| *id == attachment.id) {
                    images[*slot].path = Some(path.clone());
                }
                files.push(AttachedFile {
                    name: attachment.name.clone(),
                    media_type: attachment.media_type.clone(),
                    path,
                });
            }
        }
        let provider_text = compose(&input.text, &attached_context, &files, !images.is_empty());
        let saved = state.store.transaction(|| {
            state
                .store
                .attach_snapshots(&mut attached_context, &resource.id, true, None)?;
            // From here the attachments belong to this conversation's history.
            state
                .store
                .send_attachments(&mut attached_context, &resource.id, true, None)?;
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
            self.attachments.release(&attachments);
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
            images,
            files,
            attachment_dir: self.attachments.conversation_dir(&resource.id),
            options,
            config: settings.config(&provider_id),
            compact,
        };
        let version = descriptor.as_ref().and_then(|d| d.version.clone());
        let (cancel, cancelled) = watch::channel(false);
        let (finished_tx, finished) = watch::channel(());
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
        let handle = executor.spawn(async move {
            let _finished = finished_tx;
            let _ = tokio::time::timeout(INTERRUPT_DRAIN + Duration::from_secs(2), async {
                for mut previous in previous {
                    while previous.changed().await.is_ok() {}
                }
            })
            .await;
            runtime
                .run_turn(
                    resource, session, request_id, adapter, turn, version, cancelled,
                )
                .await;
        });
        state.tasks.insert(
            input.request_id,
            RunningTask {
                session_id: session_id.to_owned(),
                cancel,
                handle,
                finished,
            },
        );
        Ok(receipt)
    }

    #[allow(clippy::too_many_arguments)]
    async fn run_turn(
        self: Arc<Self>,
        resource: Resource,
        session: Session,
        request_id: String,
        adapter: Arc<dyn crate::providers::ProviderAdapter>,
        turn: ProviderTurn,
        version: Option<String>,
        mut cancelled: watch::Receiver<bool>,
    ) {
        let (sender, mut receiver) = mpsc::channel(64);
        // The provider future is owned by this supervisor, never by a view.
        let provider = adapter.run_turn(
            turn,
            TurnIo {
                updates: sender,
                cancelled: cancelled.clone(),
                interactions: self.interactions.clone(),
            },
        );
        tokio::pin!(provider);
        let mut provider_finished = false;
        let mut outcome_seen = false;
        let mut failure: Option<String> = None;
        let message_id = new_id("message");
        let created_at = now();
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
                    match update {
                        ProviderUpdate::Blocks(blocks) => {
                            last_blocks = blocks.clone();
                            let message = Message { id: message_id.clone(), role: "assistant".into(), created_at: created_at.clone(), blocks, completed_at: None };
                            let waiting = waiting_for_reader(&message.blocks);
                            let session_changed = waiting != current.needs_input;
                            current.needs_input = waiting;
                            let saved = state.store.transaction(|| {
                                state.store.save_message(&resource, &message)?;
                                // A chat that starts waiting for the reader rises in its lists.
                                if session_changed && waiting {
                                    state.store.touch_resource(&resource.id)?;
                                }
                                state.store.save_session(&current)
                            });
                            if saved.is_err() { break; }
                            self.publish(&mut state, &resource.id, EventPayload::MessageUpserted { message });
                            if session_changed {
                                self.publish(&mut state, &resource.id, EventPayload::SessionUpdated { session: current });
                            }
                        }
                        ProviderUpdate::Native(native_id) => {
                            let data = json!({"version": version, "origin": "jam"});
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
                            current.status = status;
                            current.needs_input = false;
                            // The reply records when its turn ended.
                            let message = (!last_blocks.is_empty()).then(|| Message {
                                id: message_id.clone(),
                                role: "assistant".into(),
                                created_at: created_at.clone(),
                                blocks: last_blocks.clone(),
                                completed_at: Some(now()),
                            });
                            let saved = state.store.transaction(|| {
                                if let Some(message) = &message {
                                    state.store.save_message(&resource, message)?;
                                }
                                // So does one that has just finished.
                                state.store.touch_resource(&resource.id)?;
                                state.store.save_session(&current)
                            });
                            if saved.is_err() { break; }
                            outcome_seen = true;
                            if let Some(message) = message {
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
                let message = Message {
                    id: message_id,
                    role: "assistant".into(),
                    created_at,
                    blocks,
                    completed_at: Some(now()),
                };
                current.status = SessionStatus::Failed;
                current.needs_input = false;
                let saved = state.store.transaction(|| {
                    state.store.save_message(&resource, &message)?;
                    state.store.touch_resource(&resource.id)?;
                    state.store.save_session(&current)
                });
                if saved.is_ok() {
                    self.publish(
                        &mut state,
                        &resource.id,
                        EventPayload::MessageUpserted { message },
                    );
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

    /// Interrupts the running turn. This is not closing the conversation,
    /// cancelling queued input or ending the provider process: the adapter
    /// asks its provider to stop the current turn, and the session stays
    /// resumable.
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

fn waiting_for_reader(blocks: &[MessageBlock]) -> bool {
    blocks.iter().any(|block| {
        matches!(block, MessageBlock::Interaction { interaction }
            if interaction.status == InteractionStatus::Pending)
    })
}

/// The text a provider receives: the reader's words, then the context they
/// staged, each with its provenance, then where each attached file is.
/// Images also travel separately, to a provider that takes them.
fn compose(
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
