# jam

JAM Code is a local-first desktop workspace for coding agents. This repository is the initial architecture and running-shell milestone: Paper-derived UI, shared product/protocol packages, a Tauri host and a Rust runtime with SQLite/FTS5.

**Agent chats run your installed Claude Code or Codex** through their structured local interfaces (`claude` stream-json and `codex app-server`), in the project's folder, with each CLI's own sign-in. JAM never reads provider credentials; see [providers](docs/PROVIDERS.md) and [ADR 0011](docs/adr/0011-live-providers.md), including the unresolved question of Claude subscription use by third-party apps. A deterministic demo provider remains for tests and the browser preview and is off by default in the desktop app. Conversations persist locally. Browser development preview is in memory and resets on reload. Terminal is a real shell in a runtime-owned PTY (see [ADR 0006](docs/adr/0006-terminal-sessions.md)); agents never run commands in it. Browser embeds the platform webview in the desktop app only (not the web preview) and loads real pages (see [ADR 0007](docs/adr/0007-native-browser.md)). The file browser serves an isolated demo tree. Review uses the installed Git CLI for real status, selected-file diffs and explicit file stage/unstage. Configure the project’s first folder in project details; see [ADR 0010](docs/adr/0010-git-review.md). Real files open read-only from Review.

## Run

Install Node 22.13+ (22 LTS or a compatible newer LTS), pnpm 12.6, stable Rust with rustfmt/clippy, and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Windows requires MSVC C++ build tools and WebView2; macOS requires Xcode command-line tools.

```sh
pnpm install
pnpm desktop
```

For the browser-only visual preview, run `pnpm dev` and open `http://127.0.0.1:1420`. It is not a remote client and has no machine access. Production frontend builds require the Tauri host.

If the machine's pnpm launcher is broken, use `npm exec --yes --package=pnpm@12.6.0 -- pnpm install` and the same prefix for other pnpm commands. No global repair is necessary.

Closing the native window hides it when the tray is available. Use the jam tray menu to Show or Quit. Pane/tab closure only hides a view. Explicit Quit interrupts running turns and ends provider processes; persisted history remains and chats resume by the provider's own session ID. Application data lives under the platform application-data directory, outside this checkout, in an isolated demo database.

## Validate

```sh
pnpm check
pnpm check:rust
```

The frontend checks format, lint, strict types, core/contract tests and production build. Rust checks include format, workspace check, clippy with warnings denied and tests. See [validation and manual tests](docs/VALIDATION.md) for native UI evidence, known limits and measurement procedures.

## Repository map

| Path                | Responsibility                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| `apps/desktop`      | Vite entry, native services/transport, Tauri host                      |
| `packages/client`   | Shared React workspace, semantic design tokens and presentation state  |
| `packages/protocol` | Platform-neutral types/validation and development-only preview fixture |
| `crates/runtime`    | Rust domain, provider adapters, sessions, SQLite and search            |
| `docs`              | Product, design, provider research, architecture and ADRs              |

Start with [product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [design](docs/DESIGN.md) and [providers](docs/PROVIDERS.md). The architecture reserves future remote clients without implementing a network server. Provider capability differences are described, not hidden.

No JAM account, remote access, capture shortcut, production editor or release packaging is implemented; Browser is a prototype. Windows and macOS need separate hands-on validation. The owner has not yet selected a public license.
