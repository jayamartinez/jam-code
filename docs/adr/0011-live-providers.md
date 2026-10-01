# 0011 — Live Claude Code and Codex adapters

Status: accepted for Providers V0 (2026-09-27). Supersedes the "live integrations deferred" part of ADR 0004.

JAM Code needs real agents without becoming an agent, a proxy or a terminal wrapper. Both providers offer a structured local interface to the CLI the user already installed and signed in to: `codex app-server` (JSON-RPC over stdio) and Claude Code's stream-json control protocol, which the official Agent SDK itself uses. The runtime speaks each directly from Rust. Bundling the proprietary Agent SDK would add a second runtime and a licence question for no capability JAM Code needs; the CLI interface is documented and carries approvals, questions, interrupts and model discovery.

Each adapter owns its processes and wire protocol and emits normalized blocks, interactions, usage, model and provider-ID updates. The runtime supervises turns, persists everything before publishing it, and keeps JAM Code IDs primary with a separate `provider_bindings` record for resume and future history import. Interactions have JAM Code IDs and are answered through one request whose choices are exactly what the provider offered. Capabilities describe what JAM Code actually implements, not what the provider could do.

Authentication stays provider-native: JAM Code reads sign-in state from the CLIs' own reports, never reads or stores credentials and never offers a login of its own. Claude subscription use by third-party apps remains unresolved (see PROVIDERS.md); JAM Code runs the unmodified CLI with its own sign-in and says so rather than claiming support.

Consequences: provider protocols drift, so adapters record the version they were tested with, tolerate unknown events and have fixture tests plus opt-in live tests. Idle provider processes are stopped after 15 minutes and resumed by provider ID. Steering, queueing, forking and Codex questions are deferred and reported as unsupported. The demo provider stays for tests, development and the browser preview, off by default in the desktop app, and never shows a real provider's mark.
