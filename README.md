# JAM Code

JAM Code (`jam`) is a free, open-source, local-first desktop workspace for
coding agents. It runs the **Claude Code** and **Codex** CLIs you already have
installed and signed in to, and gives their work a home: projects, searchable
conversations, terminals, a browser, files and Git review, in tabs or tiles.

JAM Code is not a hosted service, an inference reseller or a JAM account. It
has no server. Your history stays in a SQLite database on your computer, and
the only content that leaves it is what you send to the agent you chose.

> **Alpha.** v0.1.0-alpha is for technical early adopters. Expect rough edges
> and occasional breaking changes. Back up anything you care about.

<!-- Screenshots: add once the alpha build is captured. -->

## What it does today

- **Projects** are folders on your computer, chosen with the system folder
  picker. Git is optional. Removing a project never touches its files.
- **Agent chats** with Claude Code (`claude` stream-json) and Codex
  (`codex app-server`): streaming replies, tool activity, approvals and
  questions answered inline, interrupt, resume after restart, model, effort
  and access choices, context usage and compaction.
- **New-chat workspaces**: work in the current checkout or a new Git worktree
  with its own `jam/…` branch, created on first Send. JAM never deletes or
  resets a worktree or branch.
- **Search** across every conversation (SQLite FTS5).
- **Terminal**: a real shell in a runtime-owned PTY. `claude` and `codex` typed
  there are ordinary commands.
- **Browser**: the system web view (WebView2 / WKWebView) in a pane, with
  element and region annotations you can stage into a chat.
- **Files and Review**: a read-only file browser and editor, and Git status,
  diffs and stage/unstage.
- **Tabs and tiles**: any resource in any pane; closing a pane never stops
  work.
- **Appearance**: themes, accents, fonts and backgrounds.
- **Snapshots** (macOS 14+): capture a window into a chat's composer.

## Platforms

| Platform                     | Status                                    |
| ---------------------------- | ----------------------------------------- |
| Windows 11 x64 (10 untested) | Supported; unsigned NSIS installer        |
| macOS 14+ (universal build)  | Supported; unsigned, ad-hoc signed `.dmg` |
| Linux                        | Not supported yet                         |

## Install

Download the installer for your platform from
[GitHub Releases](https://github.com/jayamartinez/jam-code/releases) and check
it against `SHA256SUMS.txt`. The builds are not code-signed yet:

- **Windows:** SmartScreen warns; choose _More info → Run anyway_.
- **macOS:** right-click _JAM Code_ → _Open_ the first time, or run
  `xattr -dr com.apple.quarantine "/Applications/JAM Code.app"`.

Then install and sign in to at least one agent with its own CLI:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code): `claude`
- [Codex](https://github.com/openai/codex): `codex`

JAM Code finds them on your `PATH` (Settings → Providers shows what it found,
their versions and whether they are signed in, and lets you point at another
executable). It never installs them and never asks for credentials.

## Privacy and provider sign-in

- JAM Code has no account, telemetry or network service of its own.
- Authentication stays with each CLI. JAM Code reads only whether it is signed
  in and the plan it reports; it never reads, copies or stores credentials.
- A chat sends your message and the context you explicitly attached to the
  provider's CLI, which talks to its provider as it normally would.
- Whether a Claude subscription may be used through a third-party app is
  unresolved, and JAM Code does not claim it is supported. It runs the
  unmodified `claude` CLI with its own sign-in. See
  [providers](docs/PROVIDERS.md).
- Data lives in your application-data folder (`dev.jamcode.desktop`):
  `jam.sqlite`, snapshots and the Browser's separate web profile.

## Known limitations

- Files are read-only in JAM Code; agents edit them.
- No auto-update, no import of history from the providers' own apps, no remote
  access, no Linux build.
- Browser is a prototype: no devtools or agent control.
- Snapshots are macOS-only.
- Explicit Quit interrupts running chats; they resume later from the
  provider's session.
- Large histories are not paginated yet (a conversation shows its latest 500
  messages).

## Build from source

Requirements: Node 22.13+ (22 LTS or newer LTS), pnpm 12.6, stable Rust
(1.97+) with rustfmt and clippy, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) — MSVC C++
build tools and WebView2 on Windows, Xcode command-line tools on macOS.

```sh
pnpm install
pnpm desktop        # run the app in development
```

`JAM_DEMO=1 pnpm desktop` opens a separate demo database with sample projects
and a deterministic demo provider, for development. It never touches your real
history. `pnpm dev` serves a browser-only preview at `http://127.0.0.1:1420`
with in-memory sample data; it has no access to your machine.

If your pnpm launcher is broken, prefix commands with
`npm exec --yes --package=pnpm@12.6.0 --`.

Release builds and the release process: [docs/RELEASING.md](docs/RELEASING.md).

## Develop

```sh
pnpm check        # format, lint, types, tests, production frontend build
pnpm check:rust   # rustfmt, cargo check, clippy -D warnings, tests
```

CI runs both on Windows and macOS for every pull request.

| Path                | Responsibility                                                   |
| ------------------- | ---------------------------------------------------------------- |
| `apps/desktop`      | Tauri host: window, tray, native services, transport, Vite entry |
| `packages/client`   | Shared React product UI, semantic design tokens, view state      |
| `packages/protocol` | Platform-neutral types, validation, preview fixtures             |
| `crates/runtime`    | Rust domain: providers, sessions, SQLite/FTS5, terminal, Git     |
| `docs`              | Product, architecture, design, providers, validation, ADRs       |

Start with [AGENTS.md](AGENTS.md) (the working rules for people and agents),
[product](docs/PRODUCT.md), [architecture](docs/ARCHITECTURE.md),
[design](docs/DESIGN.md) and [providers](docs/PROVIDERS.md). Decisions are in
[docs/adr](docs/adr). [Validation](docs/VALIDATION.md) records what has been
tested, how, and what has not.

Contributions are welcome as issues and pull requests. Keep changes small,
follow the existing architecture and run both checks before opening a PR.

## License

[MIT](LICENSE) © 2026 Jay Martinez. Third-party components and their licenses
are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Claude Code and
Codex are products and trademarks of Anthropic and OpenAI; JAM Code is an
independent project not affiliated with either.
