# jam

JAM Code is a local-first desktop workspace for coding agents. This repository is the initial architecture and running-shell milestone: Paper-derived UI, shared product/protocol packages, a Tauri host and a Rust runtime with SQLite/FTS5.

**This build uses a deterministic mock provider.** It does not call Claude/Codex, use credentials, execute displayed commands or edit project files. Native demo conversations persist locally. Browser development preview is in memory and resets on reload. Terminal and review are static demos. The file browser serves an isolated demo tree. Browser embeds the platform webview in the desktop app only (not the web preview) and loads real pages.

## Run

Install Node 22.13+ (22 LTS or a compatible newer LTS), pnpm 12.6, stable Rust with rustfmt/clippy, and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Windows requires MSVC C++ build tools and WebView2; macOS requires Xcode command-line tools.

```sh
pnpm install
pnpm desktop
```

For the browser-only visual preview, run `pnpm dev` and open `http://127.0.0.1:1420`. It is not a remote client and has no machine access. Production frontend builds require the Tauri host.

If the machine's pnpm launcher is broken, use `npm exec --yes --package=pnpm@12.6.0 -- pnpm install` and the same prefix for other pnpm commands. No global repair is necessary.

Closing the native window hides it when the tray is available. Use the jam tray menu to Show or Quit. Pane/tab closure only hides a view. Explicit Quit stops mock work; persisted history remains. Application data lives under the platform application-data directory, outside this checkout, in an isolated demo database.

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
| `crates/runtime`    | Rust domain, mock provider, sessions, SQLite and search                |
| `docs`              | Product, design, provider research, architecture and ADRs              |

Start with [product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md), [design](docs/DESIGN.md) and [providers](docs/PROVIDERS.md). The architecture reserves future remote clients without implementing a network server. Live integration eligibility and capability differences must be resolved before adding real providers.

No JAM account, remote access, capture shortcut, production PTY/editor or release packaging is implemented; Browser is a prototype. Windows and macOS need separate hands-on validation. The owner has not yet selected a public license.
