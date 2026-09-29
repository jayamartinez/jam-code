//! Runtime-owned Git CLI access. No idle processes, polling, or provider coupling.
mod branches;
mod model;
mod parse;
mod process;
mod requests;
use crate::{
    JamError,
    native_files::{project_folder, validate_path},
    protocol::Project,
};
pub use branches::{BRANCH_PREFIX, BranchList, NewWorktree, slug, validate_branch_name, verify};
pub use model::*;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

const STATUS_BYTES: usize = 4 * 1024 * 1024;
const DIFF_BYTES: usize = 512 * 1024;

/// The folder a Git request works in: the project's first folder, or a
/// worktree the runtime created and has already verified.
pub struct GitTarget<'a> {
    pub project_id: &'a str,
    pub worktree_id: Option<&'a str>,
    pub folder: Option<PathBuf>,
}
impl<'a> GitTarget<'a> {
    pub fn project(project: &'a Project) -> Result<Self, JamError> {
        Ok(Self {
            project_id: &project.id,
            worktree_id: None,
            folder: project_folder(project)?,
        })
    }
}

/// Serializes JAM's Git operations, without holding the runtime/database lock.
/// Git's own index lock still arbitrates with other clients.
#[derive(Default)]
pub struct GitManager {
    gate: Mutex<()>,
}

impl GitManager {
    fn gate(&self) -> Result<std::sync::MutexGuard<'_, ()>, JamError> {
        self.gate
            .lock()
            .map_err(|_| JamError::new("internal", "Git service unavailable."))
    }
    pub fn status(&self, project: &Project) -> Result<GitStatus, JamError> {
        self.status_at(&GitTarget::project(project)?)
    }
    pub fn status_at(&self, target: &GitTarget) -> Result<GitStatus, JamError> {
        let _guard = self.gate()?;
        self.status_inner(target)
    }
    fn status_inner(&self, target: &GitTarget) -> Result<GitStatus, JamError> {
        let Some(folder) = target.folder.clone() else {
            return Ok(GitStatus::empty(target, "no-folder"));
        };
        let Some(root) = branches::toplevel(&folder)? else {
            return Ok(GitStatus::empty(target, "not-repository"));
        };
        let mut status = GitStatus::empty(target, "repository");
        status.repository_root = Some(root.to_string_lossy().into_owned());
        let result = process::checked(
            &root,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=all",
                "--ignore-submodules=none",
            ],
            STATUS_BYTES,
        )?;
        if result.truncated {
            return Err(JamError::new(
                "git_limit",
                "Git status exceeds 4 MiB. Narrow the repository or reduce untracked files.",
            ));
        }
        parse::status(&result.bytes, &mut status)?;
        for file in &mut status.files {
            file.file_path = root
                .join(&file.path)
                .strip_prefix(&folder)
                .ok()
                .and_then(|p| p.to_str())
                .map(|p| p.replace(std::path::MAIN_SEPARATOR, "/"))
                .filter(|p| validate_path(p).is_ok());
        }
        Ok(status)
    }
    pub fn diff(
        &self,
        project: &Project,
        path: &str,
        side: DiffSide,
    ) -> Result<FileDiff, JamError> {
        self.diff_at(&GitTarget::project(project)?, path, side)
    }
    pub fn diff_at(
        &self,
        target: &GitTarget,
        path: &str,
        side: DiffSide,
    ) -> Result<FileDiff, JamError> {
        validate_path(path)?;
        let _guard = self.gate()?;
        let status = self.status_inner(target)?;
        let file = status
            .files
            .iter()
            .find(|f| f.path == path)
            .cloned()
            .ok_or_else(|| {
                JamError::new(
                    "not_found",
                    "This change is no longer in Git status. Refresh the review.",
                )
            })?;
        let root = Path::new(
            status
                .repository_root
                .as_deref()
                .expect("file implies repository"),
        );
        let mut diff = FileDiff {
            project_id: target.project_id.into(),
            path: path.into(),
            side,
            file: file.clone(),
            binary: false,
            truncated: false,
            additions: 0,
            deletions: 0,
            hunks: vec![],
            metadata: vec![],
        };
        if file.conflict || file.submodule {
            diff.metadata.push(if file.conflict { "Resolve this merge conflict with your Git tools before staging." } else { "Submodule changes are summarized here; review them in the submodule repository." }.into());
            return Ok(diff);
        }
        if file.untracked {
            if side == DiffSide::Staged {
                return Ok(diff);
            }
            let target = root.join(path);
            let meta = std::fs::symlink_metadata(&target)
                .map_err(|_| JamError::new("not_found", "File no longer exists."))?;
            if !meta.is_file() || meta.file_type().is_symlink() {
                diff.metadata
                    .push("Untracked symlinks and special files have no text preview.".into());
                return Ok(diff);
            }
            // A bounded scoped reader never follows an escape into another folder.
            let bytes = crate::native_files::read_scoped_bytes(root, path, DIFF_BYTES)?;
            diff.truncated = bytes.len() > DIFF_BYTES;
            let bytes = &bytes[..bytes.len().min(DIFF_BYTES)];
            if bytes.contains(&0) {
                diff.binary = true;
                return Ok(diff);
            }
            let text = match std::str::from_utf8(bytes) {
                Ok(text) => text,
                Err(error) if diff.truncated && error.error_len().is_none() => {
                    std::str::from_utf8(&bytes[..error.valid_up_to()]).expect("valid UTF-8 prefix")
                }
                Err(_) => {
                    diff.binary = true;
                    return Ok(diff);
                }
            };
            if text.is_empty() {
                diff.metadata.push("Empty untracked file.".into());
            }
            let lines: Vec<_> = text
                .split_terminator('\n')
                .take(5000)
                .enumerate()
                .map(|(i, text)| DiffLine {
                    kind: "addition".into(),
                    text: text.into(),
                    old_line: None,
                    new_line: Some(i as u32 + 1),
                })
                .collect();
            diff.truncated |= text.split_terminator('\n').count() > 5000;
            diff.additions = lines.len() as u32;
            if !lines.is_empty() {
                diff.hunks.push(DiffHunk {
                    header: format!("@@ -0,0 +1,{} @@", lines.len()),
                    old_start: 0,
                    old_lines: 0,
                    new_start: 1,
                    new_lines: lines.len() as u32,
                    lines,
                });
            }
            return Ok(diff);
        }
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--no-relative",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            "--unified=3",
            "--find-renames",
            "--ignore-submodules=all",
        ];
        // Compare the two blobs for an indexed rename. Including both pathspecs
        // would also include an unrelated new file recreated at the old path.
        let old_blob;
        let new_blob;
        if side == DiffSide::Staged && file.staged == Change::Renamed {
            let previous = file
                .previous_path
                .as_deref()
                .ok_or_else(|| JamError::new("git_failed", "Rename source unavailable."))?;
            old_blob = format!("HEAD:{previous}");
            new_blob = format!(":{path}");
            args.extend([old_blob.as_str(), new_blob.as_str(), "--"]);
            diff.metadata.push(format!("rename from {previous}"));
            diff.metadata.push(format!("rename to {path}"));
        } else {
            if side == DiffSide::Staged {
                args.push("--cached");
            }
            args.extend(["--", path]);
        }
        let result = process::checked(root, &args, DIFF_BYTES)?;
        diff.truncated = result.truncated;
        // An incomplete final output line is never represented as a complete diff line.
        let bytes = if result.truncated {
            &result.bytes[..result.bytes.iter().rposition(|b| *b == b'\n').unwrap_or(0)]
        } else {
            &result.bytes
        };
        parse::patch(bytes, &mut diff);
        Ok(diff)
    }
    pub fn set_staged(
        &self,
        project: &Project,
        path: &str,
        staged: bool,
    ) -> Result<GitStatus, JamError> {
        self.set_staged_at(&GitTarget::project(project)?, path, staged)
    }
    pub fn set_staged_at(
        &self,
        target: &GitTarget,
        path: &str,
        staged: bool,
    ) -> Result<GitStatus, JamError> {
        validate_path(path)?;
        let _guard = self.gate()?;
        let status = self.status_inner(target)?;
        let file = status
            .files
            .iter()
            .find(|f| f.path == path)
            .ok_or_else(|| {
                JamError::new("not_found", "Change no longer exists. Refresh the review.")
            })?;
        if file.conflict || file.submodule {
            return Err(JamError::new(
                "unavailable",
                "Use your Git tools to stage conflicts or submodules.",
            ));
        }
        let root = Path::new(
            status
                .repository_root
                .as_deref()
                .expect("file implies repository"),
        );
        let mut args = if staged {
            vec!["add", "--"]
        } else if status.unborn {
            vec!["rm", "--cached", "--force", "--"]
        } else {
            vec!["reset", "--quiet", "HEAD", "--"]
        };
        args.push(path);
        if (!staged || file.working_tree == Change::Renamed)
            && let Some(previous) = &file.previous_path
        {
            validate_path(previous)?;
            args.push(previous);
        }
        let output = process::checked(root, &args, 16_384)?;
        if output.truncated {
            return Err(JamError::new(
                "git_limit",
                "Git mutation output exceeded its limit. Refresh before retrying.",
            ));
        }
        self.status_inner(target)
    }

    /// Local and remote-tracking branches of the target's checkout.
    pub fn branches(&self, target: &GitTarget) -> Result<BranchList, JamError> {
        let _guard = self.gate()?;
        let empty = |state: &str| BranchList {
            project_id: target.project_id.into(),
            worktree_id: target.worktree_id.map(Into::into),
            state: state.into(),
            current: None,
            detached: false,
            changed: 0,
            busy: false,
            branches: Vec::new(),
            truncated: false,
        };
        let Some(folder) = &target.folder else {
            return Ok(empty("no-folder"));
        };
        match branches::toplevel(folder)? {
            Some(root) => branches::list(target, &root),
            None => Ok(empty("not-repository")),
        }
    }
    /// Switches the target checkout's branch only when no work can be lost.
    pub fn switch_branch(&self, target: &GitTarget, branch: &str) -> Result<BranchList, JamError> {
        let _guard = self.gate()?;
        let (root, list) = self.repository(target)?;
        branches::switch(&root, &list, branch)?;
        branches::list(target, &root)
    }
    /// A new branch and worktree from `base`, or from the checkout's current
    /// branch, named from `hint`.
    pub fn create_worktree(
        &self,
        target: &GitTarget,
        base: Option<&str>,
        hint: &str,
    ) -> Result<NewWorktree, JamError> {
        let _guard = self.gate()?;
        let (root, list) = self.repository(target)?;
        let base = match base {
            Some(base) => base.to_owned(),
            None => list.current.clone().ok_or_else(|| {
                JamError::new(
                    "unavailable",
                    "This checkout is not on a branch. Choose a branch to start the worktree from.",
                )
            })?,
        };
        branches::create(&root, &list, &base, hint)
    }
    fn repository(&self, target: &GitTarget) -> Result<(PathBuf, BranchList), JamError> {
        let root = target
            .folder
            .as_deref()
            .map(branches::toplevel)
            .transpose()?
            .flatten()
            .ok_or_else(|| {
                JamError::new(
                    "unavailable",
                    "This project's folder is not a Git repository.",
                )
            })?;
        let list = branches::list(target, &root)?;
        Ok((root, list))
    }
}
