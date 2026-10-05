//! Linking provider history to the projects JAM already trusts. A folder a
//! provider reports is compared as text with project and worktree folders;
//! it never grants access, and the filesystem is never consulted for it.
use super::{PATH_LIMIT, store::Entry};
use crate::{
    commands::validate_id, error::JamError, protocol::Cursor, runtime::Runtime, storage::Store,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AssociateHistory {
    history_id: String,
    project_id: String,
}

impl Runtime {
    /// Links an entry that has no projection yet to a project the reader
    /// chose. Only a project JAM already has can be chosen, so this never
    /// grants access to a folder; later scans keep the choice.
    pub(super) fn associate_history(&self, input: AssociateHistory) -> Result<Value, JamError> {
        validate_id(&input.history_id)?;
        let project = self.project(&input.project_id)?;
        let state = self.lock()?;
        let mut entry = state.store.history_entry(&input.history_id)?;
        if entry.session_id.is_some() {
            return Err(JamError::new(
                "conflict",
                "This conversation is already in JAM Code and keeps its project.",
            ));
        }
        entry.project_id = Some(project.id);
        entry.worktree_id = None;
        entry.project_source = Some("reader".into());
        state.store.save_history(&entry)?;
        Ok(json!({ "entry": state.store.history_wire(&entry)? }))
    }
}

/// The folders JAM already trusts: active projects' folders and the
/// worktrees recorded for them. A reported folder is compared as text, and
/// the filesystem is never consulted for it.
pub(super) struct Folders {
    /// `(folder, project, worktree)`.
    known: Vec<(String, String, Option<String>)>,
}

impl Folders {
    pub(super) fn of(store: &Store) -> Result<Self, JamError> {
        let workspace = store.workspace(Cursor::default())?;
        let mut known = Vec::new();
        for project in &workspace.projects {
            for path in &project.paths {
                if let Some(folder) = folder_key(path) {
                    known.push((folder, project.id.clone(), None));
                }
            }
        }
        for worktree in &workspace.worktrees {
            if let Some(folder) = folder_key(&worktree.path) {
                known.push((
                    folder,
                    worktree.project_id.clone(),
                    Some(worktree.id.clone()),
                ));
            }
        }
        Ok(Self { known })
    }

    /// The project (and worktree) whose folder is exactly `cwd`. A folder
    /// inside a project is not matched: an agent resumes in the folder it
    /// worked in, and JAM would run it in the project's.
    fn match_folder(&self, cwd: Option<&str>) -> Option<(String, Option<String>)> {
        let folder = folder_key(cwd?)?;
        // A worktree is more specific than a project folder with the same path.
        self.known
            .iter()
            .filter(|(known, ..)| *known == folder)
            .max_by_key(|(_, _, worktree)| worktree.is_some())
            .map(|(_, project, worktree)| (project.clone(), worktree.clone()))
    }
}

/// An absolute folder path in a form two spellings of it share: separators
/// and trailing separators normalized and, where volumes are
/// case-insensitive by default, lowercased. A relative path or one that
/// climbs (`..`) matches nothing.
fn folder_key(path: &str) -> Option<String> {
    if path.is_empty() || path.chars().count() > PATH_LIMIT || path.contains('\0') {
        return None;
    }
    let path = Path::new(path);
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return None;
    }
    let normalized: PathBuf = path.components().collect();
    let text = normalized.to_string_lossy().into_owned();
    Some(if cfg!(any(windows, target_os = "macos")) {
        text.to_lowercase()
    } else {
        text
    })
}

/// Links an entry that has no conversation yet to the project or worktree
/// whose folder it reports, unless the reader chose a project for it.
pub(super) fn associate(entry: &mut Entry, folders: &Folders) {
    if entry.session_id.is_none() && entry.project_source.as_deref() != Some("reader") {
        let (project_id, worktree_id) = folders.match_folder(entry.cwd.as_deref()).unzip();
        entry.project_id = project_id;
        entry.worktree_id = worktree_id.flatten();
        entry.project_source = entry.project_id.as_ref().map(|_| "folder".into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_match_by_spelling_never_by_climbing() {
        let root = if cfg!(windows) {
            r"C:\work\jam"
        } else {
            "/work/jam"
        };
        let key = folder_key(root).unwrap();
        let trailing = format!("{root}{}", std::path::MAIN_SEPARATOR);
        assert_eq!(folder_key(&trailing).as_deref(), Some(key.as_str()));
        assert_eq!(folder_key("relative/jam"), None);
        let climbing = format!("{root}{0}..{0}jam", std::path::MAIN_SEPARATOR);
        assert_eq!(folder_key(&climbing), None);
        assert_eq!(folder_key(""), None);
        if cfg!(windows) {
            assert_eq!(folder_key("c:/WORK/jam").as_deref(), Some(key.as_str()));
        }
    }
}
