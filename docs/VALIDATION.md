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
