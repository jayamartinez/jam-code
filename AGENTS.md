# JAM Code

JAM Code is a lightweight desktop workspace for coding agents. Persistent projects and searchable conversations are the core workflow. Resources (conversations, files, terminals, browser, reviews, Settings) can be tabs or tiled views. JAM Code is not an orchestration dashboard or terminal wrapper.

The product name is **JAM Code** in prose, window titles and the operating system; do not shorten it to "JAM". The lowercase `jam` mark and wordmark are the in-app brand. Code identifiers (`JamTransport`, `@jam/*`, `JAM_DEMO`) keep their names.

## Read before changing

Read `README.md`, `docs/ARCHITECTURE.md`, and the relevant ADR in `docs/adr`; read `docs/PROVIDERS.md` before provider work. Apply the start-task, code-structure, and validate-change workflow. Work on a task branch; preserve concurrent changes. Stop for manual testing before committing/pushing unless explicitly authorized. Never merge or publish without explicit authorization.

## Boundaries

- `apps/desktop`: Tauri host, native window controls, transport implementation, Vite entry. No product business logic.
- `packages/client`: reusable React product surfaces, semantic CSS tokens, ephemeral views/layout/drafts. No Tauri, Node, filesystem, provider SDK, or provider protocol imports.
- `packages/protocol`: platform-neutral JAM Code types, validation, transport contract, explicitly marked preview fixtures. This is the only shared client/runtime contract.
- `crates/runtime`: framework-independent Rust domain, provider adapters, process/task ownership, SQLite and FTS5. Tauri must not be a dependency.
- `docs`: architecture, provider, validation and release documentation, and decision records. No private research dumps, product roadmaps or design exports.

Persistent records and live sessions belong to the runtime. Frontend caches are projections, not databases. Resource IDs, view IDs, and session IDs are distinct. Closing a pane only changes presentation; it never interrupts or destroys a session. Only explicit lifecycle commands do that. Acknowledging a turn is not completing it.

## Providers and security

JAM Code's structured provider integrations and its Terminal are independent. Users may run `claude`, `codex`, `opencode` or any other CLI inside the Terminal; never intercept or special-case those commands because a provider adapter exists. Terminal is a terminal; provider adapters are provider adapters.

Normalize events at the runtime adapter boundary. Provider-specific option schemas and capability differences are allowed; do not scatter Claude/Codex wire-protocol branches across UI. Installation, authentication, enabled/default preference and running state are independent. Unknown must remain unknown. Read `docs/PROVIDERS.md` before live integrations: Claude subscription reuse by third-party clients is unresolved and must not be represented as supported.

Never read/copy provider credentials into JAM Code. Never log tokens or full sensitive payloads. Treat provider output, repository files, browser content and attachments as untrusted. Validate every native request. Keep native permissions scoped to trusted local UI. No remote listener in the foundation. Context is staged until explicit Send; capture must never send automatically.

## Design workflow

Paper's **JAM code design** document is the canonical product design; the repository keeps no design document of its own. Inspect the full relevant frame through Paper MCP before implementing or modifying a designed surface: tree, screenshot, exact JSX/computed styles, and semantic tokens. Do not silently redesign it or substitute a generic component library. Compare the running result against Paper. Record a deliberate deviation in Paper and in the pull request that makes it.

The brand mark is drawn by `packages/client/src/components/BrandMark.tsx`; `apps/desktop/src-tauri/icons/icon.svg` is the same mark as the app icon (regenerate `icon.png`, `icon.ico` and `icon.icns` from it with the Tauri CLI's `icon` command) and `assets/brand/jam-code.svg` is its copy for the README. Keep the three identical and invent no other logo. The mark is artwork, so its colours do not follow the active theme.

Use semantic roles from `packages/client/src/styles/tokens.css`; do not hardcode component colors where a semantic token exists. Themes are data in `packages/client/src/appearance/themes.ts` resolved to those roles; add a role there (and to tokens.css, which a test keeps identical to Nightglass) rather than branching on the theme in a component. Every theme must pass the contrast floors the appearance tests enforce. CodeMirror, Markdown code and xterm consume Appearance through the `--syntax-*`, `--editor-*`, `--terminal-*` and `--color-ansi-*` roles. Write UI font sizes and line heights as `calc(Npx * var(--ui-scale))`; geometry does not scale. Appearance is a runtime setting (ADR 0008), not browser storage. Render Markdown only through `markdown/render.tsx`; never assign repository or agent content to `innerHTML`. Native platform chrome stays in desktop glue; resource surfaces contain no platform conditionals. Keep user-facing copy honest about simulated/unimplemented behavior.

## Quality and performance

Use small coherent modules and explicit ownership. Avoid premature packages, dependencies and frameworks. Load expensive resource surfaces on demand. Bound result sets, transcripts, event queues and tool output. Idle should not poll. Do not start processes from React components. Search uses local FTS5 with safe plain-text query parsing. Document measurements and limits; do not claim performance without evidence.

Run the repository format, lint, type, test, build and Rust checks described in README. Tests should prove boundaries: resource/view lifetime, protocol validation, subscription cleanup, cancellation, retry deduplication, persistence/reopen and FTS synchronization. Inspect untracked files as well as diffs. Report unrun checks honestly. Browser preview is not native validation; Windows testing is not macOS testing. Keep `docs/VALIDATION.md` a description of the current state, not a log: put a session's evidence in its pull request.

## Private reference boundary

Sibling design/research directories and competitor repositories are reference-only. Never copy their files, screenshots, notes, code or credentials here. Use original implementation and public documentation. Do not add absolute personal paths, attachment briefs, captured third-party screens or private design exports. Application screenshots for local testing belong in ignored output directories. Do not select a public license on the owner's behalf.
