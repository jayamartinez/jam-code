# 0012 — Where a new chat works: checkout, branch or worktree

Status: accepted for the new-chat workspace milestone. Extends ADR 0010, which
deferred branch mutation.

## Decision

A new chat chooses its project, its workspace (the project's **current
checkout** or a **new worktree**) and a branch before its first Send. Nothing
in Git changes until that Send: `conversation.create` carries an optional
`workspace` and a `requestId`, and the runtime applies the choice before it
records the chat. A draft that is never sent leaves the repository untouched.

- **Current checkout, another branch.** The runtime switches the checkout on
  Send the way Git itself does. It runs
  `git switch --no-guess --end-of-options <branch>` and never passes
  `--force`, `--discard-changes` or `reset`, so uncommitted and untracked
  files come along, and Git refuses, changing nothing, when the switch would
  overwrite one of them. JAM Code refuses first only while a merge, rebase,
  cherry-pick, revert or bisect is in progress, or when the branch is checked
  out in another worktree. A refusal creates nothing.
- **Chats share the checkout.** Any number of chats work in the current
  checkout at once, as sessions of a command-line agent in one folder do. A
  folder has one branch, so a chat that switches it on Send moves the chats
  already running there as well; a running chat does not prevent the switch.
  This replaces the first version of this decision, which refused a switch
  whenever a tracked file had changes or a chat was running: with an agent at
  work both are nearly always true, so the branch could not be chosen.
- **New worktree.** The runtime creates `jam/<name>` from the chosen base (a
  local branch, or a remote-tracking branch as Git last fetched it; JAM Code does
  not fetch) in `<main checkout's parent>/<repository>-worktrees/<name>`, with
  `git worktree add --no-track -b <branch> --end-of-options <path> <ref>`.
  `<name>` is a lowercase slug of the first message; taken branch or folder
  names get `-2`, `-3`…, and an existing folder is never reused. The client
  never supplies a folder or the new branch name.
- **Existing worktree.** `{ kind: "existing", branch }` starts the chat in the
  worktree that already has that branch checked out, beside any chats working
  there. Nothing is created or switched. The client names only the branch;
  the runtime asks Git where that worktree is and checks the folder is still
  a checkout. A worktree JAM Code did not create (one made in a terminal or by
  another tool) is recorded on that Send, and later chats share the record.
  In the composer it is not a third menu: a branch a worktree has checked out
  is picked in the branch menu, and the workspace pill then reads Worktree.

## A started chat can change where it works

The same two pills stay under a started chat's message box. A change there is
staged, like a new chat's choice, and applied when the next message is sent
(`conversation.workspace`), never to a turn that is running:

- **A branch** is worked on wherever it is. If another folder has it checked
  out (a worktree, or the project's checkout) the chat moves to that folder.
  If no folder has, the folder the chat works in switches to it, as above; a
  worktree's record follows its branch.
- **Current checkout** returns a worktree chat to the project's checkout.
- **New worktree** makes one, from the branch the chat was on unless a base
  is picked, and moves the chat into it.

The agent keeps its session: the Claude Code process is restarted in the new
folder and resumes (Claude Code finds a session from another worktree of the
same repository; checked with 2.1.287), and Codex is given the folder with
every turn (`turn/start` `cwd`, 0.157). Files, Review and terminals already
opened from the chat keep the folder they were opened for; new ones use the
chat's new folder, and so do the links in its earlier messages.

## Ownership and identity

A worktree is a durable runtime record (`worktrees`, migration 006: ID,
project, branch, base, path, creation time) listed in the workspace snapshot.
The chat's resource records its `worktreeId`, and so do the Review, File and
Terminal resources opened from that chat's tab, its file links and its Review
button. Git, file and terminal requests accept `worktreeId` and never a path;
the runtime resolves the folder and checks, on every use, that it still exists
and is the top of a Git checkout. A missing worktree is a `not_found` error
naming its folder; JAM Code never silently falls back to the project's folder.
Refusals use the codes the desktop transport already shows (`conflict`,
`not_found`, `unavailable`), so their explanations reach the reader.
The chat's agent runs with that folder as its working directory.

JAM Code never deletes or resets a worktree or a branch. Removing one is left to
the reader's own Git tools; the record then reports the folder missing.

## Validation and safety

Branch names pass JAM Code's own rules before Git sees them (no leading `-`, `/` or
`.`; no `..`, `//`, `@{`, `/.`, whitespace, control characters or
`\ ~ ^ : ? * [`; not `HEAD`; not ending in `/`, `.` or `.lock`; at most 200
bytes), then `git check-ref-format --branch`. A name to switch to or start from
must be one Git listed. Commands use the existing runner (ADR 0010): argument
arrays with no shell, `--end-of-options`, bounded output, Git environment
routing removed, hooks disabled, stderr never exposed. Creating a worktree has
a 120-second deadline because it writes a checkout; other commands keep 15.

Git runs outside the database lock and serialized by `GitManager`. Git's own
refusals are what protect uncommitted work. A retried Send with the
same `requestId` returns the chat it created; if saving fails after the
worktree was created, the worktree is kept and the error names it.

## Consequences

- `git.branches` lists local and remote-tracking branches (at most 500), the
  current branch, uncommitted tracked-file count and in-progress state. It is
  read when a draft appears, its project changes, a branch menu opens, the
  window regains focus, or a chat in the checkout starts or stops (its agent
  may have switched branches); never on a timer.
- Settings → General “New threads start in” (Current checkout, New worktree,
  Ask each time) is a client reader preference like the other General
  choices; Ask each time preselects nothing and Send asks for a choice.
  Worktree location and branch prefix are fixed and shown as such; changing
  them, and a per-project override, are planned.
- The demo provider never changes a repository and always works in the
  current checkout. The browser preview has no Git and refuses both.
- Creating a worktree passes `core.longpaths=true`, since its files sit
  deeper than the checkout's. Git for Windows still refuses when the
  repository's own path is so long that its internal worktree folder exceeds
  Windows' path limit; Git may then have created the branch already, and the
  error says so and keeps it.
- Not included: fetching, deleting or pruning worktrees, branch creation in
  the checkout, and adding projects (the project menu shows New project as
  planned).
