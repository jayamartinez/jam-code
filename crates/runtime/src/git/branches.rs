//! Branches and worktrees: listing, a checkout switch that never discards
//! work, and new worktrees. Nothing here deletes or resets a branch or folder.
use super::{GitTarget, process};
use crate::JamError;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const LIST_BYTES: usize = 1024 * 1024;
const MAX_BRANCHES: usize = 500;
/// A new worktree writes a full checkout, which can take longer than a read.
const CHECKOUT_DEADLINE: Duration = Duration::from_secs(120);
/// New worktree branches are `jam/<name>`; editing the prefix is planned.
pub const BRANCH_PREFIX: &str = "jam/";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// Short name: `main`, or `origin/main` for a remote-tracking branch.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    /// The folder of another worktree that has this branch checked out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchList {
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    /// `repository`, `not-repository` or `no-folder`.
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    pub detached: bool,
    /// Tracked files with staged or unstaged changes in this checkout.
    pub changed: u32,
    /// A merge, rebase, cherry-pick, revert or bisect is under way.
    pub busy: bool,
    pub branches: Vec<Branch>,
    pub truncated: bool,
}

/// The repository a target folder belongs to, or None outside Git.
pub(super) fn toplevel(folder: &Path) -> Result<Option<PathBuf>, JamError> {
    let detected = process::run(folder, &["rev-parse", "--show-toplevel"], 16_384)?;
    if !detected.success || detected.truncated {
        return Ok(None);
    }
    let root = std::str::from_utf8(&detected.bytes)
        .map_err(|_| JamError::new("unavailable", "Repository root is not UTF-8."))?;
    let root = root.strip_suffix('\n').unwrap_or(root);
    crate::native_files::canonical(&PathBuf::from(root))
        .map(Some)
        .map_err(|_| JamError::new("not_found", "Repository root is unavailable."))
}

fn text(bytes: &[u8]) -> Result<&str, JamError> {
    std::str::from_utf8(bytes)
        .map_err(|_| JamError::new("unavailable", "Git reported a name that is not UTF-8."))
}

pub(super) fn list(target: &GitTarget, root: &Path) -> Result<BranchList, JamError> {
    let mut list = BranchList {
        project_id: target.project_id.into(),
        worktree_id: target.worktree_id.map(Into::into),
        state: "repository".into(),
        current: None,
        detached: false,
        changed: 0,
        busy: in_progress(root)?,
        branches: Vec::new(),
        truncated: false,
    };
    let refs = process::checked(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(HEAD)%00%(worktreepath)%00%(symref)",
            "refs/heads",
            "refs/remotes",
        ],
        LIST_BYTES,
    )?;
    list.truncated = refs.truncated;
    let root_text = root.to_string_lossy().replace('\\', "/");
    for line in text(&refs.bytes)?.lines() {
        let mut fields = line.split('\0');
        let (Some(refname), Some(head), Some(worktree), Some(symref)) =
            (fields.next(), fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        // `origin/HEAD` points at another branch; it is not one itself.
        if !symref.is_empty() {
            continue;
        }
        let (name, remote) = match refname
            .strip_prefix("refs/heads/")
            .map(|name| (name, false))
            .or_else(|| refname.strip_prefix("refs/remotes/").map(|n| (n, true)))
        {
            Some(found) => found,
            None => continue,
        };
        if list.branches.len() >= MAX_BRANCHES {
            list.truncated = true;
            break;
        }
        let current = head == "*";
        if current {
            list.current = Some(name.into());
        }
        // Git reports forward slashes on every platform.
        let elsewhere = !worktree.is_empty() && !same_folder(worktree, &root_text);
        list.branches.push(Branch {
            name: name.into(),
            remote,
            current,
            worktree: elsewhere.then(|| worktree.into()),
        });
    }
    list.detached = list.current.is_none();
    list.changed = changed_files(root)?;
    Ok(list)
}

fn same_folder(a: &str, b: &str) -> bool {
    let a = a.trim_end_matches('/');
    let b = b.trim_end_matches('/');
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// Staged or unstaged changes to tracked files. Untracked files never block a
/// switch: Git itself refuses rather than overwrite one.
fn changed_files(root: &Path) -> Result<u32, JamError> {
    let status = process::checked(
        root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "--untracked-files=no",
            "--ignore-submodules=none",
        ],
        4 * 1024 * 1024,
    )?;
    if status.truncated {
        return Ok(u32::MAX);
    }
    // Renames carry a second, NUL-separated path that is not its own record.
    let mut count = 0u32;
    let mut records = status.bytes.split(|b| *b == 0).filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        count += 1;
        if record.starts_with(b"2 ") {
            records.next();
        }
    }
    Ok(count)
}

fn in_progress(root: &Path) -> Result<bool, JamError> {
    let dir = process::checked(root, &["rev-parse", "--absolute-git-dir"], 16_384)?;
    let dir = PathBuf::from(text(&dir.bytes)?.trim_end_matches('\n'));
    Ok([
        "MERGE_HEAD",
        "rebase-merge",
        "rebase-apply",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
    ]
    .iter()
    .any(|name| dir.join(name).exists()))
}

/// JAM's own rules first, so an option-like or unusual name never reaches Git;
/// `check-ref-format` then applies Git's.
pub fn validate_branch_name(name: &str) -> Result<(), JamError> {
    let invalid = || JamError::invalid(format!("{name:?} is not a branch name JAM can use."));
    if name.is_empty()
        || name.len() > 200
        || name.starts_with(['-', '/', '.'])
        || name.ends_with(['/', '.'])
        || name.ends_with(".lock")
        || name == "HEAD"
        || name.contains("..")
        || name.contains("//")
        || name.contains("@{")
        || name.contains("/.")
        || name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "\\~^:?*[".contains(c))
    {
        return Err(invalid());
    }
    Ok(())
}

/// Whether the work on `branch` is finished in the repository at `folder`:
/// merged into the default branch (`origin/HEAD`, else `main` or `master`)
/// or deleted. The default branch, the branch checked out in `folder`, and
/// one with no commits of its own are not finished. `None` when that cannot
/// be told: not a repository, no default branch, or a name JAM would not
/// pass to Git.
pub(super) fn finished(folder: &Path, branch: &str) -> Option<bool> {
    validate_branch_name(branch).ok()?;
    let root = toplevel(folder).ok()??;
    let commit = |reference: &str| {
        let output = process::run(
            &root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{reference}^{{commit}}"),
            ],
            4096,
        )
        .ok()?;
        (output.success && !output.truncated)
            .then(|| String::from_utf8_lossy(&output.bytes).trim().to_owned())
    };
    let default = process::run(
        &root,
        &["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
        4096,
    )
    .ok()
    .filter(|output| output.success)
    .map(|output| String::from_utf8_lossy(&output.bytes).trim().to_owned())
    .or_else(|| {
        ["refs/heads/main", "refs/heads/master"]
            .into_iter()
            .find(|reference| commit(reference).is_some())
            .map(str::to_owned)
    })?;
    let default_name = default
        .rsplit_once('/')
        .map_or(default.as_str(), |(_, name)| name);
    let here = process::run(
        folder,
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        4096,
    )
    .ok()?;
    if branch == default_name
        || (here.success && String::from_utf8_lossy(&here.bytes).trim() == branch)
    {
        return Some(false);
    }
    let Some(tip) = commit(&format!("refs/heads/{branch}"))
        .or_else(|| commit(&format!("refs/remotes/origin/{branch}")))
    else {
        // Deleted, the way a merged pull request's branch usually is.
        return Some(true);
    };
    let base = commit(&default)?;
    if tip == base {
        return Some(false);
    }
    let merged = process::run(&root, &["merge-base", "--is-ancestor", &tip, &base], 4096).ok()?;
    Some(merged.success)
}

fn git_accepts(root: &Path, name: &str) -> Result<(), JamError> {
    let output = process::run(root, &["check-ref-format", "--branch", name], 4096)?;
    if output.success {
        Ok(())
    } else {
        Err(JamError::invalid(format!(
            "Git does not accept {name:?} as a branch name."
        )))
    }
}

/// Switches the checkout the way `git switch` does: uncommitted changes come
/// along, and Git refuses, changing nothing, when the switch would overwrite
/// one of them or an untracked file.
pub(super) fn switch(root: &Path, list: &BranchList, branch: &str) -> Result<(), JamError> {
    validate_branch_name(branch)?;
    let target = list
        .branches
        .iter()
        .find(|b| !b.remote && b.name == branch)
        .ok_or_else(|| {
            JamError::new("not_found", format!("There is no local branch {branch:?}."))
        })?;
    if target.current {
        return Ok(());
    }
    if let Some(folder) = &target.worktree {
        return Err(JamError::new(
            "conflict",
            format!(
                "{branch} is checked out in another worktree ({folder}). Start a new worktree from it instead."
            ),
        ));
    }
    if list.busy {
        return Err(JamError::new(
            "conflict",
            "A merge, rebase or similar operation is in progress in this checkout. Finish it before switching branches.",
        ));
    }
    git_accepts(root, branch)?;
    let output = process::run(
        root,
        &["switch", "--no-guess", "--end-of-options", branch],
        16_384,
    )?;
    if output.success {
        return Ok(());
    }
    // Git's own words stay private; with changes pending, its usual reason
    // is that the switch would overwrite one of them.
    Err(if list.changed > 0 {
        JamError::new(
            "conflict",
            format!(
                "Git refused to switch to {branch}, most likely because it would overwrite uncommitted changes. Your files were not changed. Commit or stash them, or use a new worktree for this chat."
            ),
        )
    } else {
        JamError::new(
            "unavailable",
            format!(
                "Git refused to switch to {branch}; your files were not changed. Check the checkout in your Git tools."
            ),
        )
    })
}

/// A short, safe name from the first message: lowercase ASCII words.
pub fn slug(hint: &str) -> String {
    let words: Vec<String> = hint
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .take(6)
        .map(str::to_ascii_lowercase)
        .collect();
    let mut slug = String::new();
    for word in words {
        if slug.len() + word.len() + 1 > 40 {
            break;
        }
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&word);
    }
    if slug.is_empty() { "chat".into() } else { slug }
}

/// The main worktree's folder: new worktrees sit beside it, never inside it.
fn main_root(root: &Path) -> Result<PathBuf, JamError> {
    let listing = process::checked(root, &["worktree", "list", "--porcelain", "-z"], LIST_BYTES)?;
    let first = text(&listing.bytes)?
        .split('\0')
        .find_map(|record| record.strip_prefix("worktree "))
        .ok_or_else(|| JamError::new("unavailable", "Git listed no worktrees."))?;
    crate::native_files::canonical(Path::new(first))
        .map_err(|_| JamError::new("not_found", "The main checkout is unavailable."))
}

pub struct NewWorktree {
    pub path: PathBuf,
    pub branch: String,
    pub base: String,
}

/// Creates `jam/<name>` from `base` in `<repo>-worktrees/<name>` beside the
/// main checkout, choosing a free name. Never reuses an existing folder.
pub(super) fn create(
    root: &Path,
    list: &BranchList,
    base: &str,
    hint: &str,
) -> Result<NewWorktree, JamError> {
    validate_branch_name(base)?;
    let base_ref = list
        .branches
        .iter()
        .find(|b| b.name == base)
        .map(|b| {
            if b.remote {
                format!("refs/remotes/{base}")
            } else {
                format!("refs/heads/{base}")
            }
        })
        .ok_or_else(|| {
            JamError::new(
                "not_found",
                format!("There is no branch {base:?} to start from."),
            )
        })?;
    let main = main_root(root)?;
    let repository = main
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| JamError::new("unavailable", "The repository folder has no usable name."))?;
    let parent = main.parent().ok_or_else(|| {
        JamError::new(
            "unavailable",
            "The repository has no parent folder for worktrees.",
        )
    })?;
    let location = parent.join(format!("{repository}-worktrees"));
    std::fs::create_dir_all(&location).map_err(|_| {
        JamError::new(
            "unavailable",
            "Could not create the worktrees folder beside the repository.",
        )
    })?;
    let location = crate::native_files::canonical(&location)
        .map_err(|_| JamError::new("unavailable", "The worktrees folder is unavailable."))?;
    if location.parent() != Some(parent) {
        return Err(JamError::new(
            "unavailable",
            "The worktrees folder resolves outside the repository's parent.",
        ));
    }
    let base_name = slug(hint);
    let taken = |name: &str| list.branches.iter().any(|b| !b.remote && b.name == name);
    let (name, branch) = (1..=50)
        .map(|n| {
            if n == 1 {
                base_name.clone()
            } else {
                format!("{base_name}-{n}")
            }
        })
        .map(|name| {
            let branch = format!("{BRANCH_PREFIX}{name}");
            (name, branch)
        })
        .find(|(name, branch)| !taken(branch) && !location.join(name).exists())
        .ok_or_else(|| JamError::new("conflict", "Every worktree name for this chat is taken."))?;
    validate_branch_name(&branch)?;
    git_accepts(root, &branch)?;
    let path = location.join(&name);
    let path_text = path
        .to_str()
        .ok_or_else(|| JamError::new("unavailable", "The worktree path is not UTF-8."))?;
    // `--no-track`: a remote base must not make the new branch push to it.
    // Worktrees sit one level deeper than the checkout, so Windows' 260
    // character path limit is reached sooner; Git lifts it when asked.
    let output = process::run_within(
        root,
        &[
            "-c",
            "core.longpaths=true",
            "worktree",
            "add",
            "--no-track",
            "-b",
            &branch,
            "--end-of-options",
            path_text,
            &base_ref,
        ],
        16_384,
        CHECKOUT_DEADLINE,
    )?;
    if !output.success {
        // Git can create the branch before the folder fails. JAM never
        // deletes a branch, so it says what was left instead.
        let left = process::run(
            root,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ],
            4096,
        )
        .is_ok_and(|output| output.success);
        return Err(JamError::new(
            "unavailable",
            if left {
                format!(
                    "Git created the branch {branch} but could not create its worktree folder. The branch was kept; remove it with your Git tools if you do not need it."
                )
            } else {
                format!("Git could not create the worktree for {branch}. Nothing was changed.")
            },
        ));
    }
    let path = crate::native_files::canonical(&path).map_err(|_| {
        JamError::new(
            "unavailable",
            "Git reported success but the worktree folder is missing.",
        )
    })?;
    Ok(NewWorktree {
        path,
        branch,
        base: base.into(),
    })
}

/// A recorded worktree is still usable: the folder exists and is the top of
/// a Git checkout. JAM never falls back to another folder when it is not.
pub fn verify(path: &Path) -> Result<PathBuf, JamError> {
    let missing = || {
        JamError::new(
            "not_found",
            format!(
                "This chat's worktree ({}) is missing or no longer a Git checkout. Restore it with your Git tools, or start a new chat.",
                path.display()
            ),
        )
    };
    let canonical = crate::native_files::canonical(path).map_err(|_| missing())?;
    if !canonical.is_dir() || toplevel(&canonical)?.as_deref() != Some(canonical.as_path()) {
        return Err(missing());
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_names_reject_options_and_git_syntax() {
        for bad in [
            "",
            "-x",
            "--upload-pack=evil",
            "a..b",
            "a b",
            "a\tb",
            "a\nb",
            "x@{1}",
            "a~1",
            "a^",
            "a:b",
            "a?",
            "a*",
            "a[b",
            "a\\b",
            "/a",
            "a/",
            "a//b",
            "a/.b",
            ".a",
            "a.",
            "a.lock",
            "HEAD",
            &"x".repeat(201),
        ] {
            assert!(validate_branch_name(bad).is_err(), "{bad:?} was accepted");
        }
        for good in [
            "main",
            "feat/new-chat",
            "jam/fix-2",
            "release-1.2",
            "origin/main",
            "café",
        ] {
            assert!(validate_branch_name(good).is_ok(), "{good:?} was rejected");
        }
    }

    #[test]
    fn slugs_are_short_lowercase_words() {
        assert_eq!(
            slug("Fix the flaky reconnect test, please!"),
            "fix-the-flaky-reconnect-test-please"
        );
        assert_eq!(slug("--upload-pack=x ../../etc"), "upload-pack-x-etc");
        assert_eq!(slug("   "), "chat");
        assert_eq!(slug("日本語"), "chat");
        assert!(slug(&"word ".repeat(40)).len() <= 40);
    }
}
