# Provider integration boundary

JAM is a client for locally installed coding agents, not an inference reseller or a terminal wrapper. The foundation executes only the deterministic mock adapter. Claude Code and Codex names in demo conversations describe presentation; their actual `providerId` is `mock`. No live provider is connected, no provider credentials are read, and demo tool activity never executes commands or changes files.

## Research baseline

Integration research was checked on 2026-09-25 against installed CLI help (Codex CLI 0.157.0 and Claude Code 2.1.283) and official documentation. Installed versions are observations, not compatibility promises or dependencies. Before implementing a real adapter, record its tested version range and capture representative protocol fixtures from that version. Models, effort values, plan labels and available features must come from provider discovery, not this document or hardcoded marketing names.

### Codex

Use a runtime-owned `codex app-server` process with stdio JSONL. Its bidirectional JSON-RPC-style protocol separates threads, turns and items. Initialize each connection before issuing commands. Native methods cover starting/resuming/forking threads, starting/steering/interruption of turns, model discovery and account inspection. Notifications carry incremental text and completed items; completed items are authoritative. Server-initiated approval requests need correlated replies with the decisions and scope the provider offers. Codex-managed authentication keeps tokens outside JAM. Generate schemas using the installed CLI and keep experimental API opt-in disabled unless a specific tested feature needs it. WebSocket transport remains experimental; the local JAM foundation does not expose it. Enterprise integrations should also verify client registration expectations. See [official app-server documentation](https://learn.chatgpt.com/docs/app-server).

### Claude Code

**Subscription reuse is unresolved for JAM.** Anthropic's [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) says third-party products may not offer claude.ai login or rate limits without prior approval. Its [credential policy](https://code.claude.com/docs/en/legal-and-compliance) prohibits third-party developers routing users' subscription credentials or collecting/intermediating session tokens. A detected, signed-in CLI is not sufficient evidence that a third-party product may reuse its subscription. Resolve permission with Anthropic before promising that experience. API-key or supported cloud-provider authentication is a documented alternative; JAM must not silently change the user's billing arrangement.

The official Agent SDK's [streaming input mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) provides a persistent process, images, queued messages and interruption. This is a stronger basis for an interactive adapter than repeatedly starting one-shot queries. The [headless CLI](https://code.claude.com/docs/en/headless) exposes structured JSONL output and partial messages, but output parsing alone does not establish a complete interactive approval protocol.

The [TypeScript SDK](https://code.claude.com/docs/en/agent-sdk/typescript) supports an explicit installed executable path, model/account discovery and live session controls. A future bridge introduces a JavaScript runtime/packaging decision; benchmark it before adopting or bundling a second runtime. No bridge is scaffolded now. Keep SDK and executable compatibility explicit.

[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions) support resume, fork and history inspection. Resuming a conversation does not restore its filesystem. [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output) contains partial deltas and complete blocks; multiple complete blocks may share one provider message ID, so adapters must reconcile them without duplicating text. Parent attribution and partial-event coverage differ for subagents.

Claude's [approval and user-input callback](https://code.claude.com/docs/en/agent-sdk/user-input) can represent both tool permission and a question to the user. It may remain pending until answered. Earlier [permission rules](https://code.claude.com/docs/en/agent-sdk/permissions) can resolve a tool before the callback, so it is not a universal policy enforcement hook. Interrupting current work, cancelling queued inputs and terminating the process are separate operations. Never translate them into a single optimistic “stopped” flag.

## JAM contract

The platform-neutral `@jam/protocol` package defines version 1 request envelopes, typed results, scoped events and the `JamTransport` interface. Provider wire messages stay in runtime adapters. UI components consume JAM resources, sessions, messages, context and capability descriptions. Provider-specific option schemas may be added without pretending different permission policies or effort values are equivalent.

The mock milestone implements workspace/conversation reads, conversation creation, turn start/interruption and local search. Mutation receipts acknowledge acceptance, not completion. Retried `turn.start` submissions are deduplicated by request ID; another start while the session runs returns a conflict. A reused ID with different content is an error. Closing a view or removing a subscription does not interrupt work. Explicit interruption prevents later completion from overwriting the interrupted state. The `/fail` demo prompt creates a deterministic failed turn.

Events use a runtime identity and monotonic sequence cursor. Subscribe before reading a snapshot, then reconcile buffered events against its cursor. Message upserts replace messages with the same JAM ID. A new runtime identity or a missed update requires an authoritative reread. The runtime stores source records before publishing updates. Browser preview is intentionally volatile, separately imported and explicitly identified; it must never silently replace a failed native connection.

## Capability and state model

Installation, authentication, enabled preference, default preference and current running state are independent. Missing or unverified information remains `unknown`. A future plan label needs a reliable provider-reported source. Capability availability is `supported`, `unsupported`, `unknown` or `conditional`, with a reason where relevant. The mock advertises only behavior it actually implements.

Real adapters should separately describe resume/fork/history read, text/image input, streaming, tool approvals, questions, queueing, steering, interruption, model changes and provider option definitions. Do not render a queue action as steering unless the adapter guarantees those semantics. An interaction request needs its own ID, session/turn scope, allowed responses and cancellation resolution. Unsupported operations must fail clearly rather than simulate success.

## Data and lifecycle invariants

- Resource IDs, JAM session IDs and opaque provider IDs are distinct. Provider resumable history remains provider-owned; JAM stores searchable normalized projections with provenance.
- Runtime supervisors own processes and task handles. Panes, subscriptions and React lifetimes do not own them. Process exit, user cancellation, resource closure and filesystem rollback have different meanings.
- Context is staged with typed provenance and opaque asset references. Only an explicit send attaches it to a turn. Selection metadata is not an authority to read arbitrary paths.
- Command arguments and environment are constructed in the runtime without shell concatenation. Never read, copy or log provider tokens in JAM.
- Unknown events, version mismatches, partial output, process failures and stale approval responses must be handled explicitly. Bounded raw diagnostics may support debugging locally; they must not become a second frontend protocol.
- Usage records must identify whether values are incremental or cumulative and whether they include subagents. Provider cost estimates are not billing statements.

Before a real provider is enabled, contract tests must cover authentication failure, interrupted approval, resumed history, duplicate delivery, partial/final reconciliation, unsupported options and process restart. Real-provider smoke tests require an explicitly configured account and must disclose cost. The foundation tests use no account and make no inference requests.
