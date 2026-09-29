//! A new chat's first Send: where it works, then its records. Git changes
//! (a checkout switch or a new worktree) happen only here, on that explicit
//! Send, outside the database lock, and before anything is saved.
use crate::{
    JamError,
    commands::{CreateConversation, NewWorkspace, parse, validate_id, validate_provider},
    protocol::*,
    runtime::{Runtime, State, new_id, now},
};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;

impl Runtime {
    pub(crate) fn create_conversation(&self, params: Value) -> Result<Value, JamError> {
        let fingerprint = format!("conversation:{}", serde_json::to_string(&params)?);
        let input: CreateConversation = parse(params)?;
        input.validate()?;
        // A retried Send whose answer was lost returns the chat it created
        // rather than making a second worktree.
        if let Some(request_id) = &input.request_id {
            let state = self.lock()?;
            if let Some(receipt) = state.store.receipt(request_id, &fingerprint)? {
                let resource_id = receipt["resourceId"].as_str().unwrap_or_default();
                validate_id(resource_id)?;
                return self.created(&state, resource_id);
            }
        }
        // Options are checked against what the provider reports, so it is
        // asked first, before the database lock is taken.
        if let Some(provider) = input.provider_id.as_deref() {
            validate_provider(provider)?;
            if provider != "mock" {
                self.check_providers(false)?;
            }
        }
        let project = self.project(&input.project_id)?;
        let demo = input.provider_id.as_deref().is_none_or(|p| p == "mock");
        let worktree = match &input.workspace {
            None | Some(NewWorkspace::Checkout { branch: None }) => None,
            Some(_) if demo => {
                return Err(JamError::invalid(
                    "The demo provider never changes a repository. Start it in the current checkout.",
                ));
            }
            Some(NewWorkspace::Checkout {
                branch: Some(branch),
            }) => {
                self.switch_checkout(&project, branch)?;
                None
            }
            Some(NewWorkspace::Worktree {
                base_branch,
                name_hint,
            }) => {
                let target = self.git_target(&project, None)?;
                let created =
                    self.git
                        .create_worktree(&target, base_branch.as_deref(), name_hint)?;
                Some(Worktree {
                    id: new_id("worktree"),
                    project_id: project.id.clone(),
                    branch: created.branch,
                    base_branch: created.base,
                    path: created.path.to_string_lossy().into_owned(),
                    created_at: now(),
                })
            }
        };

        let mut state = self.lock()?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err(JamError::new("unavailable", "JAM is shutting down."));
        }
        let (provider_id, presentation, model, options) = self.session_choice(
            &state,
            input.provider_id.as_deref(),
            input.presentation,
            input.options,
        )?;
        let resource = Resource {
            id: new_id("conversation"),
            kind: "conversation".into(),
            title: "New conversation".into(),
            project_id: Some(input.project_id),
            session_id: Some(new_id("session")),
            path: None,
            pinned: false,
            updated_at: now(),
            closed_at: None,
            close_suggestion_dismissed_at: None,
            worktree_id: worktree.as_ref().map(|w| w.id.clone()),
        };
        let session = Session {
            id: resource.session_id.clone().expect("new session ID"),
            resource_id: resource.id.clone(),
            provider_id,
            presentation,
            status: SessionStatus::Idle,
            model,
            options,
            needs_input: false,
            usage: None,
        };
        let saved = state.store.transaction(|| {
            if let Some(worktree) = &worktree {
                state.store.save_worktree(worktree)?;
            }
            state.store.insert_conversation(&resource, &session)?;
            if let Some(request_id) = &input.request_id {
                state.store.save_receipt(
                    request_id,
                    &fingerprint,
                    &json!({ "resourceId": resource.id }),
                )?;
            }
            Ok(())
        });
        if let Err(error) = saved {
            // The worktree stays: JAM never deletes one, and the reader can
            // use or remove it with their own Git tools.
            return Err(match &worktree {
                Some(worktree) => JamError::new(
                    &error.code,
                    format!(
                        "{} The worktree {} ({}) was created and kept.",
                        error.message, worktree.branch, worktree.path
                    ),
                ),
                None => error,
            });
        }
        self.publish(
            &mut state,
            &resource.id,
            EventPayload::SessionUpdated {
                session: session.clone(),
            },
        );
        self.created(&state, &resource.id)
    }

    /// The chat as `conversation.create` answers it; `worktree` only when it
    /// has one, since optional fields are omitted rather than null.
    fn created(&self, state: &State, resource_id: &str) -> Result<Value, JamError> {
        let resource = state.store.resource(resource_id)?;
        let session = state
            .store
            .session(resource.session_id.as_deref().unwrap_or_default())?;
        let conversation = state.store.conversation(resource_id, self.cursor(state))?;
        let mut created = json!({
            "resource": resource,
            "session": session,
            "conversation": conversation,
        });
        if let Some(id) = &resource.worktree_id {
            created["worktree"] = serde_json::to_value(state.store.worktree(id)?)?;
        }
        Ok(created)
    }

    /// A checkout chat that asked for another branch switches the project's
    /// checkout on Send, but never while a chat is working in it.
    fn switch_checkout(&self, project: &Project, branch: &str) -> Result<(), JamError> {
        {
            let state = self.lock()?;
            let workspace = state.store.workspace(self.cursor(&state))?;
            let busy = workspace.sessions.iter().any(|session| {
                session.status == SessionStatus::Running
                    && workspace.resources.iter().any(|resource| {
                        resource.id == session.resource_id
                            && resource.project_id.as_deref() == Some(project.id.as_str())
                            && resource.worktree_id.is_none()
                    })
            });
            if busy {
                return Err(JamError::new(
                    "conflict",
                    format!(
                        "A chat is working in this checkout. Switch to {branch} after it finishes, or start this chat in a new worktree."
                    ),
                ));
            }
        }
        let target = self.git_target(project, None)?;
        self.git.switch_branch(&target, branch).map(|_| ())
    }
}
