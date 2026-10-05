# Validation

What is checked automatically, what has been exercised by hand on each
platform, and what has not. This describes the current alpha
(`v0.1.0-alpha`). Evidence for an individual change lives in its pull request;
this file is not a log.

Three kinds of evidence are kept apart throughout: automated tests, QA an
agent performed in the running app, and testing the developer reported doing
by hand. The browser development preview is not native validation, and
Windows testing is not macOS testing.

## Automated checks

```sh
pnpm check        # format:check, lint, typecheck, test, build
pnpm check:rust   # cargo fmt --check, clippy -D warnings, cargo test
node scripts/third-party-notices.mjs --check
```

- `pnpm lint` also enforces the package boundaries: no native, Node or
  provider imports in the shared client and protocol packages.
- `pnpm test` covers the layout tree, anchored menus and dialogs in a DOM, transport and event normalization,
  protocol validation, appearance (theme resolution and contrast floors for
  every theme), Markdown rendering safety, keybindings, architecture
  boundaries and release metadata (one version everywhere, MIT, bundled
  notices).
- `cargo test --workspace` covers migrations and upgrade of older databases,
  persistence and reopen, full-text search, retry deduplication,
  cancellation, subscriptions independent of views, real PTY terminals, Git
  status, diffs and staging against temporary repositories, branches and
  worktrees, snapshot storage, chat attachments (import, limits, cleanup,
  provider delivery), conversation archive and deletion, projects from folders,
  provider adapters
  against scripted input, the provider-history contract against a scripted
  history provider, and the desktop host's browser navigation policy.

Opt-in tests, never run by CI:

| Test                                                                                                           | What it does                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `JAM_LIVE_PROVIDERS=1 cargo test -p jam-runtime --test live_providers -- --ignored --nocapture`                | Detects the installed Claude Code and Codex CLIs, sign-in and models. No inference request.    |
| The same with `JAM_LIVE_TURNS=1`                                                                               | Sends a few short turns, an approval and an interrupt. Counts toward the signed-in plans.      |
| `JAM_UPGRADE_SOURCE=<file> cargo test -p jam-runtime --test user_data upgrade_a_copy -- --ignored --nocapture` | Upgrades a copy of a real database and reports what survived. The source file is not modified. |
| `cargo test -p jam-runtime --test git observe_large_repository_costs -- --ignored --nocapture`                 | Times status and diff reads on 10,000 tracked files. An observation, not a target.             |

## Continuous integration

Every pull request and every push to `main` runs:

- **Web** (Linux): `pnpm check`, then the third-party notices check.
- **Rust** (Windows and macOS): `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo test --workspace`. A pull request that changes no Rust, Cargo or
  workflow file skips these jobs; `main` always runs them.

The Release workflow runs both check suites again on Windows and macOS,
verifies that the tag matches the app version, and only then builds the
installers (see [RELEASING.md](RELEASING.md)).

## Platform status

### Windows

Exercised on Windows 11 Pro 25H2 (x64) with WebView2 153, Claude Code 2.1.284
and codex-cli 0.159.0, in a release build with its own application
identifier. This was agent QA; the developer watched and interacted during
part of it.

Verified:

- The NSIS installer: per-user install, Start menu shortcut, bundled license
  and notices, silent uninstall leaving application data in place. The
  installer is unsigned, as documented.
- First run with no projects, both agents detected with versions and sign-in
  state.
- New project with the native folder picker, several folders, a plain
  (non-Git) folder.
- Claude Code and Codex chats: streaming, approvals, Stop and follow-up,
  closing a tab without stopping its turn, resume after Quit and relaunch, a
  Codex chat in a new worktree on its own branch.
- Terminal over ConPTY (PowerShell 7): Unicode, color, scrollback, copy,
  paste, find, resize, restart, Ctrl+C.
- Browser (WebView2): HTTPS and localhost, navigation, geometry under splits
  and resizes, two browsers, element and region annotations staged without
  sending.
- File browser, Review (status, rename, Unicode, diff), Settings → General
  and Projects, removing a project without touching its files.
- Window chrome: custom titlebar, snap layouts, edge resize at 100% scale,
  tray, close to tray, single instance.
- Quit ends every process JAM Code started and leaves the user's own Claude
  and Codex processes alone.
- Upgrade of a development database: real chats kept, demo seed removed,
  backup written.
- Arranging the sidebar, in a development build with the demo database:
  dragging a section and a project by its grip, Alt+arrow moves, Escape
  canceling a drag, the order kept across a reload, and a chat rising in
  Recent when it finishes or asks for approval. Resizing History by its
  bottom edge and from the keyboard, the height kept across a reload, the
  double click that shows every chat, and the sidebar scrolling once its
  sections no longer fit.

Not verified:

- Windows 10, and display scales other than 100%.
- The installed build against real user data (it was installed and
  uninstalled, not launched).
- Agents installed as `.cmd` or `.ps1` shims rather than native executables
  (issue #7).
- Tray Quit while a chat is running; keyboard shortcuts under automation
  (synthetic keys do not reach the web view).
- The shared-client changes that landed with the macOS QA pass (terminal
  focus, the chat pane's close button, tab-strip scrolling, Settings search
  focus).

### macOS

Exercised in development builds (a debug `.app` with its own application
identifier), with Claude Code 2.1.283 and codex-cli 0.157.1.

Verified:

- Window chrome: traffic-light position in the expanded sidebar, the
  collapsed rail and dedicated Settings; the application menu, ⌘W closing a
  tab and ⌘. toggling focus mode.
- Claude Code and Codex chats: sign-in and model detection, streaming,
  approvals and questions, Stop, resume after the app was killed and
  relaunched, compaction, file links, web preview of a local server.
- Terminal (zsh): color, Unicode, scrollback, copy, paste, find, resize,
  several terminals, shells surviving a closed pane, Quit ending them.
- Browser (WKWebView): positioning and clipping in every layout, overlays,
  focus, navigation, isolation from JAM Code's own IPC, annotations.
- Review against a real repository; project icons; tab reordering.
- Snapshots: capture of another application's window without taking focus,
  staging into the last-focused chat, the toast, retention settings. The
  both-Shift shortcut was operated by the developer.
- Appearance: a saved theme applied natively after a restart.
- The developer reported a manual pass of the integrated alpha build. One
  item, right-click on text, was fixed afterwards and its recheck is pending.

Not verified:

- The packaged universal `.app` and `.dmg`: installation, ad-hoc signing and
  Gatekeeper behavior on a clean Mac.
- Intel Macs and macOS 14, the minimum supported version.
- The native folder picker and the smart-quote fix (issue #8) have no
  recorded macOS check.
- Notifications, which need a bundled build to judge.
- Snapshots with full-screen, protected or multi-display windows, Secure
  Input, and clipboard copy end to end.
- Live re-theming of the Terminal and Browser chrome in every theme.
- Arranging the sidebar by dragging sections and projects, and resizing
  History.

### Both platforms

Not done: assistive-technology testing, large-history performance, provider
versions other than those listed, Claude sub-agent text, Codex questions
(unsupported), and sessions past the 15-minute idle stop.

Not verified in the native app on either platform, only by automated tests and
the browser preview: the native file chooser for chat attachments; an
attached file, PDF or image opened by the real Claude Code and Codex (Codex
is given no folder grant and its read access to JAM Code's copies is untested); archiving and
deleting a conversation; menus drawn in the overlay host over a blurred
wallpaper and over a Browser page; and the gutter between the sidebar and the
workspace.

## Release acceptance

Before publishing a release, on each platform, with the release build:

1. Install on a clean machine or account; confirm the unsigned-build prompt
   matches the README.
2. First run shows no projects and detects the installed agents.
3. Add a project with the native folder picker.
4. Run a real Claude Code chat and a real Codex chat: approve an action,
   stop a turn, send a follow-up.
5. Start a chat in a new worktree and confirm the branch and folder.
6. Open a Terminal, the Browser, a file and Review beside a chat; switch
   Single and Tiles; close and reopen panes while a turn runs.
7. Search for a phrase from a chat and open the result.
8. Change a theme and a General setting; Quit, relaunch and confirm that
   history, settings and the chats' resume all hold.
9. Upgrade from the previous build's data and confirm nothing is lost.
10. Compare the downloaded installers against `SHA256SUMS.txt`.

## Performance

No performance target is claimed. One measurement exists: a Windows release
build with one project and no chat open used 0.05 s of CPU over 60 s idle
(0.08% of one core), with 209 MB private and 372 MB working set across the app
and its six WebView2 processes, and no provider, Git or shell process running.
Startup time has not been measured, and nothing has been measured on macOS.

To measure:

- Use release builds, a fixed machine, window size and corpus, and five cold
  plus five warm launches. Record the runtime's startup timestamp and the
  frontend's `jam-bootstrap` to workspace-loaded mark; report median and p95
  with the OS, build, corpus size and WebView version.
- Measure the private working set or RSS of the app and all its WebView
  child processes together, then CPU after 60 seconds idle and while
  streaming a bounded turn. One executable's RSS is not the app's footprint.
- For search, seed a disposable synthetic corpus of 10,000 conversations and
  100,000 messages outside the repository, and record median and p95 query
  latency by query type with the result cap.
- For Git, run the `observe_large_repository_costs` test above.

Transcript pagination and virtualization are required before large histories
are imported; a conversation currently returns its latest 500 messages.
