//! Changing where a started chat works: another branch, another worktree, the
//! project's checkout or a new worktree. It applies from the chat's next turn,
//! never to one that is running, and the agent resumes the same session in
//! the new folder. Like a new chat's choice, Git changes happen here, on an
//! explicit request, outside the database lock.
use crate::{
    JamError,
    commands::{MoveConversation, MoveWorkspace, parse},
    git::BranchPlace,
    protocol::*,
    runtime::{Runtime, new_id, now},
};
use serde_json::{Value, json};

/// What becomes of the worktree record a chat points at.
enum Record {
    /// A worktree JAM has not recorded yet.
    New(Worktree),
    /// One whose branch was switched.
    Changed(Worktree),
    Known(Worktree),
}

impl Runtime {
    pub(crate) fn move_conversation(&self, params: Value) -> Result<Value, JamError> {
        let input: MoveConversation = parse(params)?;
        input.validate()?;
        let (mut resource, current) = {
            let state = self.lock()?;
            let resource = state.store.resource(&input.resource_id)?;
            let session = match (&*resource.kind, &resource.session_id) {
                ("conversation", Some(id)) => state.store.session(id)?,
                _ => return Err(JamError::invalid("Only a chat works in a folder.")),
            };
            if session.provider_id == "mock" {
                return Err(JamError::invalid(
                    "The demo provider never changes a repository.",
                ));
            }
            // A turn works in the folder it started in.
            if session.status == SessionStatus::Running || session.needs_input {
                return Err(JamError::new(
                    "conflict",
                    "Wait for the agent to finish, or stop it, before changing where this chat works.",
                ));
            }
            let current = match &resource.worktree_id {
                Some(id) => Some(state.store.worktree(id)?),
                None => None,
            };
            (resource, current)
        };
        let project = self.project(resource.project_id.as_deref().unwrap_or_default())?;
        let here = self.git_target(&project, resource.worktree_id.as_deref())?;

        // `None` is the project's checkout.
        let next: Option<Record> = match &input.workspace {
            MoveWorkspace::Checkout {} => None,
            MoveWorkspace::Worktree {
                base_branch,
                name_hint,
            } => {
                let base = match base_branch {
                    Some(base) => Some(base.clone()),
                    None => self.git.branches(&here)?.current,
                };
                let checkout = self.git_target(&project, None)?;
                let created = self
                    .git
                    .create_worktree(&checkout, base.as_deref(), name_hint)?;
                Some(Record::New(Worktree {
                    id: new_id("worktree"),
                    project_id: project.id.clone(),
                    branch: created.branch,
                    base_branch: created.base,
                    path: created.path.to_string_lossy().into_owned(),
                    created_at: now(),
                }))
            }
            MoveWorkspace::Branch { branch } => match self.git.place_of(&here, branch)? {
                BranchPlace::Here => current.map(Record::Known),
                BranchPlace::Free => {
                    self.git.switch_branch(&here, branch)?;
                    current.map(|worktree| {
                        Record::Changed(Worktree {
                            branch: branch.clone(),
                            ..worktree
                        })
                    })
                }
                BranchPlace::Elsewhere(folder) => {
                    let checkout = self.git_target(&project, None)?;
                    if self.git.root(&checkout)? == folder {
                        None
                    } else {
                        let (worktree, known) = self.worktree_at(&project, branch, folder)?;
                        Some(if known {
                            Record::Known(worktree)
                        } else {
                            Record::New(worktree)
                        })
                    }
                }
            },
        };

        let worktree = match &next {
            Some(Record::New(w) | Record::Changed(w) | Record::Known(w)) => Some(w.clone()),
            None => None,
        };
        resource.worktree_id = worktree.as_ref().map(|w| w.id.clone());
        let state = self.lock()?;
        state.store.transaction(|| {
            match &next {
                Some(Record::New(worktree)) => state.store.save_worktree(worktree)?,
                Some(Record::Changed(worktree)) => state.store.update_worktree(worktree)?,
                Some(Record::Known(_)) | None => {}
            }
            state.store.save_resource(&resource)
        })?;
        let mut moved = json!({ "resource": resource });
        if let Some(worktree) = worktree {
            moved["worktree"] = serde_json::to_value(worktree)?;
        }
        Ok(moved)
    }
}
