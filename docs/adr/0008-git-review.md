# 0008 — Runtime-owned Git review through the installed CLI

Status: accepted for the first Git milestone.

## Ownership and scope

`Runtime` owns a `GitManager`. `git.status`, `git.diff`, and `git.setStaged`
resolve a persisted project ID; clients cannot supply a repository root.
The project's **first configured folder** selects the repository. A folder
inside a worktree discovers its containing repository, and Review explicitly
shows that repository root. Git operations cover that repository. Projects
without folders, non-repositories, missing folders, unborn branches and
detached HEAD have distinct, honest states. Additional project folders are
reserved; there is no implicit fallback to a different repository.

Git runs on the host's existing blocking request worker, outside the window
thread and without holding SQLite's mutex. The manager serializes its requests;
Git's index lock still protects against other clients. No Git daemon, libgit2,
provider integration, authentication or network operation is introduced.

## Commands and representation

Use the user's `git` executable with argument arrays, a repository working
directory, literal pathspecs and `--` before paths. Repository detection uses
`rev-parse --show-toplevel`; branch, HEAD and file states come from
`status --porcelain=v2 --branch -z --untracked-files=all --ignore-submodules=none`.
NUL records preserve whitespace, tabs, newlines and Unicode in filenames;
non-UTF-8 filenames produce an explicit unsupported error, not lossy targets.
The status projection includes separate index and working-tree enums, rename
source, conflict and submodule flags. It is never stored as project history.

One selected file is read on demand through `diff --no-ext-diff --no-textconv
--no-color --no-relative --unified=3 --find-renames`, adding `--cached` for the
index. Indexed renames compare `HEAD:<previous path>` with `:<current path>` as two blobs, avoiding inclusion of a recreated source file. The runtime parses unified patches into hunks with original headers,
old/new ranges, context/addition/deletion/notice lines and old/new line numbers.
Metadata preserves mode-only changes and renames. Binary/non-UTF-8 content,
conflicts and submodules get an explicit non-text presentation. Untracked
regular files are bounded additions against an empty file. No patch parsing
happens in React. Counts are for the selected version; status does not eagerly
compute every file's diff or invent repository-wide totals.

Hunk and line coordinates, repository/project identity, file path and side
remain addressable for future context selections and annotations. This milestone
does not simulate annotations, attribution to agents, sending a review, or
commits. Context remains staged until an explicit Send in the existing model.

## Explicit mutations

Stage file uses `git add -- <path>`; unstage uses
`git reset --quiet HEAD -- <path>`. Before the first commit, unstage uses
`git rm --cached --force -- <path>` so the working file is preserved even if
its contents differ from the staged addition. Unstaging a detected rename includes both paths; staging an already-indexed rename updates only its destination. Every operation rereads status before targeting a changed file and returns
fresh status afterward. A failure triggers a frontend refresh and a visible error.
Staging operates on the entire current file, including portions beyond a truncated
preview. Git's configured clean filters still apply, as with ordinary `git add`.

Conflicted files and submodules are reviewable summaries but must be staged with
external Git tools. Stage-all, hunk staging, destructive discard/revert, commit,
checkout, clone and branch mutation are deliberately deferred. In particular,
no operation deletes an untracked working file.

## Refresh and bounds

A shared client projection coalesces simultaneous status reads. It refreshes on
workspace/project-folder initialization, window focus, Review mount/activation,
explicit Refresh and mutations. Folder changes invalidate in-flight generations;
late responses cannot replace the new folder's state. Hidden Review resources
load no diffs. Selected-file requests ignore superseded responses, and selection
survives layout remounts. There is no filesystem watcher or idle timer. Changes
made in a continuously focused terminal require Refresh until a shared runtime
filesystem invalidation service exists.

Status captures at most 4 MiB and returns at most 2,000 changed files (explicitly
truncated). Oversized status fails visibly. Selected patches capture at most
512 KiB and render at most 5,000 lines; displayed counts are labeled partial.
Subprocesses have a 15-second deadline and bounded stdout capture. Unix commands
run in their own process group, terminated on timeout/overflow. Windows process
tree termination still needs native verification. stderr is not exposed or logged.
Git environment routing is removed; pagers, fsmonitor hooks, external diff and
textconv are disabled. There is no background refresh while idle.

## File resource integration and safety

Review opens working files with the existing `resource.open(kind: file)` and
`file.read` APIs. Diff and File remain separate runtime resource IDs. A file can
open only inside the configured folder; a repository-root path outside a nested
project has no File-resource target. Real files are read-only, capped at 256 KiB,
and never use the demo save table. Configured native projects do not serve a
fictional demo directory listing; native directory browsing is deferred explicitly.
Projects without folders retain their demo tree and demo saves.

Reject absolute/parent paths, Windows prefixes, backslashes and `.git` components
before native reads or mutations. Native reads reject symlinks and special files.
Unix reads walk directory descriptors with `openat` and `NOFOLLOW`, avoiding a
check/open symlink race; `rustix` supplies these safe APIs without application
unsafe code and was already a transitive dependency. Windows rejects reparse
points and canonical escapes, but descriptor-relative traversal and concurrent
replacement require further Windows hardening/testing. Future remote hosts still
need per-project authorization; this local milestone grants no remote capability.
