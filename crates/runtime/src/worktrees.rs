//! Where project work happens: the project's first folder or a worktree JAM
//! recorded. Requests name a worktree by ID; only the runtime knows its path,
//! and it is verified on every use rather than trusted from the record.
use crate::{
    JamError,
    commands::validate_id,
    git::GitTarget,
    protocol::{Project, Worktree},
    runtime::Runtime,
};
use std::path::PathBuf;

impl Runtime {
    /// The recorded worktree, only when it belongs to `project`.
    pub(crate) fn worktree(&self, project: &Project, id: &str) -> Result<Worktree, JamError> {
        validate_id(id)?;
        let worktree = self.lock()?.store.worktree(id)?;
        if worktree.project_id != project.id {
            return Err(JamError::new("not_found", "Worktree not found."));
        }
        Ok(worktree)
    }

    /// The folder a request works in. A named worktree that has gone missing
    /// is an error, never a silent fall back to the project's folder.
    pub(crate) fn work_folder(
        &self,
        project: &Project,
        worktree_id: Option<&str>,
    ) -> Result<Option<PathBuf>, JamError> {
        match worktree_id {
            None => crate::native_files::project_folder(project),
            Some(id) => {
                let worktree = self.worktree(project, id)?;
                crate::git::verify(std::path::Path::new(&worktree.path)).map(Some)
            }
        }
    }

    pub(crate) fn git_target<'a>(
        &self,
        project: &'a Project,
        worktree_id: Option<&'a str>,
    ) -> Result<GitTarget<'a>, JamError> {
        Ok(GitTarget {
            project_id: &project.id,
            worktree_id,
            folder: self.work_folder(project, worktree_id)?,
        })
    }
}
