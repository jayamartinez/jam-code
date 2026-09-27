//! Runtime-owned Git CLI access. No idle processes, polling, or provider coupling.
mod model;
mod parse;
mod process;
mod requests;
use crate::{
    JamError,
    native_files::{project_folder, validate_path},
    protocol::Project,
};
pub use model::*;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

const STATUS_BYTES: usize = 4 * 1024 * 1024;
const DIFF_BYTES: usize = 512 * 1024;

/// Serializes JAM's Git operations, without holding the runtime/database lock.
/// Git's own index lock still arbitrates with other clients.
#[derive(Default)]
pub struct GitManager {
    gate: Mutex<()>,
}

impl GitManager {
    pub fn status(&self, project: &Project) -> Result<GitStatus, JamError> {
        let _guard = self
            .gate
            .lock()
            .map_err(|_| JamError::new("internal", "Git service unavailable."))?;
        self.status_inner(project)
    }
    fn status_inner(&self, project: &Project) -> Result<GitStatus, JamError> {
        let Some(folder) = project_folder(project)? else {
            return Ok(GitStatus::empty(&project.id, "no-folder"));
        };
        let detected = process::run(&folder, &["rev-parse", "--show-toplevel"], 16_384)?;
        if detected.truncated {
            return Err(JamError::new(
                "git_limit",
                "Repository root exceeds the path limit.",
            ));
        }
        if !detected.success {
            return Ok(GitStatus::empty(&project.id, "not-repository"));
        }
        let root = std::str::from_utf8(&detected.bytes)
            .map_err(|_| JamError::new("unavailable", "Repository root is not UTF-8."))?;
        let root = root.strip_suffix('\n').unwrap_or(root);
        let root = PathBuf::from(root)
            .canonicalize()
            .map_err(|_| JamError::new("not_found", "Repository root is unavailable."))?;
        let mut status = GitStatus::empty(&project.id, "repository");
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
        validate_path(path)?;
        let _guard = self
            .gate
            .lock()
            .map_err(|_| JamError::new("internal", "Git service unavailable."))?;
        let status = self.status_inner(project)?;
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
            project_id: project.id.clone(),
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
        validate_path(path)?;
        let _guard = self
            .gate
            .lock()
            .map_err(|_| JamError::new("internal", "Git service unavailable."))?;
        let status = self.status_inner(project)?;
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
        self.status_inner(project)
    }
}
