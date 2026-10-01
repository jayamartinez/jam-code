# 0013 — User data, the demo seed and projects from folders

Status: accepted for v0.1.0-alpha (2026-09-29). Refines ADR 0003's "isolated
demo database" and ADR 0010's folder configuration. Resolves issue #9.

## Context

The foundation seeded every desktop database with synthetic projects and demo
conversations, in a file named `jam-demo.sqlite`. Providers V0 then stored
real Claude Code and Codex chats in the same file, usually inside a seeded
project that had been pointed at a real folder by typing its path. A public
alpha must not show synthetic history to new users or mix it with theirs, and
must not lose the history development builds already created.

Projects could only be edited, never created, and a folder could only be
attached by typing an absolute path.

## Decision

**One user database, no seed.** The desktop app opens `jam.sqlite` in the
platform application-data folder (`Runtime::open_user_data`). It contains no
demo content; a fresh install has no projects and shows the first-run screen.
The only record every database gets is the singleton Settings resource, which
Settings-as-a-tab needs. The demo provider is not registered.

**The demo is explicit.** `JAM_DEMO=1` opens `demo/demo.sqlite` beside the user
database with the seed and the demo provider (`Runtime::open_demo`). Tests and
the browser preview keep using the fixture. Demo and user history never share
a file.

**Upgrading keeps the person's work.**

1. On first launch, when `jam.sqlite` does not exist and `jam-demo.sqlite`
   does, the runtime copies the old file with `VACUUM INTO` (consistent even
   with a write-ahead log beside it) to `jam.sqlite.importing`, records
   `imported_from` in metadata and renames it into place. The old file is
   never modified, so it stays as a fallback and a pre-alpha build keeps
   working against it.
2. Before any migration of an existing database, the runtime writes a copy
   beside it, `jam.sqlite.before-v<N>.bak`, once per target version.
3. Schema migration 7 (`demo_cleanup.rs`), in the migration's transaction:
   - removes the nine seeded conversations by fixture ID, only when the demo
     provider ran them (with their sessions, messages, search documents and
     bindings), and the four seeded panes;
   - keeps a seeded project that has a folder or still owns a conversation or
     worktree, replacing its fixture name with its folder's name and its
     fixture branch with the live one; removes a seeded project with neither,
     together with the panes left in it (terminals, files, reviews);
   - returns staged snapshots aimed at a removed chat to the inbox;
   - never removes a conversation or resource a person created, whichever
     provider it used.
4. A database whose schema is newer than the build is refused with a clear
   message and left untouched. This already applied to `user_version` and now
   also applies to a legacy file before it is imported.

A failed import leaves only the `.importing` file, which the next launch
replaces; a failed migration rolls back and leaves the previous version.

**Projects come from folders.** `project.create { path }` takes a folder the
person chose, normally from `DesktopServices.pickDirectory()` — the native
Windows folder picker or macOS open panel, owned by the desktop host
(`rfd`, parented to JAM Code's window). Shared client code never imports Tauri; a
host without local folders (the browser preview, a future remote client)
omits `pickDirectory`, and the UI says adding a folder needs the desktop app.
The runtime checks that the path is absolute, exists, is a directory and can
be read, and stores its canonical form. Git is optional: the branch is read
live from `HEAD` on each workspace read (no process), and a plain folder has
none. The same folder, however spelled, is the same project.

**Removing forgets, never deletes.** `project.remove` marks the project
`removedAt`. Its folder, chats and worktrees are untouched; the workspace and
search leave it out; adding the folder again restores the same project with
its history. Removal is refused while a chat or terminal in it is running.

**A missing folder is shown, not dropped.** A workspace read marks
`folderMissing` when the first folder is gone; the sidebar and Settings say so
and offer Locate folder…, which points the project at a new folder.

**Native files are listed.** `directory.list` now lists a real project folder
(or a chat's worktree) one level at a time, read-only, bounded to 500 entries,
without `.git`, symlinks or junctions. Folderless projects, which now exist
only in demo data, keep the fixture tree.

## Consequences

- Development databases upgrade in place with their real chats, bindings,
  settings and snapshots; the demo seed disappears from them.
- The old `jam-demo.sqlite` and the `.bak` copies stay on disk until the user
  deletes them. JAM Code does not clean them up.
- A project stores one canonical path per folder; moving a folder needs
  Locate folder…. There is no filesystem watcher.
- Future migrations get the same pre-upgrade copy for free.
