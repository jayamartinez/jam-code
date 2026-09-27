# Foundation validation

This document describes reproducible checks and the boundary of their evidence. Current implementation results are recorded below. Automated interaction is not developer-reported manual testing.

## Automated gates

- `pnpm format:check`: repository text formatting.
- `pnpm lint`: TypeScript/React lint plus forbidden native/provider imports in shared packages.
- `pnpm typecheck`: strict contract/client/host checks.
- `pnpm test`: core layout, transport/normalization and architecture boundary tests.
- `pnpm build`: production frontend compilation; development preview is excluded.
- `cargo fmt --all --check`, `cargo check --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.

Native runtime tests cover migration/seed idempotence, persistence/reopen, FTS queries, retry deduplication and view-independent subscriptions. UI checks must verify native IPC as well as browser rendering; neither substitutes for the other.

## Manual acceptance sequence

1. Run `pnpm desktop`. Confirm the compact Nightglass sidebar/tabs and lowercase jam mark. No provider login or credential prompt should appear.
2. Open several conversations from history. Switch Single/Tiles. Close and reopen a tab; the transcript should remain available. Collapse/reopen the sidebar.
3. Send an ordinary mock message. Observe streamed response/tool state and completion. Submit `/fail` to check honest failure, then recover with another message.
4. Send, interrupt promptly, and confirm no late completion overwrites interrupted state. Send again; switch resources or hide/reopen the window while it runs. Work must continue independently of view visibility.
5. Search a distinctive phrase you sent. Open the result. Quit from the tray, relaunch, and verify native history/search persist. Browser preview deliberately resets on reload.
6. Open Settings via footer and Ctrl/Cmd+,; return via Escape. Open Settings as a resource if available. Only mock is enabled; installed/authenticated live-provider state is unknown, not fabricated.
7. Resize to 960×640 and 1440×900. Check composer visibility, independently scrolling history/transcript, keyboard focus rings, accessible labels and no horizontal document overflow.
8. Verify the native close/hide/reopen/Quit flow. Repeat on macOS before making cross-platform claims.

Deferred functions must be visibly labeled or disabled. No demo command should execute on the computer. No attachment should send without explicit submission.

## Visual comparison

Compare the running shell against Paper's Windows Single and Windows Tiled frames, plus the semantic token frame. Inspect 280px sidebar, 44px titlebar, 42px pane header, 6px tile gaps, 8px outer padding, max-width 700px single conversation, compact typography and subtle translucent surfaces. The semantic token `container-thread` is 640px while the actual Single frame uses 700px; follow the frame per surface. Check collapsed rail at 56px separately.

The intentional branding deviation is a lowercase text mark instead of the provisional abstract icon. Mock labels and disabled future controls are intentional honesty requirements. Paper's provider/model/version/count numbers are design examples, not live facts.

## Resource and layout milestone (2026-09-26, macOS)

Automated gates run on macOS 15 (Darwin 25.3), Node 22 via the documented
`npm exec` pnpm workaround, Rust stable:

| Check                                                                              | Result                                                                                                                        |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                 | Passed                                                                                                                        |
| `pnpm test`                                                                        | Passed: 60 tests across seven files, up from 37                                                                               |
| `pnpm build`                                                                       | Passed; CodeMirror is a separate 291 kB chunk and each language mode is its own chunk, so none of it is in the startup bundle |
| `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` | Passed                                                                                                                        |
| `cargo test --workspace`                                                           | Passed: 14 tests, including the file service and file-resource identity                                                       |

New automated coverage: split right, split down, nested splits, ratio clamping,
pane focus, closing a pane versus closing a resource tab, Single ↔ Tiles round
trips preserving both the arrangement and every resource identity, two
conversations in one arrangement, promoted drafts staying in their pane,
one-level directory listings, path-escape rejection, and file resources keeping
one identity per path across a runtime restart. Boundary tests now fail if the
layout tree names a resource kind or if the tile renderer imports a resource
surface.

The development build was restarted under `pnpm desktop` so the running
application serves the new client with hot reload.

**Visual comparison.** The client was rendered headlessly at 1440x900 against
the development server and compared with the Paper frames. Verified on screen:
the launcher's 600px width, 42px drop below the titlebar and centring on the
main region; its Agents/Tools sections, project column and honest disabled
states; provider icon density across pinned, history, tabs and launcher rows;
Single to Tiles; split right and split down; the empty-pane affordance; a
Claude conversation and a Codex conversation side by side, each with its own
composer; the file browser's lazy tree, git status letters and branch footer;
opening a file into a different pane; the File resource's path metadata,
`Read-only` and `Demo tree` labels, gutter and syntax highlighting; a file
above a terminal nested inside a split with the browser, built from generic
splits only; and a Single/Tiles round trip restoring all three panes with
resource identities intact.

Four defects were found this way and fixed: the launcher's project badge was
stretched by an inherited `flex: 1`; a disabled launcher row rendered both its
hint and a redundant "Unavailable" chip; the initially focused launcher row had
no visible highlight because the rule used `:focus-visible` after a
programmatic focus; and a pane header wrapped to three lines at tile width,
which now drops the branch and then the project label by the header's own
width through a container query. Opening a file also preferred an arbitrary
pane and could displace a working conversation; it now prefers a pane already
showing a file, then an empty pane.

**Not verified.** Two things still need a hands-on pass. The macOS native
traffic lights cannot appear in a browser render, so the titlebar inset,
spacing and drag regions from Issue 1 are implemented from the frame's
computed styles but unconfirmed on screen; computer use was unavailable this
session because Accessibility and Screen Recording were not granted. Windows
was not run at all, so the claim that its chrome is unregressed rests on the
platform-conditional code paths and unchanged Windows CSS, not on observation.
The headless render also exercises the browser preview transport, not the
native SQLite runtime, so these are rendering and interaction checks rather
than native IPC checks.

## Tabs, panes and Files milestone (2026-09-26)

`pnpm format:check`, `lint`, `typecheck`, `build`, `cargo fmt --all --check`
and `cargo clippy --workspace --all-targets -- -D warnings` pass. 64 frontend
tests across eight files and 15 runtime tests pass, including: selecting a tab
while an empty pane is focused switches the workspace rather than filling that
pane; each tab keeping its own arrangement; pane resources staying out of the
tab bar; tab reordering; a promoted draft carrying its tab, tree and text; and
a save round trip persisting a working copy across a runtime restart while
leaving other files and the shipped fixture untouched.

Verified by rendering the client headlessly at 1440x900 against the development
server and reading the screenshots: tab selection no longer assigns into an
empty pane; splitting creates no tab; the file browser stays visible when a
file opens, with the file landing in a pane beside it; the tree keeps its
expansion across that reshape; browser, editor and terminal form the Files
frame's arrangement from generic splits; File, File Browser and Review remain
three distinct panes; typing marks the editor dirty and Cmd/Ctrl+S clears it;
and both icon themes render at the same geometry.

Defects found this way and fixed: the provider mark was stretched to half-width
in search results and new-chat suggestions by an ambient `span { flex: 1 }`; the
branch chip drew its icon over its text; a pane header wrapped to three lines at
tile width; the file tree collapsed whenever a file opened; the browser header
clipped its project name at 250px and its footer wrapped; a Rust manifest
carried the Node package mark in both themes; and the first JAM glyph set was
illegible at 14px and was redrawn mark-first.

**Not verified.** The macOS native traffic lights still cannot appear in a
browser render, so Issue 1's titlebar geometry remains implemented from the
frame's computed styles and unconfirmed on screen; computer use was unavailable
because Accessibility and Screen Recording were not granted. Windows was not
run. The headless route exercises the browser preview transport, so saves were
confirmed against the preview's in-memory store in the browser and against
SQLite only through runtime tests, not through the native app. Tab drag-and-drop
reordering was implemented and type-checked but exercised only through its
keyboard path and unit test, not by dragging in the running app.

## Appearance and project identity pass (2026-09-26)

The whole gate passes again: format, lint, typecheck, build, `cargo fmt`,
`cargo clippy -- -D warnings`, 64 frontend tests and 15 runtime tests.

Verified by headless render: the editor now resolves to Geist Mono rather than
the browser's default serif (`.cm-scroller` computes to the Geist Mono Variable
stack); the Appearance settings page changes editor family, size and line
height with a live preview; project icon presets and image upload are offered
per project; tab badges appear once more than one project is open; and
pointer-based tab reordering moves a tab from index 0 to index 2.

The editor font was regressing because the CodeMirror theme used `var(--font-mono)`
alone. That token holds the design's family _name_, `Geist Mono`, which is not a
loaded family, so the editor fell through to a serif default while every other
mono surface used the full stack.

**Not verified.** The macOS Settings header inset was confirmed only as a
computed value of 78px under a simulated platform class; the native traffic
lights themselves still need a look on macOS, as does Issue 1's titlebar
geometry. Windows was not run. Project icon images were exercised through the
squaring helper's code path in the browser only — no image was uploaded end to
end, and image icons have not been round-tripped through the native SQLite
runtime, only through the preview transport and runtime validation.

## macOS chrome, verified on screen (2026-09-26)

Computer use became available once Screen Recording was granted to the Claude
desktop app. The Tauri dev executable is a bare binary that computer use cannot
target, so the app was run as a debug `.app` bundle (`pnpm tauri build --debug
--bundles app`), which registers as `jam`.

Three real macOS defects were found and fixed by looking at the native window:

- **Traffic lights sat about 7pt above the titlebar row.** Tauri's
  `traffic_light_position.y` is not a distance from the top: wry sets the
  titlebar container to `button height + y`, and the buttons keep their own
  offset inside it. `y = 16` centred them near 15pt; the 44pt titlebar row is
  centred at 22pt. `y = 23` puts the lights on the same line as the tabs and
  the sidebar header's controls.
- **The dedicated Settings title touched the green light.** Its header now
  starts at 88px: the lights span 18–70px, and the title keeps the same 18px of
  air on their right that they keep from the window edge.
- **With the sidebar collapsed, the green light covered the first tab.** The
  56px rail is narrower than the lights; the titlebar now starts its tabs 32px
  in from the rail so they clear the lights by the same 18px.

Verified in the running native app: expanded sidebar, dedicated Settings and
collapsed rail. Windows was not run.

## Editing, tabs and cross-platform pass (2026-09-26, macOS)

Checked in headless Chromium against the preview transport (a 16-step sweep:
send, failure, interrupt, search, shortcuts, launcher anchoring, tiles, file
open and save, status colours, tab drag, project editing with emoji, glyph and
image, appearance, sidebar) and then in the native debug `.app`.

Defects found and fixed in this pass:

- **Custom images "could not be read"** natively: object (`blob:`) URLs are
  refused by the desktop CSP. Images now load as `data:` URLs. A dark
  transparent logo is given a light backing. Verified by uploading an SVG
  through the native macOS file sheet.
- **Modified status letters were uncoloured**: they used a `.warning` class
  that does not exist. Status letters and names now use `status-*` classes.
- **Dragging a tab selected it, then did not move it in WebKit.** The click
  after a drag is now suppressed. Separately, WebKit started a text selection
  from the press, which swallowed the drag; the press now prevents default and
  captures the pointer. Chromium never showed the second defect, so the
  headless sweep could not catch it — it was found and verified natively.
- **The launcher ignored Escape and outside right-clicks natively**; it now
  listens at window level and closes on blur, and its `+` toggles.
- **The native WebView menu (Reload, Inspect Element) opened over JAM's own
  menu** when right-clicking inside it. JAM's menus swallow the event, and the
  desktop host suppresses the WebView menu except over editable or selected
  text. Right-clicking a sidebar row also selected the word under the pointer;
  the sidebar is no longer selectable text.
- **Codex chats showed a neutral or Claude mark** in a new chat's composer and
  its "Continue in" rows. The draft and each row's session now supply it.
- **The file browser shrank to ~120px** beside a chat; its split ratio now
  comes from the pane's real width. Web preview on a Mac used Ctrl shortcuts;
  it now follows the Mac modifier.

Verified natively on macOS: launcher anchored below `+` and toggling closed;
tab reorder without selection; editor gutter; coloured `A` status; project
context menu, editor, emoji and glyph badges, and image upload with backing;
the Codex mark. Not verified: Escape and typed input under computer use,
because synthetic keystrokes did not reach the WebView in this session (clicks
did) — Escape is covered in Chromium only. Windows was not run; the path
placeholder, emoji-picker hint (Win + .), Ctrl shortcuts and context-menu
suppression are written for it but untested there.

Once, natively, a modal dialog opened without painting (Escape dismissed it).
It did not recur and no cause was found; no speculative fix was made.

## Project threads, pinned projects and sentence-case labels (2026-09-26)

Automated: the runtime proves closing is explicit, survives restart, is
refused for non-conversations and unknown IDs, and is undone by sending; that
Keep open persists; and that project pinning persists and clears. The preview
transport repeats those cases, validation rejects malformed thread requests,
and client tests cover open/closed ordering, the suggestion rule (including
the Keep open snooze, running sessions and "never"), pinned ordering and
compact ages. Headless Chromium drove the sidebar end to end with the
threshold at one day: one prompt at a time, amber ages, close, Closed group,
Keep open moving the question on, reopen from the menu, collapse and switch
projects, pin ordering and mark, and a send reopening a closed thread. No
computed uppercase remains on any label.

Not yet verified in the native app or on Windows. The demo seed's
timestamps are fixed, so with the seven-day default no seeded thread looks
idle until a week has passed; set Settings → Threads to one day to see the
prompt.

## Multi-project threads, Codex colour mark and search recents (2026-09-26)

Headless Chromium: three projects expanded together and collapsing one left
the others; the Codex mark renders the gradient with no white tile and every
instance has a unique gradient ID; search lists recent chats before typing,
remembers a search only after its result is opened, runs a recent search on
Enter, opens a recent chat with arrow and Enter, and clears. One defect was
found and fixed: a row rendered under a resting pointer took the selection on
`mouseenter`, so Enter opened a chat instead of the recent search; selection
now follows pointer movement only. A client test covers recent-search
ordering, de-duplication and bounds. Native rendering of the gradient mark is
checked below the gate; Windows was not run.

## Terminal (2026-09-26, macOS)

Automated: `pnpm check` (84 frontend tests) and `pnpm check:rust` pass. Runtime
tests start real PTYs with `/bin/sh`: several independent terminals with
distinct titles, input and output in order, ANSI and UTF-8 output, `stty size`
following resize, detaching a view and a window reload leaving the shell
running with output replayed on reattach, two views of one terminal, a shell
that exits by itself reporting its code and restarting in the same resource,
explicit termination ending the shell and its foreground job, Ctrl+C
interrupting only the foreground program, a requested working directory, flow
control pausing near 256 KiB for a view that never acknowledges and resuming
when it does, Quit refusing further requests, and invalid requests failing
before any shell starts. Client tests cover ordered input, split pastes,
coalesced resizes, acknowledgement steps, restart clearing the screen, and a
closed view detaching without ever sending `terminal.kill`.

Native, in a debug `.app` built from this branch with a temporary identifier so
it could not share the running app's single-instance lock or database: created
a terminal beside a conversation; `pwd` at home with the "has no folder" note;
`TERM`/`COLORTERM`; 16 ANSI colours, true colour, underline and bold;
arrows, CJK, a double-width emoji, λ and box drawing; 3000 lines and
scrollback by wheel and scrollbar; Ctrl+C (exit 130); double-click selection,
⌘C (clipboard read back) and ⌘V; ⌘F find with a match count; dragging the
split changed `stty size` to 42×111; a second terminal on its own tty below the
first; a running loop kept ticking while its tab was not shown and while its
pane was closed, and was reopened from the launcher's Running list;
Single ↔ Tiles; Terminate shell released its tty while the other shell ran
on; Restart shell; terminal above a file browser and file; Quit ended both
shells (checked with `ps`).

Found and fixed natively: zsh's end-of-line mark stuck on the first row
because the shell started at 80 columns inside a 77-column view (shells now
start at the pane's size); explicit termination read as "exited with code 1"
(now "Shell terminated"); two terminals were indistinguishable (now `zsh`,
`zsh 2`); the launcher overflowed the window once Running rows arrived.

Not verified: Escape in the find field (synthetic Escape does not reach this
WebView under computer use); a window reload in the native app (covered by the
runtime test only); Windows and ConPTY, which were neither compiled nor run
(the Windows shell selection and key handling are written but untested); the browser preview,
which reports terminals as unavailable by design. Flow control was measured
in tests, not under a real flood in the app; memory under many terminals was
not measured.

## Native Browser prototype (2026-09-26, macOS 26)

Automated: format, lint, typecheck, 79 frontend tests (13 files) and the
production build pass. `cargo fmt`, `cargo clippy --workspace --all-targets
-- -D warnings` and `cargo test --workspace` pass, including the host's
navigation policy (typed navigation, and what a page's frames may load),
resource-ID and bounds validation tests, the runtime test that every browser
open is a distinct durable resource, and the preview transport's equivalent.
Client tests cover address parsing and overlay occlusion counting.

Native checks were run in a debug `.app` built with a CLI config override
(`identifier dev.jamcode.desktop.browser`, product `jam browser`). That gave it
its own single-instance lock and demo database, so a running `jam` was
untouched. The page used was a local test server with edge and corner markers,
an input, links and an IPC probe. Verified on screen through computer use:

| Requirement                  | Result                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Creation                     | The first navigation creates the WKWebView; blank browsers show JAM's own prompt                                                                                   |
| Positioning / clipping       | Edge border and all four corner markers visible inside the 12px well, in every layout below                                                                        |
| Resize with pane             | Split drag (547→796px), sidebar collapse (move + grow to 956px), window resize to minimum (819×656) and the annotation tray appearing (780→728px tall) all tracked |
| Split down                   | Page clipped to the upper pane; the pane below is uncovered                                                                                                        |
| Z-order / overlays           | Search dialog, launcher and pane menu each hide the page while open; it returns with state intact                                                                  |
| Focus / keyboard             | First click focuses the page; typing reaches its input; clicking JAM returns focus and ⌘K works again                                                              |
| Shortcuts while page focused | **Limitation:** ⌘K goes to the page, not JAM                                                                                                                       |
| Navigation                   | Typed localhost and bare `example.com` (to https) load; `target=_blank` stays in the pane; Back/Forward enable from the Navigation API and work                    |
| `file:` link                 | Not followed (refused by WebKit before JAM's hook; no notice shown)                                                                                                |
| IPC isolation                | The page's `invoke('jam_request')` is denied: "not allowed on window main, webview browser-…, allowed on webviews: main"                                           |
| Multiple browsers            | Two browsers in two tabs, each keeping its page and history across tab switches                                                                                    |
| Lifecycle                    | Closing a pane or switching tabs hides the page; "Close browser page" destroys it and the pane returns to blank; navigating again starts a new history             |
| Element annotation           | Picker highlights in-page, captures selector, styles and console (1 error), and stages a chip into the adjacent conversation without sending                       |

A defect was found and fixed natively. After "Close browser page", the pane
kept its old address and raised a generic runtime error, because it was still
sizing a destroyed view. Views are now created lazily and closing resets them
to blank. Host rejections now reach the banner with their real message.

**Not verified or known gaps.** Windows/WebView2 was not run. Synthetic Escape
did not reach JAM's dialog under computer use (the × button was used). Escape
inside the picker is untested natively. Memory per page was not measured.
Region capture, screenshots, network inspection and devtools are not
implemented. Once its pane is closed, a live page has no UI path back other
than reopening that resource, and browser resources are not yet listed in
the sidebar; the eight-page cap bounds this. Page title does not yet update
the tab title. The last URL is not persisted across restarts.

### Follow-up: traffic lights and annotate mode (2026-09-26)

**Traffic lights regressed** with the Browser branch. The lights sat a few
points above the titlebar row. The cause is in Tauri: its `unstable` feature,
needed for child webviews, builds even the main webview as a child view, and
wry applies `traffic_light_position` only to a window's content webview. The
main window is now built from a `WindowConfig`, which sets the inset on the
window itself. Verified on screen: the lights are level with the tab row at
launch, after a window resize, and with the sidebar collapsed to the rail.
The same Tauri path skips the Windows edge-resize handler for undecorated
windows. The host re-asserts resizability for it, but that is unverified
without Windows.

**Annotate mode** replaces separate Element and Region tools. Verified in the
native app: a click opened "Comment on element 1" below the heading. Typing
and Enter added it with a numbered marker. A drag became "Comment on region 2"
with a dashed rectangle, and the Add button stacked it. The tray read "2
annotations · 1 element · 1 region · console (1 error)". Turning the mode off
made the page interactive again (its pushState button updated the address)
with the markers kept. "Add to" staged two chips that lead with their
comments, cleared the markers, and sent nothing. Cancel works. Escape could
not be verified: computer use's synthetic Escape reaches no web content (the
page's own key logger recorded the keys typed before and after it, but not
Escape), so Escape needs a real keyboard. Client tests cover the staged
description text.

## Appearance, editor and Markdown (2026-09-27, macOS)

Automated: `pnpm check` (130 tests) and `pnpm check:rust` pass. New tests cover
the appearance contract in TypeScript and Rust (shared fixture, strict
validation, restart persistence, wallpaper bounds), theme resolution (the
resolver reproduces tokens.css exactly; every theme has every role; accent
never changes status, code or terminal colours; contrast floors per theme),
the appearance store (immediate apply, coalesced and ordered saves, late
runtime answers, failed saves), language detection (one fixture checked by
both the runtime and the preview; every grammar loads and produces semantic
classes), and Markdown security (raw HTML, event handlers, `javascript:`,
`data:`, `file:`, `tauri:` and control-character schemes, remote images).

Visual QA used an isolated build: identifier
`dev.jamcode.desktop.appearance-qa`, its own app-data database and dev port,
so the main build's single-instance guard and demo database were untouched
(the new migration would otherwise make an older build refuse the shared
database). Another agent was driving the shared screen, and computer-use
screenshots were refused in this session, so:

- **Browser preview, scripted through the DevTools protocol in headless
  Chromium at 1440×900:** all six themes across sidebar, tabs, file browser,
  Markdown preview and Settings; the Appearance page; interface 15px with the
  system font, Menlo 14/22 in the editor; gradient background with 62% panes;
  an image wallpaper chosen through the real file input (downsized to
  2560×1600 WebP) with brightness, blur and 24px pane blur; the editor with
  TSX, Python, JSON, `.gitignore` and `.env.example`; the demo report in
  Preview and Source. The Settings navigation at 2× matches Paper's frame; the
  only differences are live data ("1 on") and the unimplemented ⇧⇧ hint.
- **Native (WKWebView) app, window capture only, no input:** a Frost + Violet
  record written to the QA database was applied after a restart, confirming
  runtime persistence and native theming of the workspace.

Not verified by eye: the native Terminal's live re-theming and font change
(xterm reads the same roles; covered by code, not by a screenshot), native
Browser chrome in each theme, and Windows. Browser preview is not native
validation.

Bundle (production build): the main chunk is 412 KB (129 KB gzip), up from
387 KB (121 KB gzip) before this pass — theme data, resolver, store and
Settings icons. The Appearance page (5 KB gzip), Markdown preview with
markdown-it (44 KB gzip) and each grammar are separate chunks loaded on first
use; the largest grammar chunks (HTML, Python, YAML, SQL) are 12–33 KB gzip.
CSS grew from 70 KB to 91 KB (16.5 KB gzip).

`tauri build` refuses the repository's existing mismatch between the `tauri`
crate (2.12) and `@tauri-apps/api` (2.11); the QA bundle was built with
`--ignore-version-mismatches`. The mismatch predates this branch and is not
changed here.

## Performance measurement procedure

Use release builds for product claims, fixed machine/window/corpus and five cold launches plus five warm launches. Record runtime startup timestamp and frontend `jam-bootstrap` to workspace-loaded mark. Record median/p95, OS/build, corpus size and installed WebView version.

Measure total private working set/RSS of the runtime and its WebView descendants, then CPU after 60 seconds idle and while streaming a bounded turn. Do not call a single executable's RSS the whole app footprint. No idle timers/network polling should be needed.

For FTS, seed a disposable synthetic corpus of 10k conversations/100k messages and record median/p95 query latency, query types and result cap. Keep benchmark data outside source. Add pagination/virtualization and event batching before large real history import. No startup/memory/search performance target is claimed achieved by small demo tests.

## Current-run results

Validated on Windows on 2026-09-26 with Node 22.19, pnpm 12.6, Rust 1.97.1/MSVC, Chromium and the installed WebView2 runtime.

| Check                                                         | Result                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Frozen-lockfile installation                                  | Passed; four workspace projects, no lockfile changes                                                                      |
| Prettier, ESLint, TypeScript                                  | Passed                                                                                                                    |
| Frontend/contract tests                                       | Passed: 37 tests across six files                                                                                         |
| Production frontend build                                     | Passed; preview transport excluded, demo resource renderer is a separate lazy chunk                                       |
| Rust formatting, workspace check, Clippy with warnings denied | Passed                                                                                                                    |
| Runtime tests                                                 | Passed: nine tests, including persistence, FTS, cancellation, retry receipts, overflow recovery and failed-write handling |
| Native debug build and `pnpm desktop` startup                 | Passed                                                                                                                    |
| Public-source hygiene                                         | Passed; private references, screenshots, data and build output are not Git candidates                                     |

Browser interaction checks passed for new chat/first send, stop, requested failure and recovery, draft retention, search/open, dedicated and resource Settings, sidebar collapse, focus, and both layouts. At 960×640 the document had no horizontal or vertical overflow; transcript and resource panes retain their own scrolling. Long sidebar branch labels may truncate at the minimum width.

Native WebView checks exercised the actual Tauri transport and SQLite runtime: sending, closing a view during a running turn, reopening its completed transcript, `/fail`, explicit Stop, and completing work while the window was hidden. Launching a second executable retained one host and reopened its window. After stopping and restarting the app, the new conversation, transcript and FTS result remained available under a new runtime epoch. A context-only submission left the transcript unchanged while staged, then persisted a context block after explicit Send. A final page reload rendered without a Vite overlay or reported browser errors.

The native content was inspected through Computer Use and then tested through a temporary, loopback-only WebView2 debug connection using [the documented WebView2 testing mechanism](https://playwright.dev/docs/webview2). The debug connection is test tooling, not a product remote-access implementation, and is not enabled by normal startup.

The final ordinary native launch was independently verified through Windows accessibility: the conversation, composer and Mock controls were present, and the temporary debug port was closed. A redundant standalone-browser smoke check at that point timed out in the automation connection; the successful earlier browser checks and direct native checks above are the functional evidence.

Single and Tiles were compared against the canonical Paper frames. Corrected tab order, transcript density, tool-label wrapping, newest-first history and Tiles column width. Final native measurements at 1440×900: Single conversation/composer 700px; Tiles 640px; secondary column 408px. Focus uses 720px and suppresses the duplicate pane header. After-only app screenshots are in ignored `output/playwright/`, including `native-single-final.png` and `native-tiles-final.png`; no Paper or private reference images were copied into source.

A development-only issue appeared when Windows formatting briefly truncated files and Vite cached an empty transform. The watcher now waits for stable writes; the final source was formatted, rebuilt and reloaded successfully. Standard pnpm startup works through the documented npm-exec workaround for this machine's broken global pnpm launcher.

Not run: macOS native build/interaction, a packaged or signed release, large-history performance benchmarks, assistive-technology testing, and developer manual testing. Tray Quit's UI interaction still needs a hands-on pass; graceful shutdown is covered in runtime tests. Mock-only integration is intentional: real providers, PTY/editor/browser services, snapshots and remote access are not implemented. No performance target is claimed from this small demo corpus.
