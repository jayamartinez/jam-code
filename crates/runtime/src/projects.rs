//! Adding, removing and describing projects.
//!
//! A project is a folder the person chose, usually through the native folder
//! picker. JAM keeps a reference to it and never creates, moves or deletes
//! anything inside it. Git is optional: a plain folder is a project too.

use crate::{
    commands::{initials_of, validate_id},
    demo_cleanup::folder_name,
    error::JamError,
    protocol::{Project, SessionStatus},
    runtime::{Runtime, State, new_id, now},
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateProject {
    /// Absolute folder paths, normally from the folder picker. The first is
    /// the project's primary folder, where agents, Review and files work.
    pub paths: Vec<String>,
    /// Defaults to the primary folder's name.
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub icon: Option<crate::protocol::ProjectIcon>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoveProject {
    pub project_id: String,
}

/// The outcome of adding a folder: the project, and whether it was already
/// known (added before, or removed and now restored with its history).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectAdded {
    pub project: Project,
    pub existing: bool,
}

impl Runtime {
    pub(crate) fn create_project(&self, input: CreateProject) -> Result<ProjectAdded, JamError> {
        crate::commands::UpdateProject {
            project_id: "project-new".into(),
            name: input.name.clone(),
            paths: None,
            icon: input.icon.clone(),
            pinned: None,
        }
        .validate()?;
        let Some((primary, others)) = input.paths.split_first() else {
            return Err(JamError::invalid("Choose a folder to add."));
        };
        if input.paths.len() > 16 {
            return Err(JamError::invalid("A project can list at most 16 folders."));
        }
        let folder = chosen_folder(primary)?;
        let display = folder.to_string_lossy().into_owned();
        let mut paths = vec![display.clone()];
        for other in others {
            let other = chosen_folder(other)?.to_string_lossy().into_owned();
            if !paths.contains(&other) {
                paths.push(other);
            }
        }
        let state = self.lock()?;
        let known = state.store.all_projects()?.into_iter().find(|project| {
            project
                .paths
                .first()
                .is_some_and(|path| same_folder(Path::new(path), &folder))
        });
        if let Some(mut project) = known {
            if project.removed_at.take().is_some() {
                state.store.save_project(&project)?;
            }
            return Ok(ProjectAdded {
                project: describe(project),
                existing: true,
            });
        }
        refuse_taken_folders(&state.store.all_projects()?, None, &paths)?;
        let name = input
            .name
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty())
            .or_else(|| folder_name(&display))
            .unwrap_or_else(|| display.clone());
        // Plain initials in the default tone is the absence of an icon.
        let icon = input
            .icon
            .filter(|icon| !(icon.kind == "initials" && icon.tone.is_none()));
        let project = Project {
            id: new_id("project"),
            initials: initials_of(&name),
            name,
            branch: String::new(),
            icon,
            paths,
            pinned: false,
            removed_at: None,
            folder_missing: false,
        };
        state.store.insert_project(&project)?;
        Ok(ProjectAdded {
            project: describe(project),
            existing: false,
        })
    }

    /// Removes JAM's reference to a project. Its folder, conversations and
    /// worktrees are untouched; adding the folder again restores them.
    pub(crate) fn remove_project(&self, input: RemoveProject) -> Result<(), JamError> {
        validate_id(&input.project_id)?;
        let running_shells = self
            .terminals
            .list(Some(&input.project_id))?
            .iter()
            .any(|terminal| terminal.status == crate::terminal::TerminalStatus::Running);
        let state = self.lock()?;
        let mut project = state
            .store
            .all_projects()?
            .into_iter()
            .find(|project| project.id == input.project_id && project.removed_at.is_none())
            .ok_or_else(|| JamError::new("not_found", "Project not found."))?;
        if running_shells || self.has_running_chat(&state, &project.id)? {
            return Err(JamError::new(
                "conflict",
                "Stop this project's running chats and terminals before removing it.",
            ));
        }
        project.removed_at = Some(now());
        state.store.save_project(&project)?;
        Ok(())
    }

    fn has_running_chat(&self, state: &State, project_id: &str) -> Result<bool, JamError> {
        let workspace = state.store.workspace(self.cursor(state))?;
        Ok(workspace.sessions.iter().any(|session| {
            (session.status == SessionStatus::Running
                || state
                    .tasks
                    .values()
                    .any(|task| task.session_id == session.id))
                && workspace.resources.iter().any(|resource| {
                    resource.id == session.resource_id
                        && resource.project_id.as_deref() == Some(project_id)
                })
        }))
    }
}

/// A project as the interface shows it: its live branch, and whether its
/// folder is still there. Reads two small files at most; no Git process.
pub(crate) fn describe(mut project: Project) -> Project {
    match project.paths.first() {
        Some(path) => match crate::native_files::canonical(Path::new(path)) {
            Ok(folder) if folder.is_dir() => {
                project.folder_missing = false;
                project.branch = current_branch(&folder).unwrap_or_default();
            }
            _ => {
                project.folder_missing = true;
                project.branch = String::new();
            }
        },
        None => project.folder_missing = false,
    }
    project
}

/// The folder a person chose, checked and made canonical.
fn chosen_folder(path: &str) -> Result<PathBuf, JamError> {
    let path = path.trim();
    if path.is_empty() || path.encode_utf16().count() > 1024 || path.contains('\0') {
        return Err(JamError::invalid("Choose a folder to add."));
    }
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(JamError::invalid(
            "A project folder must be an absolute path.",
        ));
    }
    let folder = crate::native_files::canonical(path)
        .map_err(|_| JamError::new("not_found", "That folder doesn't exist anymore."))?;
    if !folder.is_dir() {
        return Err(JamError::invalid("Choose a folder, not a file."));
    }
    std::fs::read_dir(&folder).map_err(|_| {
        JamError::new(
            "unavailable",
            "JAM Code can't read that folder. Check its permissions and try again.",
        )
    })?;
    Ok(folder)
}

/// A folder belongs to one project: refuses `paths` when another project
/// that is still in JAM (not `except`) lists one of them.
pub(crate) fn refuse_taken_folders(
    projects: &[Project],
    except: Option<&str>,
    paths: &[String],
) -> Result<(), JamError> {
    for path in paths {
        // However it is written: a trailing separator or other case is the same folder.
        let folder =
            crate::native_files::canonical(Path::new(path)).unwrap_or_else(|_| PathBuf::from(path));
        let folder = folder.as_path();
        let owner = projects.iter().find(|project| {
            project.removed_at.is_none()
                && Some(project.id.as_str()) != except
                && project
                    .paths
                    .iter()
                    .any(|stored| same_folder(Path::new(stored), folder))
        });
        if let Some(owner) = owner {
            let name = folder_name(path).unwrap_or_else(|| path.clone());
            return Err(JamError::new(
                "conflict",
                format!("“{name}” is already in {}.", owner.name),
            ));
        }
    }
    Ok(())
}

fn same_folder(stored: &Path, folder: &Path) -> bool {
    let stored = crate::native_files::canonical(stored).unwrap_or_else(|_| stored.to_path_buf());
    // Windows and macOS volumes are case-insensitive by default.
    if cfg!(any(windows, target_os = "macos")) {
        stored.to_string_lossy().to_lowercase() == folder.to_string_lossy().to_lowercase()
    } else {
        stored == folder
    }
}

/// The checked-out branch of the repository containing `folder`, read from
/// `HEAD`. A detached checkout reads as its short commit; a plain folder has
/// no branch.
pub(crate) fn current_branch(folder: &Path) -> Option<String> {
    let mut dir = Some(folder);
    // A project may be a folder inside a repository.
    for _ in 0..32 {
        let current = dir?;
        let dot_git = current.join(".git");
        let git_dir = if dot_git.is_dir() {
            Some(dot_git)
        } else if dot_git.is_file() {
            // A worktree or submodule: `gitdir: <path>`.
            std::fs::read_to_string(&dot_git).ok().and_then(|text| {
                let target = text.trim().strip_prefix("gitdir:")?.trim().to_string();
                Some(current.join(target))
            })
        } else {
            None
        };
        if let Some(git_dir) = git_dir {
            let head = std::fs::read_to_string(git_dir.join("HEAD")).ok()?;
            let head = head.trim();
            return Some(match head.strip_prefix("ref: refs/heads/") {
                Some(branch) => branch.to_string(),
                None => head.chars().take(7).collect(),
            });
        }
        dir = current.parent();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::current_branch;

    #[test]
    fn branch_comes_from_head_in_the_folder_or_above() {
        let root = std::env::temp_dir().join(format!("jam-branch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("src/inner")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref: refs/heads/feat/x\n").unwrap();
        assert_eq!(current_branch(&root).as_deref(), Some("feat/x"));
        assert_eq!(
            current_branch(&root.join("src/inner")).as_deref(),
            Some("feat/x")
        );
        std::fs::write(root.join(".git/HEAD"), "0123456789abcdef\n").unwrap();
        assert_eq!(current_branch(&root).as_deref(), Some("0123456"));
        let worktree = root.join("wt");
        std::fs::create_dir_all(root.join(".git/worktrees/wt")).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(
            root.join(".git/worktrees/wt/HEAD"),
            "ref: refs/heads/jam/wt\n",
        )
        .unwrap();
        std::fs::write(worktree.join(".git"), "gitdir: ../.git/worktrees/wt\n").unwrap();
        assert_eq!(current_branch(&worktree).as_deref(), Some("jam/wt"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
