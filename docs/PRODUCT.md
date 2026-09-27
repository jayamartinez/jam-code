# Product foundation

JAM is a local-first desktop client for coding work with existing agent installations. Its primary loop is open a project, find or start a conversation, work with an agent, and resume that work later. Search and continuity matter more than orchestration. There is no JAM identity/account requirement.

## Domain language

| Concept       | Meaning                                                                             | Lifetime                             |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| Project       | A repository/workspace identity and machine-local location                          | Durable                              |
| Resource      | Addressable conversation, terminal, browser, file, file browser, review or Settings | Independent of presentation          |
| View          | One visible presentation of a resource                                              | Client-owned                         |
| Layout        | Active tab, ordered views, single/tiled arrangement and focus                       | Presentation; persistence can follow |
| Conversation  | Searchable transcript and context history                                           | Durable                              |
| Agent session | Runtime-owned execution state and provider session reference                        | Independent of views                 |
| Turn          | One explicit user submission and resulting agent activity                           | Durable outcome                      |
| Context item  | A file/selection/diff/browser region/terminal excerpt/message/snapshot attachment   | Staged, then explicitly sent         |

Single mode displays one active resource. Tiles displays a set simultaneously in a split tree whose leaves are views; any resource can occupy any leaf, and visible and focused are different states. Closing a view must leave the underlying resource available in history. A terminal is a real PTY resource eventually, not the rendering mechanism for conversations.

## Foundation milestone

Build the Paper shell with projects, pinned and recent conversations, Settings footer, resource tabs, Single/Tiles, normalized messages, composer and representative tool activity. Prove the architecture with deterministic mock turns, native persistence and local search. Mock provider work must be labeled and must not execute commands, edit repositories, call models or imply live authentication.

The reference project names and example transcript are synthetic demo content. Demo seed is idempotent and belongs in an isolated demo database. A browser-only development preview may be volatile; it must identify itself as preview and never claim native persistence.

## Reserved product direction

Claude Code and Codex remain first-class V0 targets, with native authentication preferred wherever the provider permits it. Capability and commercial constraints are documented in PROVIDERS.md. Do not implement both integrations in this milestone.

History will index titles, message text, referenced paths/diffs and command activity with project/provider/time/pinned filters. Results must reopen the resource and eventually jump to the matching item. The initial implementation may cover a documented subset, with bounded results.

A Browser resource now embeds a native platform webview (see ADR 0006) with navigation and a prototype element picker that stages context; region capture, screenshots, console/network inspection and agent control remain later work. xterm + native PTY, Git CLI integration, and native snapshots are later resources/services. The file browser and CodeMirror File resource exist over a runtime file service, but that service serves an isolated demo tree and the editor is read-only until native folder access and a write path exist. Browser pages cannot inherit native application privileges. Universal context unifies these sources without moving raw assets into UI state.

Snapshots default conceptually to Shift Shift, capture the currently focused window without taking focus, provide optional feedback, and stage context into the last-focused conversation. They are never automatically sent. Modifier-only shortcut detection, conflicts, platform capture permission and focus behavior need native feasibility work. Fullscreen/region modes follow later.

Settings has a dedicated presentation (button or platform comma shortcut) and can also be opened as a normal resource. Shared content must serve both. Settings ends the sidebar; no provider account footer. Provider plan labels appear only with reliable evidence.

Theme customization includes semantic tokens, accent, background, opacity, blur, effects and layout/keybindings. The initial theme is Nightglass. A future authenticated remote client should reuse shared product UI while the local runtime continues to own machine capabilities.

## Completion and non-goals

Foundation is complete after a running Tauri shell, documented architecture, genuine protocol/provider boundaries, meaningful automated checks and visual comparison. It does not claim production readiness, live providers, a working browser/PTY/editor, remote access, screenshot capture, account management or release packaging. Manual developer testing precedes shipping.
