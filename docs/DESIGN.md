# Design foundation

The canonical design is the Paper document **JAM code design**. Its References, workspace, Core flows, and Settings pages were inspected before implementation using screenshots, hierarchy, exact JSX, computed styles, and semantic tokens. This document records the product foundation rather than embedding private exports or reference images. Components are original implementation. The provisional wordmark is lowercase typographic `jam`; the reference's abstract mark is deliberately omitted.

## Nightglass

Nightglass is a dense desktop work surface with a nearly black ground, translucent dark panes, quiet borders, cool blue focus, and restrained background light. The workspace is not a dashboard: most content lives in the conversation, and tools remain adjacent resources. Cards are used for grouped activity or controls, not every line of text.

`packages/client/src/styles/tokens.css` preserves the semantic Paper token roles and values. Important roles include base `#07080C`, sidebar `rgb(9 10 15 / 62%)`, pane `rgb(12 13 19 / 78%)`, raised `#171820`, overlay `#14151B`, primary text `#E3E6EE`, body `#D2D6E0`, muted `#9095A3`, accent `#6F9BFF`, success `#7EC39A`, warning `#E6A85E`, and danger `#E6807A`. Text, surfaces, borders, diff, and provider roles remain separate. Future theme/opacity controls can replace semantic tokens without changing components.

Geist and Geist Mono are bundled locally. UI labels use 10.5–13px, body 14px with 23px line height, and new-chat headings 24px/30px. Monospace is reserved for paths, code, keys and compact metadata. A future readable-density mode may increase these values; do not solve density by shrinking unrelated typography.

## Geometry

The principal desktop frames are 1440×900. The normal sidebar is 280px, collapsed rail 56px, titlebar 44px, pane header 42px, pane gutters 6px, and outside right/bottom inset 8px. Panes use 12px radius and a subtle 1px border; composer uses 14px radius. Controls have fixed icon/action slots so repeated rows align.

Single mode centers a 700px transcript and composer, as specified by the actual Single frame. Tiles uses the 640px thread token for its transcript and composer; it does not override the 700px Single frame. User messages align right and cap at 500px. Tiles uses a flexible conversation and a 408px secondary column containing diff above terminal. Focus uses a 720px conversation column and removes navigation chrome while retaining agent attention counts.

Dedicated Settings replaces the normal sidebar with a 260px settings navigation. Content caps at 820px including 40px inline and 36px block padding, with 24px gaps. Resource Settings uses the regular shell plus a 200px inner navigation and 32px inline/24px block padding. Both presentations share one content component and state.

## Inspected surfaces

| Family                | Frames / intended behavior                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| Workspace             | Windows Single and Tiles, macOS shell variants, search/history presentation and reference/component material |
| Core shell            | Reusable shell template; consistent project, pinned, history and Settings navigation                         |
| New chat              | Unsaved project-scoped draft, provider/model/effort and execution target selection, resume and starters      |
| Launcher              | Agent chats, terminal, browser, file, file browser, review; project switching and adding                     |
| Browser annotation    | Element/region selection, numbered annotation bundle, destination choice, explicit staging                   |
| Files/editor/terminal | Independent resources; selection context; directory-aware terminal; read-only agent shell observation        |
| Review                | Branch-wide changes, viewed state, inline pending comments and explicit batch send                           |
| Collapsed rail        | Project identity/status remains reachable with flyouts                                                       |
| Focus                 | Conversation alone with a thin exit/attention strip                                                          |
| Snapshot → context    | Background capture, quiet toast, staged context and destination change                                       |
| Settings              | Dedicated providers, provider detail, snapshot options, shortcut states, and resource-tab presentation       |

## Interaction invariants

Tabs are open resources; panes are views. A resource can remain open while not visible. Focused and visible tabs are distinct. Closing a view never terminates a session. Draft text belongs to a resource-keyed client draft store outside mounted panes. Explicit Stop is the only composer action that interrupts work. Resource identity is not a React key invented on every render.

Projects and persistent conversation records come from the runtime. The sidebar combines project navigation, pinned conversations and scoped history; it ends with Settings. Counts must reflect actual available data, not the reference's illustrative 412 chats. Project/provider filters apply to history. Search queries the transport and opens the result's existing resource; snippets are plain text.

New-chat drafts are not persisted before Send. An explicit first send creates the conversation and submits its text/context. Provider selection must expose only enabled providers. Execution targets, model controls and permission controls require actual capabilities; unavailable features are disabled with a clear explanation rather than simulated. Composer Ctrl/Cmd+Enter sends; normal Enter inserts a newline. Search is Ctrl/Cmd+K; new chat Ctrl/Cmd+N; Settings Ctrl/Cmd+Comma; focus Ctrl/Cmd+Period. Escape dismisses overlays. Keyboard users retain visible focus and dialogs trap focus and return it to their trigger.

Browser annotations, file selections, diffs, terminal excerpts, conversations and snapshots share a context chip language: icon, label, preview and removal. Staging never invokes Send. Snapshot capture must preserve another application's focus; the design's six-second toast can change destination or add a note, and dismissing it does not remove the attachment. Shortcut soft conflicts warn while retaining the binding; unavailable global bindings leave the feature unbound. Native capture is deferred.

Review comments are pending until explicitly sent. Review sends one message containing file/line references into the selected existing conversation. Commit is a separate action. An agent's quick acknowledgement is not an edit or completed task.

## Foundation deviations and honesty

Only the deterministic Mock provider runs in this milestone. Reference Claude/Codex model versions, connected plan labels and running indicators are illustrative and must not be presented as live detection. Real providers display unavailable/unknown status. Compact Demo labeling is part of chrome; browser development preview is volatile and distinct from native SQLite persistence.

Diff and terminal are lazy-loaded static demo surfaces. They show explicit demo labels, execute nothing, and own no process. Browser, editor, repository picker, worktree creation, native capture, theme controls and provider configuration are deferred. Disabled controls explain their state. The initial app implements shared provider Settings and reserves navigation for future pages without pretending settings were persisted.

Window buttons call injected desktop services. The shared client imports no native API. Windows controls sit right; macOS retains the host's native traffic lights with an explicit left inset in sidebar, collapsed and focus presentations, avoiding duplicate web controls. Only noninteractive titlebar space initiates native dragging. Browser preview window actions are unavailable. The macOS native inset is implemented but unverified on macOS hardware.

## Verification

Compare the running shell with Paper at 1440×900 in Single and Tiles; inspect sidebar width, transcript bounds, title/pane heights, gutters, typography and focus states. Check a smaller supported window for clipping and overflow. Exercise search, filters, draft preservation, view close/reopen during streaming, stop, failure, new chat and both Settings modes. Browser screenshots verify web rendering only; native window drag/chrome, WebView behavior, persistence and platform accessibility require desktop testing.
