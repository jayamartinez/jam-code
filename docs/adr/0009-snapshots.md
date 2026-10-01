# ADR 0009: Background Snapshots and staged context

Status: accepted for the macOS V0 implementation.

## Decision and ownership

`SnapshotManager` in the framework-independent runtime owns the asset store;
SQLite owns snapshot records, settings and the last-focused agent conversation.
The desktop host owns the global shortcut and implements `WindowCaptureBackend`.
React receives metadata projections through `snapshot.*` requests and invalidation
events. No provider SDK, filesystem path or Tauri import enters the shared client.

A capture is a `ContextItem` with `kind: snapshot` and an opaque `assetId`, using
the existing file/selection/diff/browser/terminal/chat context contract. Its record
contains timestamp, bounded source app/title, dimensions, byte size, optional note
and nullable conversation resource ID. The note becomes the context selection.
Only an explicit `turn.start` rehydrates the canonical context and marks the asset
sent in the same SQLite transaction as the message and deduplication receipt.
Capturing has no path to Send. The mock provider records context but cannot inspect
images; future provider adapters resolve assets only for explicitly submitted turns.

The client reports focus only for actual conversation resources with sessions.
Selecting a file, browser or terminal never replaces the last agent destination.
The host snapshots that destination before capture begins. Missing destinations,
Save only and Clipboard modes use the inbox, without creating a conversation.
Removing a composer chip moves it to the inbox; Remove in the toast deletes an
unsent capture. Dismiss only hides feedback. Closing a view changes none of this.

## Global shortcut and permissions

Snapshots start off. Turning them on shows one setup step, Screen Recording,
and Snapshots stay off until it is allowed: the header toggle shows the
effective state, and the desktop host refuses to start a listener without it.
If it is revoked later, Settings shows the same step as "paused". Its state is
re-read when JAM Code regains focus, not polled. Allow asks ScreenCaptureKit for
shareable content, which registers JAM Code in the Screen Recording list, and opens
that list if access is still off; it runs only from an explicit Settings action,
never from a background capture.

Screen Recording is the only permission. JAM Code never listens to key events, so it
never needs Input Monitoring. An earlier build detected a double-tap of Shift
with a listen-only event tap; that required Input Monitoring and was removed.
Stored settings that chose it now read as both Shift keys.

- **Both Shift keys (default).** Left and right Shift held together, the same
  default T3 Code uses. JAM Code reads the current modifier state
  (`CGEventSourceFlagsState`), which macOS does not gate. This means sampling:
  a 50 ms `dispatch_source` timer on a utility queue, with 10 ms leeway so
  macOS can coalesce wakeups. It is a deliberate exception to "idle should not
  poll" and runs only while Snapshots is on with this shortcut. Keys already
  held when it starts do not count, and Command, Control or Option held with
  them cancel the press.
- **⌘⇧2, ⌃⇧2 or ⌥⇧2.** Ordinary global hotkeys through
  `RegisterEventHotKey`, delivered by the system without seeing other keys and
  with no timer. The list is fixed and avoids macOS's own ⌘⇧3/4/5. If another
  app already holds the combination, Settings says so; JAM Code never replaces a
  registration.

Exactly one listener runs at a time. Disabling, changing the shortcut or quitting
stops it. Modifier shortcuts have no conflict registry on macOS, so an app-local
binding on both Shift keys could also fire.

## Capture and feedback

The macOS 14+ backend uses `NSWorkspace` and the on-screen window list once per
invocation to pin the frontmost application's foremost normal window. It resolves
that window through ScreenCaptureKit and invokes `SCScreenshotManager` once. It
never activates JAM Code, requests a picker, starts a stream or polls windows/screens.
Protected content or a disappearing window can fail with an unavailable status.
The Windows backend explicitly reports unavailable and has not been tested.
Region and full-screen modes are reserved but rejected in V0.

A bounded native callback waits at most 15 seconds; only one capture can be in
flight. Encoding runs in the capture completion path, not the UI event listener.
macOS feedback is a 120 ms nonactivating flash and Tink at 35% volume. The toast
uses `orderFrontRegardless`, because Tauri's ordinary `show()` makes a macOS
window key. Explicit Open alone activates the main window. Optional clipboard
copy occurs after durable storage; the default leaves the clipboard untouched.

The toast follows Paper's 400 px card, 150 px thumbnail, destination select,
optional note and Open/Remove/Dismiss actions. It fades after three seconds (shortened from Paper’s six after hands-on feedback) unless
interacting; the staged item remains. Deliberate V0 deviations: one quiet sound,
no region/full-screen capture or shortcut recorder, no bring-to-front-on-capture
setting. The compact inbox in Snapshot settings exposes otherwise orphaned captures.
The Settings v2 Snapshots page (`settings/pages/SnapshotsPage.tsx`) drives these
settings through the protocol transport and the injected `SnapshotHost`; choices the
host cannot honour yet (sound choice, other shortcuts, region/full screen,
bring-to-front) stay visible and marked planned.

## Storage, retention and privacy

Assets live in `snapshots/` beside the runtime database in JAM Code app data, never in
the source project. UUID-based JPEG names are generated internally; no request
accepts a path. macOS encoding uses sRGB JPEG quality 0.88 with a 4096 px longest
edge; thumbnails use quality 0.72 and at most 400 px. Bounds are 8 MiB per image,
256 KiB per thumbnail, and 500 unsent records. Oversized captures fail explicitly.
This keeps UI text readable without full-resolution decode for tiny previews.
Full images are read only on explicit preview; transient data URLs are not stored
in Zustand or persisted frontend state.

Directories are created 0700 and files 0600 on Unix. Create-new writes do not
overwrite collisions. Reads reject symlinks, are size bounded and use O_NOFOLLOW
on Unix. Deletion validates exact owned names and unlinks without recursion. Startup
recovers only generated asset names that have no database record; unknown files
are left alone. This is an app-data boundary, not a sandbox against a malicious
process already running as the same OS user.

Unsent captures, including staged ones, expire after 1, 7 (default) or 30 days.
Cleanup runs at startup, before capture, on explicit Clear temporary and at the
next expiry via a rescheduled one-shot timer. There is no periodic polling. Sent
assets remain with conversation history; V0 has no history-asset deletion UI.
Settings changes apply to existing temporary captures as well as new ones.

Capture causes no upload, provider request, analytics or network transmission.
Image bytes and window titles are never logged. Screen contents remain sensitive
local data: this is not encrypted storage or secure erasure. The trusted local
toast gets only list, asset, stage, remove and workspace-read IPC; it cannot start
a turn. Remote browser resources receive none of these native capabilities.

## Concurrent integration

Shared touch points are `SettingsPanel.tsx` (Snapshots entry and optional initial
page), `JamApp.tsx` (focus/context/Open routing), client style/index exports and the
desktop service interface/bootstrap. Preserve the new standalone Snapshot surface
when merging the Appearance branch; no theme tokens or Appearance logic changed.
Runtime/desktop startup and schema migration numbering also need normal merge review.

Both this branch and the Appearance branch allocated schema version 3. At
integration Appearance landed first, so its `003-settings.sql` keeps version 3 and
Snapshots became `004-snapshots.sql`. Snapshot preferences moved from runtime
`metadata` into that `settings` table under the `snapshots` key, beside
`appearance`; the last-focused conversation remains runtime metadata. Migration
004 is idempotent for a database created by the pre-integration Snapshots branch
(version 3 without `settings`) and carries its preference record across, so both
branches' QA databases upgrade without a reset; a runtime test covers each path.

Actual overlapping Appearance files at final review: desktop `main.tsx`; runtime
`lib.rs`, `runtime.rs`, `storage.rs`; client `JamApp.tsx`, `SettingsPanel.tsx`,
`index.ts`, `styles/index.css`; protocol `index.ts`, `preview.ts`, `types.ts`,
`validation.ts`; `ARCHITECTURE.md` and `PRODUCT.md` (since removed). No concurrent worktree was edited.
