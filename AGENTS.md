# JAM Code

JAM Code, branded `jam`, is a lightweight local-first desktop workspace for coding agents. Persistent projects and searchable conversations are the core workflow. Resources (conversations, files, terminals, browser, reviews, Settings) can be tabs or tiled views. JAM is not an orchestration dashboard or terminal wrapper.

## Read before changing

Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, and the relevant ADR. Apply the start-task, code-structure, and validate-change workflow. Work on a task branch; preserve concurrent changes. Stop for manual testing before committing/pushing unless explicitly authorized. Never merge or publish without explicit authorization.

## Boundaries

- `apps/desktop`: Tauri host, native window controls, transport implementation, Vite entry. No product business logic.
- `packages/client`: reusable React product surfaces, semantic CSS tokens, ephemeral views/layout/drafts. No Tauri, Node, filesystem, provider SDK, or provider protocol imports.
- `packages/protocol`: platform-neutral JAM types, validation, transport contract, explicitly marked preview fixtures. This is the only shared client/runtime contract.
- `crates/runtime`: framework-independent Rust domain, provider adapters, process/task ownership, SQLite and FTS5. Tauri must not be a dependency.
- `docs`: independently publishable product and architecture decisions. No private research dumps.

Persistent records and live sessions belong to the runtime. Frontend caches are projections, not databases. Resource IDs, view IDs, and session IDs are distinct. Closing a pane only changes presentation; it never interrupts or destroys a session. Only explicit lifecycle commands do that. Acknowledging a turn is not completing it.

## Providers and security

Normalize events at the runtime adapter boundary. Provider-specific option schemas and capability differences are allowed; do not scatter Claude/Codex wire-protocol branches across UI. Installation, authentication, enabled/default preference and running state are independent. Unknown must remain unknown. Read `docs/PROVIDERS.md` before live integrations: Claude subscription reuse by third-party clients is unresolved and must not be represented as supported.

Never read/copy provider credentials into JAM. Never log tokens or full sensitive payloads. Treat provider output, repository files, browser content and attachments as untrusted. Validate every native request. Keep native permissions scoped to trusted local UI. No remote listener in the foundation. Context is staged until explicit Send; capture must never send automatically.

## Design workflow

Paper's **JAM code design** document is canonical. Inspect the full relevant frame through Paper MCP before implementing or modifying a designed surface: tree, screenshot, exact JSX/computed styles, and semantic tokens. Do not silently redesign it or substitute a generic component library. Compare the running result against Paper. Document deliberate deviations. Use lowercase typographic `jam` until final branding arrives; invent no abstract logo.

Use semantic roles from `packages/client/src/styles/tokens.css`; do not scatter hex colors in components. Native platform chrome stays in desktop glue. Keep user-facing copy honest about simulated/unimplemented behavior.

## Quality and performance

Use small coherent modules and explicit ownership. Avoid premature packages, dependencies and frameworks. Load expensive resource surfaces on demand. Bound result sets, transcripts, event queues and tool output. Idle should not poll. Do not start processes from React components. Search uses local FTS5 with safe plain-text query parsing. Document measurements and limits; do not claim performance without evidence.

Run the repository format, lint, type, test, build and Rust checks described in README. Tests should prove boundaries: resource/view lifetime, protocol validation, subscription cleanup, cancellation, retry deduplication, persistence/reopen and FTS synchronization. Inspect untracked files as well as diffs. Report unrun checks honestly. Browser preview is not native validation; Windows testing is not macOS testing.

## Private reference boundary

Sibling design/research directories and competitor repositories are reference-only. Never copy their files, screenshots, notes, code or credentials here. Use original implementation and public documentation. Do not add absolute personal paths, attachment briefs, captured third-party screens or private design exports. Application screenshots for local testing belong in ignored output directories. Do not select a public license on the owner's behalf.
