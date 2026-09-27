# 0004 — Capability-aware normalized providers and explicit context

Status: accepted. Live Claude Code and Codex adapters: see ADR 0011.

Codex app-server and Claude Agent SDK have different turn/input/approval models. Normalize messages, tool activity, lifecycle and errors at the adapter boundary, while exposing supported/unsupported/unknown/conditional capabilities. Keep provider options explicit instead of pretending identical models or permission policies. Ship a deterministic mock adapter first. Subscription authorization is independent of technical CLI capability; see PROVIDERS.md.

Context provenance is a union across files, browser selections, diffs, terminal excerpts, messages and snapshots. Attachments are staged, then included only in an explicit submission. Capture is a native service and never calls Send. Large/binary assets stay behind opaque runtime handles. Implementing capture and live providers is outside this milestone.
