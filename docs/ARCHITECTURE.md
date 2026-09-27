# Architecture

## Decision

Use Tauri 2, React/TypeScript/Vite with pnpm, and a Cargo workspace. Keep a framework-independent Rust runtime and reusable frontend product package. SQLite is the source of truth; FTS5 indexes searchable projections. Start with one runtime crate containing coherent modules rather than separate crates for each noun.

```mermaid
flowchart LR
  Desktop[Desktop entry and native chrome] --> UI[Shared React client]
  UI --> Contract[JAM protocol / JamTransport]
  Contract --> Local[Tauri local transport]
  Local --> Host[Tauri host: trusted main window]
  Host --> Core[Rust runtime]
  Core --> Providers[Provider adapters: mock now]
  Core --> Storage[SQLite records + FTS5]
  Core --> Services[Future PTY / Git / browser / capture]
  Web[Future authenticated web client] -.-> UI
  Contract -.-> Remote[Future remote transport]
  Remote -.-> RemoteHost[Future authorized runtime host]
  RemoteHost -.-> Core
```

The dashed path is a reserved boundary, not implemented software. No server, WebSocket listener, remote authentication or web application is scaffolded now. The Tauri bridge converts IPC to typed runtime calls and scoped subscriptions. Product components never import Tauri APIs.

## Ownership

| State                                                  | Authority        | Client responsibility                   |
| ------------------------------------------------------ | ---------------- | --------------------------------------- |
| Projects, resource identities, conversations, messages | Runtime / SQLite | Cache and render                        |
| Sessions, in-flight turns, task handles, subscribers   | Runtime          | Render normalized state                 |
| Provider installation/auth/capabilities                | Runtime adapters | Display unknown faithfully              |
| Open views, layout tree, focus, Single/Tiles, drafts   | Client           | Never use view cleanup to stop work     |
| Project files and directory listings                   | Runtime          | Address by project ID and relative path |
| Search index                                           | Runtime storage  | Query and paginate/bound                |
| Native window/menu/tray                                | Desktop host     | Access via injected desktop services    |

Rust protocol models and TypeScript contracts are explicit JSON wire types. Shared fixtures and contract tests catch drift. Keep provider wire types inside adapters. A conversation resource points to a session; future resumptions can add historical sessions without changing resource identity. A view only holds a resource ID.

## Presentation: tabs, panes and the layout tree

A tab is one open resource and owns its own arrangement. A pane is one visible
slot inside the active tab's arrangement:

```
LayoutNode = SplitNode | LeafNode
SplitNode  = { direction: row | column, ratio, first, second }
LeafNode   = { paneId, resourceId | null }
```

Selecting a tab switches the whole workspace to that tab's tree. It never loads
a resource into whichever pane happens to be focused, which is the distinction
between navigating and arranging. Panes are therefore local to the tab you are
in rather than app-wide: a terminal, file or review opened beside a
conversation belongs to that conversation's workspace and does not appear in
the tab bar. The `+` in the tab bar opens a new tab; an empty pane's own
control and the pane menu fill that pane.

A leaf holds a resource ID and nothing else, so the layout never learns whether
it is arranging a conversation, a terminal, a file, a file browser or a review;
any resource can occupy any leaf and there are no per-kind split types. An
empty leaf is a real state: splitting creates a pane before its resource is
chosen. A boundary test fails if layout code starts naming resource kinds.

Single presents the tab's own resource; Tiles presents its tree. Switching
between them changes nothing else: every tab's tree survives the round trip,
and so do resource identities and sessions. Closing a pane removes a slot;
closing a tab discards that tab's arrangement. Neither ends a session — only an
explicit lifecycle command does.

Resource identity for non-conversation resources belongs to the runtime.
`resource.open` is keyed by project, kind and path, so reopening the same file
returns the record that already exists instead of duplicating it.

A conversation's open or closed state is runtime data on its resource:
`closedAt` and `closeSuggestionDismissedAt`. `thread.setClosed` and
`thread.keepOpen` change them only on an explicit request, and `turn.start`
clears `closedAt`, so continuing a thread reopens it. When to suggest closing
is a client preference computed from those timestamps; no timer runs.
`project.update` also accepts `pinned`.

## Project files

`directory.list` resolves exactly one directory level, `file.read` returns one
file and `file.write` saves a working copy, all addressed by project ID and a
project-relative path that the runtime validates and resolves. A client never submits a local path. The wire
shape is therefore already the lazily expanded tree a large repository needs.

This milestone serves an isolated demo tree from
`packages/protocol/fixtures/files.json`, shared by the Rust runtime and the
browser development preview so they cannot drift. No directory on the machine
is opened, listed or read; every listing and file is flagged `demo` and every
surface says so. Saves do not mutate that fixture: a working copy is recorded
in the `file_edits` table and layered over the fixture on read, so an edit
survives restart while the shipped tree stays pristine. Replacing the demo
table with a scoped real reader changes neither the protocol nor the client,
but needs native folder selection and a permission model first.

Directory listings and expansion state are client-owned and live outside any
mounted pane, because reshaping the layout remounts panes and a repository tree
must not collapse when a file opens beside it.

## Transport and consistency

`JamTransport.request(method, params)` returns typed results; `subscribe(scope, listener)` returns an async disposable subscription. Local streaming uses scoped Tauri Channels, not a frontend-wide broadcast of every token. Protocol version, runtime epoch and monotonic sequence identify events. Register before reading a snapshot, buffer events while the read is in flight, then apply only events after its cursor. Duplicate message updates replace by message ID. On epoch change/gap/disconnect, fetch a fresh authoritative snapshot instead of replaying a guessed state. The first client may use invalidation/refetch for bounded conversations; this is not a high-volume token strategy.

Send commands carry a client-generated request ID. The runtime rejects conflicting in-flight work and deduplicates retried submissions; it must not double-run a turn after an acknowledgement is lost. An accepted receipt is separate from completion. Cancel/interrupt is distinct from closing, deleting history or rolling back files. Errors use stable codes and useful messages; unknown methods/versions fail before mutation.

Commit accepted input and normalized updates before publishing events. Never hold a storage lock across provider waits or UI delivery. On restart, running records become interrupted; a dead process is not reported as live. Real provider adapters will require version-specific reconciliation.

## Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Running: explicit Send
  Running --> Idle: complete
  Running --> Interrupted: explicit interrupt or app shutdown
  Running --> Failed: provider failure
  Interrupted --> Running: new explicit submission
  Failed --> Running: new explicit submission
```

The initial runtime lives in the Tauri core process, outside WebView and React lifetimes. The desktop single-instance guard runs before database setup: a second launch reopens the existing app instead of recovering its still-active sessions. Closing any pane detaches only presentation. Hiding/closing the main window keeps the process alive only when a working tray/reopen path exists. Tray Show reopens it; explicit Quit records interruptions and stops owned tasks under one two-second shutdown deadline before exit. Reloading or destroying the main WebView detaches its subscriptions without stopping sessions. macOS Dock/menu reopening is host behavior. A crash, application exit or OS shutdown does not preserve processes. Durable transcripts survive restart. There is no promise of daemon-level survival.

If unattended jobs or remote access require survival beyond application lifetime, add a separate runtime executable and authenticated transport. The runtime crate already accepts callers without Tauri and owns its services; avoid adding a daemon until that requirement is real. Before adding another host, establish process-level database ownership: the current core assumes the desktop host has already enforced single ownership and must not be opened concurrently by independent runtime processes.

## Storage and search

Runtime modules own numbered transactional migrations, foreign keys and FTS5. Use WAL for the local file database and bounded busy waits. Seed demo data explicitly and idempotently. Keep application data outside the repository. Persist source records and search documents in the same transaction. Tokenize plain user input safely; never interpolate it as SQL or accept unrestricted FTS operators. Results use text snippets, not trusted HTML. Cap search query length and results. Initial search semantics are token/prefix matching, not arbitrary substring matching.

Schema evolution must keep stable resource/message IDs, include migration failure reporting and prohibit destructive resets as a migration strategy. Backups and retention policy precede real user data import. Do not log complete transcripts by default.

### Foundation bounds

The isolated `jam-demo.sqlite` database preserves all recorded messages. A conversation read returns its latest 500 messages; older rows remain searchable, but transcript pagination is not implemented. Search returns at most 50 distinct conversations, ranked before applying that limit; a blank or punctuation-only query returns no results. Native FTS search uses plain token/prefix matching. These constraints must be revisited before importing real provider history.

Each subscription has a 256-event FIFO and one coalesced latest event. When a slow client overflows that FIFO, the latest cursor is still delivered after buffered events: skipped sequences trigger the client's authoritative reread, including when the skipped update was the end of a turn. At most 128 subscriptions can coexist. The host clears old subscriptions at page reload and window destruction. The current shared client uses a workspace subscription; resource-scoped subscriptions are available for later scaling. A gap in a resource-scoped global sequence can also reflect activity in another resource, so a conservative reread is safe rather than evidence of data loss.

Request limits match the TypeScript contract in UTF-16 units: identifiers 128, prompt text 20,000, 16 context items, and search queries 256. Context-only sends are allowed, but the mock adapter never resolves assets or reads their source URIs. Staged context becomes durable only through explicit Send. The runtime performs no model calls, subprocess execution, filesystem inspection, terminal emulation or capture in this milestone.

## Native services and platform differences

- Terminal: later native-owned PTY handles, bounded output buffers, resize/attach/detach, xterm loaded on demand. Never couple process exit to component unmount.
- Editor: CodeMirror 6, loaded only by a File pane that is actually rendered, with language modes in per-language chunks. Merely opening a file resource, or leaving one open in a hidden tab, constructs no editor. Writing still needs a filesystem service and explicit save conflicts, so the File resource is read-only and says so.
- Git: user's Git CLI, argument arrays, repository-scoped working directory, no shell-concatenated commands.
- Browser: one native child webview per Browser resource (WKWebView / WebView2), owned by the desktop host and placed over its pane; see [ADR 0006](adr/0006-native-browser.md). Pages are unprivileged: they match no capability, have no page-to-host channel, may only load http(s), and keep cookies in a profile separate from JAM's interface. WebView2 and WKWebView differ; devtools/automation parity is not promised.
- Context: typed provenance/selection and opaque asset references. Capture service retains bytes, stages to a conversation and never invokes Send. Remote clients cannot submit arbitrary local paths as capability grants.
- Windows uses right-side native-style controls; macOS uses left-side traffic lights and Cmd shortcuts. Host supplies the platform and window actions. Titlebar drag areas exclude interactive controls.

## Trust boundaries

Tauri permissions are restricted to local main UI, scoped to the `main` _webview_ rather than the window, because Browser pages are child webviews of that window. Declare application IPC commands through `AppManifest::commands` so capabilities actually gate them. Validate the envelope and per-command inputs in Rust. No generic shell/filesystem plugin capability, remote URLs, external scripts or provider credentials in the frontend. Content security policy permits bundled resources and native IPC; development-server allowances stay development-only. Render agent content as text/structured blocks; raw HTML is not trusted.

A future remote host needs explicit pairing, transport encryption, revocable device credentials, per-project authorization, origin checking, CSRF/replay protection, rate/resource limits, audit and reconnection semantics. Authentication alone is not authorization to execute local commands. Remote clients receive opaque project/asset IDs; the runtime resolves paths. These are requirements, not implemented claims.

## Performance and risks

No idle polling or eager agent processes. Scope subscriptions, batch normalized updates, bound queries and lazily render expensive surfaces. Transcript pagination/virtualization is required before importing large histories; the foundation uses small bounded demo records. Measure native process plus WebView child memory, not only one executable. Establish startup marks from client bootstrap to workspace loaded, FTS query timings and release startup/RSS/idle CPU procedures in `docs/VALIDATION.md`.

The largest uncertainties are provider subscription eligibility, changing provider protocols, WebView browser automation parity, modifier-only global capture, platform-specific background lifetime, and remote authorization. None require an Electron fallback now.
