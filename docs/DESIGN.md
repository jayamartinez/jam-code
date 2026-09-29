# Design foundation

The canonical design is the Paper document **JAM code design**. Its References, workspace, Core flows, and Settings pages were inspected before implementation using screenshots, hierarchy, exact JSX, computed styles, and semantic tokens. This document records the product foundation rather than embedding private exports or reference images. Components are original implementation. The provisional wordmark is lowercase typographic `jam`; the reference's abstract mark is deliberately omitted.

## Nightglass

Nightglass is a dense desktop work surface with a nearly black ground, translucent dark panes, quiet borders, cool blue focus, and restrained background light. The workspace is not a dashboard: most content lives in the conversation, and tools remain adjacent resources. Cards are used for grouped activity or controls, not every line of text.

`packages/client/src/styles/tokens.css` preserves the semantic Paper token roles and values. Important roles include base `#07080C`, sidebar `rgb(9 10 15 / 62%)`, pane `rgb(12 13 19 / 78%)`, raised `#171820`, overlay `#14151B`, primary text `#E3E6EE`, body `#D2D6E0`, muted `#9095A3`, accent `#6F9BFF`, success `#7EC39A`, warning `#E6A85E`, and danger `#E6807A`. Text, surfaces, borders, diff, and provider roles remain separate. Nightglass is the default of six built-in themes; see Appearance below.

Section and group labels — Projects, Pinned, History, Open, Closed, the
launcher's Agents and Tools, "Continue in", settings field labels — are
sentence case at 11.5px medium in the subtle text role, with no added
tracking. The Paper frames were drawn in tracked uppercase; the project owner
asked for calmer labels, and Paper was updated to match, so hierarchy now
comes from weight and colour rather than capitals. Genuine abbreviations,
keycaps, initials and status letters stay as they are.

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
| Files/editor/terminal | Independent resources arranged by the generic layout system, never a combined editor-with-terminal component |
| Review                | Branch-wide changes, viewed state, inline pending comments and explicit batch send                           |
| Collapsed rail        | Project identity/status remains reachable with flyouts                                                       |
| Focus                 | Conversation alone with a thin exit/attention strip                                                          |
| Snapshot → context    | Background capture, quiet toast, staged context and destination change                                       |
| Project threads       | Frame 7: a selected project expands its open threads, one idle-close prompt, and a collapsible Closed group  |
| Settings              | Dedicated providers, provider detail, snapshot options, shortcut states, and resource-tab presentation       |

## Window chrome

Windows draws JAM's own controls at the right of the titlebar. macOS keeps the
host's real traffic lights and JAM draws none: the desktop host positions them
at an 18px left inset, 16px from the top, so the system's 12px buttons and 8px
spacing centre in the 44px titlebar. They occupy the sidebar header's left
inset, which is where the wordmark sits on Windows; on macOS the wordmark
yields to them rather than being pushed sideways. A collapsed 56px rail is
narrower than the buttons need, so the rail's own content starts below them.
Only noninteractive titlebar space starts a native drag, and tab reordering is
pointer-driven rather than HTML5 drag-and-drop: a native drag hands the tab to
the operating system as a draggable item that could be dropped into another
application. The tab strip also scrolls horizontally from a vertical wheel, so
an overflowing tab stays reachable with a plain mouse. All of this lives in
the desktop host and the chrome components; resource surfaces contain no
platform conditionals.

## Panes and tiling

Every resource surface shares one pane frame: a 42px header with its heading on
the left and a 26px control cluster on the right — split right, split down,
focus, and a pane menu — at 2px spacing and 6px radius, matching the Tiles
frame. Because the cluster is identical everywhere, splitting is discoverable
from any pane and from Single, which enters Tiles with the resource already on
screen. Splits are 6px gutters that drag to resize and respond to arrow keys.

The file browser pane omits the reference's own search and add buttons: both
are unimplemented, and the shared control cluster occupies that space instead.
A pane header drops its branch, then its project label, by its own width rather
than the window's, so a narrow tile stays one 42px line.

Choosing a file never replaces the browser. The file opens in a pane that
already holds one, then an empty pane, and otherwise a new pane split beside
the browser at the Files frame's 250/1160 proportion — the browser-left,
editor-right arrangement that frame shows, with a terminal optionally below.

The editor gutter follows the Files frame: line numbers right-aligned in a
48px column with 14px on their right, a subtle divider, and the code starting
8px after it. The active line's number brightens; nothing else is highlighted
in the gutter. Lines do not wrap.

## New Resource launcher

The launcher answers "what do I want to open?" and is not a search field. It is
600px wide, with a 362px open list (Agents, then Tools) and a 236px project
column, following the launcher frame. The frame draws it centred on an empty
workspace; in use it opens from whatever asked for it — 6px below the tab
strip's `+`, or below an empty pane's button — aligned 10px left of that
control and clamped inside the main region, so it reads as that button's menu
rather than a modal. Pressing the `+` again, Escape, a press or right-click
outside, or the window losing focus closes it. Global history search keeps its own centred dialog and its
own shortcut; the two interactions stay separate.

## File and folder icons

The Files frame does not define a file icon system, so JAM adds one behind
`FileIcon` and `FolderIcon`. Both take a path and never name a pack. Two themes
are available so their designs can be compared in place: an original JAM glyph
set, and a curated subset of the MIT-licensed Material Icon Theme vendored in
`components/file-icons/material` with its licence. Both classify paths through
the same module, so switching changes artwork only — never which files are
distinguished — and both render into the same 16px box at the same row height
and indentation.

The JAM set began as a page outline with a small type mark inside it. At the
14px the tree uses, the outline dominated and the marks were unreadable, so the
page was dropped and the mark now fills the box; only a file JAM has no opinion
about still draws a page. Types separate by silhouette first and tone second,
with five tones across the set. The Material set is more immediately
recognizable and carries more colour; it is constrained to the same box so it
cannot outweigh the rest of the interface. The default is a mix: Material's marks for file types, JAM's own outlined
folders for structure. Choosing a single set is deliberately still open, and
the comparison switch is temporary development chrome, not a setting.

## Project identity

A project badge is an 18px square at radius 5 with accent-soft behind 9.5px
semibold mono on a 12px line, matching the design's sidebar row, and every
project uses the same accent tone by default rather than cycling through
several. Right-clicking a project (or its context-menu key) offers **Edit
project details…**, which edits the name, the project's folders, and its badge:
initials, one of 40 line glyphs, any emoji, or an image, with eight tones for
everything but the image. The glyph names, tones and size limits are one shared
fixture (`packages/protocol/fixtures/project-icons.json`) that the runtime
validates against too. Folders are recorded but not yet read.

An image is cropped from its centre to a square and stored at 64px, so a tall
or wide picture is never stretched and the record stays small. A dark mark on
a transparent background — a monochrome logo — is redrawn on a light backing,
because it would otherwise vanish on the dark badge. Images are read with
`FileReader` into `data:` URLs: the desktop content security policy allows
`data:` images and deliberately not `blob:`, which is why object URLs failed
with "cannot be read".

JAM draws its own context menus so they look the same on macOS and Windows.
The WebView's native menu (Reload, Inspect Element) is suppressed by the
desktop host except over editable or selected text, where Cut/Copy/Paste stay
native.

Tabs show their project's badge once more than one project is open, because
several resources of the same kind — four file browsers, say — are otherwise
indistinguishable. With a single project in play the badge is omitted rather
than repeated on every tab.

## Editor typography

`--font-mono` is the design's family _name_; the loaded face is Geist Mono
Variable. Anything setting a font reads `--font-mono-stack` or, in a file pane,
`--editor-font-family`, so a bare name can never fall through to the browser's
default serif. The editor's family, size and line height are Appearance
settings (see Typography below).

## Project threads

Paper frame 7 defines this surface. A project's threads are its
conversations. Clicking a project selects it and lists its threads under it in
the sidebar; clicking it again hides them. Any number of projects can be open
at once, so threads from several projects can be compared side by side; until
the reader toggles one, the current project starts open. The expanded project drops its row fill and keeps its weight,
so the highlight belongs to the open thread. Thread rows are 28px, indented to
the project's name, with the provider mark, the title and a compact age.

Open threads sort by last activity. Closed threads sit in a Closed group that
starts collapsed, show three at a time, and read "closed 3d". Closing is
always the reader's decision: right-click a thread to close or reopen it, and
sending to a closed thread reopens it. JAM may suggest closing a thread nobody
has used for the configured period (seven days by default, or never) — every
idle thread's age turns amber, and one inline prompt asks about the longest
idle one at a time. "Keep open" snoozes that thread for another full period.
Nothing closes on its own. The frame also shows "merged #41"; that reason
needs git integration and is not implemented, so JAM never claims it.

Projects can be pinned from their context menu. Pinned projects sort first and
carry a small pin beside the name; otherwise the runtime's order is kept.

## History search

Search opens with something to act on instead of an empty list: up to six
recent searches, then the eight most recent chats, both narrowed by the
dialog's project, provider and pinned filters. A search is remembered only
once it led to an opened result, and recent searches live in this browser
profile, never in the runtime. Choosing one runs it; each can be forgotten, or
all cleared. Arrow keys and Enter move through both lists as one. The pointer
changes the selection only when it moves, so a row appearing under a resting
pointer never steals the keyboard's place.

## Provider and resource icons

Marks render inside a fixed square — 16px in dense rows — with the glyph
centred at a per-mark scale so differently shaped provider marks read at the
same optical weight. The slot never stretches, never sets a row's height and
never shifts adjacent text. An unrecognized provider gets a neutral fallback
rather than another provider's mark. Claude Code and Codex use their own
supplied marks. Claude Code is drawn in its provider tone through
`currentColor`. Codex keeps its own violet-to-blue gradient, whose stops are
provider tokens, but not the white rounded tile its colour icon ships on: the
view box is cropped to the mark, so it sits directly on the dark surface.
Each instance gets its own gradient ID, as SVG IDs are document-global. The Claude Code mark is wide and short, so it takes
more of its slot to read at the Codex mark's weight. A new chat has no session yet, so its composer and its
"Continue in" rows take the provider from the draft and from each row's
session rather than assuming Claude.

## Browser

Paper frame 2 (Browser annotation → agent) defines the surface. The pane's
header carries the browser bar: back, forward and reload in 26px slots, then
the address pill. The pill is 28px on the fill role with a 6px status dot:
green for https or a local host, accent while loading. The origin is in
primary mono and the path in subtle mono. Next comes the tool capsule
(Interact and Annotate) on a fill-subtle, bordered 8px capsule with the active
tool in accent-soft. Below the header is a 12px well on
`--color-surface-browser-well` holding the page.

Annotate is one mode that the reader toggles on and off. It does not offer a
separate tool per kind. In the mode, a click annotates the element under the
pointer, and a press-and-drag past 4px annotates the dragged region. Each
capture opens the frame's comment card ("Comment on region 2", Cancel/Add),
placed beside the target, else below or above it. Enter adds and Escape
cancels. The comment is optional. Added annotations stack: each leaves a
numbered marker on the page (solid outline for elements, dashed for regions),
and the 52px tray shows the numbered badges, the count, "1 element · 1 region
· console (1 error)", Clear, and "Add to “conversation”". Adding stages the
whole stack as context chips that lead with their comments, clears the
markers, and never sends. Escape in the page, the Interact button, or
navigating away ends the mode. Markers and the stack survive leaving it.

Typing `localhost:5173`, a bare port or `127.0.0.1` opens `http://`. A bare
domain opens `https://`. Anything else is refused with a reason under the bar.
A new browser shows JAM's own "Open a page" prompt instead of a white
`about:blank`.

Deliberate deviations, all forced by a native page or by honesty:

- The bar sits inside the shared 42px pane header, not the frame's own 44px
  bar. That keeps split, focus and the pane menu identical to every other
  pane.
- The page's corners are square. A native view cannot be clipped by CSS, so
  the frame's 8px page radius is not possible. The 12px well keeps the pane's
  own rounded corners clear.
- Anything JAM floats over the workspace (menus, dialogs, the launcher) hides
  native pages while it is open, because nothing in HTML can paint above
  them. The frame's comment card, highlight, drag rectangle and markers are
  therefore drawn inside the page by the annotate script, in the frame's
  colours, in a closed shadow root so page CSS cannot restyle them.
- The frame's separate Element, Region and Comment buttons became one
  Annotate toggle at the owner's request: click versus drag decides the kind,
  and every annotation gets a comment. Regions record their rectangle and the
  elements they cover; the frame's "screenshot" detail needs native snapshots
  and is not claimed.
- The tray omits the frame's `Ctrl ↵` chip and destination dropdown. Neither
  shortcut nor destination switching exists yet. Staging goes to the
  conversation beside the browser, else the one used last, and never sends.
- Back and forward are disabled only when the page's Navigation API says so.
  Where the platform cannot say, they stay enabled and simply do nothing at
  the ends of history.

## Interaction invariants

Tabs behave like browser tabs: a press selects only if released in place;
past a 5px threshold it becomes a reorder, the tab follows the pointer and its
neighbours slide aside, and releasing does not select it. The press prevents
WebKit's default so it cannot start a text selection, which otherwise takes
over the pointer stream; the tab strip and sidebar are not selectable text.
The wheel scrolls the strip horizontally.

Tabs are open resources; panes are views. A resource can remain open while not visible. Focused and visible tabs are distinct. Closing a view never terminates a session. Draft text belongs to a resource-keyed client draft store outside mounted panes. Explicit Stop is the only composer action that interrupts work. Resource identity is not a React key invented on every render.

Projects and persistent conversation records come from the runtime. The sidebar combines project navigation, pinned conversations and scoped history; it ends with Settings. Counts must reflect actual available data, not the reference's illustrative 412 chats. Project/provider filters apply to history. Search queries the transport and opens the result's existing resource; snippets are plain text.

New-chat drafts are not persisted before Send. An explicit first send creates the conversation and submits its text/context. Provider selection must expose only enabled providers. Execution targets, model controls and permission controls require actual capabilities; unavailable features are disabled with a clear explanation rather than simulated. Composer Ctrl/Cmd+Enter sends; normal Enter inserts a newline. Search is Ctrl/Cmd+K; new chat Ctrl/Cmd+N; Settings Ctrl/Cmd+Comma; focus Ctrl/Cmd+Period. Escape dismisses overlays. Keyboard users retain visible focus and dialogs trap focus and return it to their trigger.

Browser annotations, file selections, diffs, terminal excerpts, conversations and snapshots share a context chip language: icon, label, preview and removal. Staging never invokes Send. Snapshot capture must preserve another application's focus; the design's six-second toast can change destination or add a note, and dismissing it does not remove the attachment. Shortcut soft conflicts warn while retaining the binding; unavailable global bindings leave the feature unbound. Native capture is deferred.

Review comments are pending until explicitly sent. Review sends one message containing file/line references into the selected existing conversation. Commit is a separate action. An agent's quick acknowledgement is not an edit or completed task.

## Terminal

The Files and Tiles frames define the terminal: the terminal surface token,
Geist Mono at 12px on a 19px line in the muted text role, 10px/14px padding,
and a header with the terminal glyph, the shell's name, its directory in mono
and a live dot. JAM uses the shared 42px pane header rather than the frames'
34–36px one, so split, focus and the pane menu mean the same thing in every
pane. The frames' Run menu and agent shells are not implemented and are not
drawn. When a project records no folder, the shell starts at home and the
header says the project has no folder rather than implying a project path.

xterm is themed from semantic roles scoped to the pane (`styles/terminal.css`):
the ANSI colours are theme roles (`--color-ansi-*`). In Nightglass they are the
danger, success, warning, blue, violet and cyan tones, with brights from the
diff text roles and mixes towards strong text; bright black is the subtle role
so dim suggestions stay legible. Light themes map black to strong text and
white to faint text so every colour reads on a pale pane. The accent never
recolours a program's blue. Theme and font changes update the live terminal in
place — colours are re-read, the line is re-calibrated and the view re-fitted —
without recreating xterm or losing scrollback.
Selection uses the accent border role, the background is transparent over the
pane surface, the cursor does not blink (no idle timer), and the scrollbar
uses the fill roles. Italic renders upright because only the upright Geist
Mono is bundled.

Closing a terminal's pane or tab leaves its shell running; the launcher lists
running terminals under **Running** so one can be reopened, and **Terminate
shell** in the pane menu is the explicit way to end one. An ended shell keeps
its output with a **Restart shell** action. On a Mac, ⌘C/⌘V copy and paste and
⌘F finds; elsewhere Ctrl+Shift+C/V and Ctrl+Shift+F, Ctrl+C copies only while
text is selected, and Ctrl and Escape keys stay with the shell rather than
triggering window shortcuts. Links are not clickable yet: opening one needs a
native opener with its own permission.

## Foundation deviations and honesty

Claude Code and Codex chats are real (PROVIDERS.md). Versions, sign-in, plan labels, models, effort levels and running counts come from the providers; anything they did not report stays unknown, and a plan appears only when the CLI reported one. The demo provider is labelled Demo, draws its own dashed mark, never borrows a real provider's mark, and is off by default in the desktop app. The browser development preview is volatile, has only the demo provider, and says real providers run in the desktop app.

Review is lazy-loaded and uses real Git state (ADR 0010). It retains Paper’s changed-files column, unified hunks and semantic diff colors. The shared pane header remains 42px; a compact summary and staged/unstaged controls replace illustrative agent attribution and review/commit actions. Counts load only for the selected file/version. Refresh, Stage file, Unstage file and Open file are explicit actions. Annotations and destructive actions are deferred. Terminal is real (see Terminal above) and Browser is a native-webview prototype (see Browser above). Repository picker, worktree creation, native capture and provider configuration are deferred. Disabled controls explain their state. The initial app implements shared provider Settings and reserves navigation for future pages without pretending settings were persisted.

The file browser and File resource are real surfaces over a runtime file
service, but that service serves an isolated demo tree rather than this
machine, so both are labelled `Demo tree`. The File resource is read-only and
says `Read-only`: there is no write path, and a working editor over fictional
files would be a simulation. The editor is built on an editable compartment so
enabling writes is a change of capability, not of architecture. Local folders
found on disk are not listed in the launcher, because detecting them needs
native folder access; the column says so instead of showing example paths.

Live providers follow the Core flows frames designed for them: "8 · Context
window popover", "9 · Approvals & access", "10 · Live activity",
"11 · File links & web preview" and "12 · Reply states", with focus mode
(44U-0) for the transcript's geometry.

- **Turn log.** A turn's reads, searches, edits and commands are one log,
  open while the agent works and folded to what it did ("Edited 2 files, ran
  2 commands") when it ends. The agent's words between actions sit in the log;
  the answer after the last action, the files it changed and any local server
  stay outside.
- **Messages** ("13 · Messages: copy, times & gaps"). At rest a message is
  only its words. Hover or focus shows a user message's time and Copy, and an
  agent reply's Copy under its answer (the answer as Markdown); the row keeps
  its space so the thread never moves. A finished reply's heading says
  "Worked for …" from the times its turn recorded; a stopped turn, or one
  saved before JAM recorded turn ends, shows no duration. After 30 minutes or
  on a new day a hairline divider names when the chat picked up again. Times
  follow General → Time format (System, 12-hour or 24-hour). Enter sends and
  Shift+Enter adds a line; nothing sends while an input method is composing.
- **Approvals.** Waiting for the reader uses the accent, never the warning
  colour. A pending approval always shows outside the fold, in the card of the
  action it gates, with the change's lines and exactly the provider's choices;
  allowing choices lead, denying ones end the row. Answered, it is one quiet
  line in the log. Titles and reasons are the provider's own words.
- **Access.** One pill per level: muted Ask for approval, warning Auto-accept
  edits, danger Full access. The menu describes each level in the adapter's
  words for that agent rather than the frame's generic copy.
- **File links.** Project files in inline code, file links and unambiguous
  prose (`src/a.ts`, `a.ts:20`) get a file icon, link colour and an underline.
  Click opens beside the chat at the line; right-click opens in a tab, reveals
  in Finder or Explorer, or copies the path.
- **Diff previews** have no line numbers for Claude, whose edit input has none.
- **Local servers.** A command's localhost address gets "Open web preview"
  (JAM's browser, beside the chat) and, in the desktop app, "Open in browser".
- **Composer.** New Chat follows frame 1a; existing chats show model, effort
  and access pills, the context ring and Stop while running.
- **Settings → Providers.** Frame 604-0 with live data: "Checked … ago" with a
  refresh, version beside the name, Test connection, a status note for version
  or sign-in warnings, and an executable override. Config directory and launch
  arguments remain Planned. Settings → General gains Stream replies.

Window buttons call injected desktop services. The shared client imports no native API. Windows controls sit right; macOS retains the host's native traffic lights with an explicit left inset in sidebar, collapsed and focus presentations, avoiding duplicate web controls. Only noninteractive titlebar space initiates native dragging. Browser preview window actions are unavailable.

## Appearance

The page follows the Paper "Settings v2 · Appearance (stage + library)",
"Library search state" and "Theme editor (create + import)" frames. A preview
stage at the top draws a miniature JAM window from the live tokens, with a
Light/Dark switch (to the current family's other version) and a stepper through
the library. Below it are Interface (accent and the three font rows),
Background & surfaces (surface opacity and blur, and effects, behind "Adjust"
disclosures) and the Library. Every change applies immediately and is saved by
the runtime (ADR 0008). Density is not implemented. The frame's "Auto" scheme
is not modelled, so only Light and Dark are shown.

### Built-in themes

| Theme      | Direction                                                                |
| ---------- | ------------------------------------------------------------------------ |
| Nightglass | Default. Cool near-black glass, one blue accent; the Paper tokens        |
| Tide       | Paper's teal variant: deep sea-green ground, teal accent                 |
| Graphite   | Paper's neutral variant: opaque graphite surfaces, no glow, white accent |
| OLED       | True black panes, stronger borders and text, no glow                     |
| Frost      | Cool light theme: white glass on a pale blue ground, blue accent         |
| Linen      | Warm light reading theme: paper-white panes, ink-blue accent             |

These six are JAM's own. Alongside them are editor themes, each with a dark
and a light version: Claude, GitHub (with Dark Dimmed), Pierre, One (One Dark
Pro and One Light), Vercel, VS Code Plus, Xcode, Gruvbox, Linear, Notion,
Proof and Raycast — 25 in all. They follow each source's public colour system
(Pierre's from its MIT-licensed theme repository); Proof is JAM's own
sage-and-paper reading palette. Each is written as a dozen anchor colours
(`appearance/palettes.ts`) from which one builder derives every role, so they
stay consistent. The builder nudges any colour that would miss a contrast
floor on its own canvas just far enough to pass, so these are JAM's
interpretations rather than exact ports. Editor themes draw solid surfaces.
"Paper", suggested for the warm light theme, is called Linen so it cannot be
confused with the design tool. Graphite keeps Paper's neutral white accent.
Every theme passes the same contrast floors, enforced by tests: body text 7:1,
secondary and muted text 4.5:1, subtle text 3.5:1, accent 3:1 with its
text-safe strong variant 4.5:1, status and code 4.5:1 (comments and
punctuation 3.5:1), and ANSI colours 3:1, each against the theme's own pane.

### Library and your own themes

The library groups families as JAM, Yours and Editor themes. Each family is a
specimen card: one pane per variant, light first, each drawing a sidebar sliver
and three syntax-coloured lines from that variant's own roles
(`appearance/library.ts`), so a card shows the theme itself rather than a
swatch. Choosing a pane applies that variant. A group collapses to one line of
chips (a light/dark swatch and the accent). Search matches names, family names
and "light"/"dark", lists matching variants one by one with the match
highlighted, and takes ↑↓, ↵ and Esc.

"New theme" starts from the current theme's anchors; "Import…" reads a JAM
theme file or a VS Code colour theme (`appearance/import.ts`): workbench
colours give surfaces, text, accent and status, `tokenColors` scopes give
syntax, the terminal palette gives ANSI, and roles the file lacks are taken
from Nightglass or Frost and listed as derived. The editor edits anchor colours
per variant with a live preview (the stage window wrapped in the draft's
tokens) and shows each text and syntax colour's contrast on the canvas.
Colours under a floor are raised just enough whenever the theme is drawn;
"Raise now" writes the raised values into the draft. Custom themes are drawn by
the same builder as editor themes, so every floor above applies to them.

### Semantic tokens

`styles/tokens.css` is Nightglass and the first paint. Themes are data
(`appearance/themes.ts`) resolved to the same roles (`appearance/resolve.ts`),
and a test proves the resolver reproduces tokens.css exactly. Roles:

- **Ground and surfaces:** `bg-base`, the wallpaper layer, sidebar, pane,
  pane-muted, terminal (all translucent), raised, overlay, scrim, browser well.
- **Text:** strong, primary, body, secondary, muted, subtle, faint, ghost.
- **Lines and fills:** border-subtle/border/border-strong and
  fill-subtle/fill/fill-strong, all one tint at small opacities.
- **Accent:** accent, accent-strong, soft, border, glow, secondary, on-accent,
  with `--color-focus` and `--color-selection` naming its two main uses.
- **Status and diff:** success, warning, danger (and soft variants), diff text
  and gutter roles. The accent never changes these.
- **Code:** `--syntax-*` (below). **Terminal:** foreground, cursor, 16 ANSI.
- **Identity:** provider tones and the Codex gradient stops.

Accent choices are JAM Blue, Cobalt, Cyan, Violet, Emerald, Amber, Rose, the
theme's own accent, or a custom colour. Each built-in has a dark and a light
tone; strong, soft, border and glow are derived for the scheme. A custom
accent too close to the pane is moved towards white or black until it reaches
3:1. Pane opacity scales every translucent surface in proportion to the
theme's own opacities, so the sidebar stays lighter than panes.

### Typography

Three independent groups: interface (Geist by default, 12–15px), code (Geist
Mono, 10–20px on a 14–32px line) and terminal (follows the code font unless
chosen, 10–20px on a 14–30px line). Interface sizes in CSS are written as
`calc(Npx * var(--ui-scale))`, where the scale is the chosen size over the
design's 13px; geometry — row heights, pane headers, gutters — does not scale,
so a larger size is more readable rather than a different layout. JAM bundles
only Geist and Geist Mono. The pickers list common families, mark the ones this
computer lacks (WebViews cannot list installed fonts, so JAM measures), and
accept any installed family by name. Nothing is downloaded.

### Code

Grammar tags map to semantic classes (`code/highlight.ts`) coloured by the
theme's `--syntax-*` roles in `styles/code.css`: keyword, string, number,
function, type, property, variable, definition, operator, punctuation, comment,
tag, attribute, meta, heading, link, code, quote and marker. The editor, fenced
code in Markdown and the Appearance preview share them. Nightglass is
restrained: blue keywords, sage strings, soft amber numbers, pale blue
functions, cyan types and near-body properties, with violet reserved for
attributes and annotations. Markdown source shows headings in strong weight,
emphasis, strong, code spans, links, quotes and the `#`, `-`, `>` and fence
marks; whole list items stay uncoloured. Emphasis uses a synthesized oblique
because only upright faces are bundled; comments stay upright.

Languages are chosen from the file name by the runtime (`language_for`,
mirrored for the preview and checked against a shared fixture): TypeScript,
TSX, JavaScript, JSX, Rust, Python, HTML, CSS, JSON, Markdown, YAML, TOML,
SQL, shell, Dockerfile, `.env`, INI-style config, XML/SVG and ignore files,
including names such as `Dockerfile`, `Cargo.lock`, `.zshrc` and
`.gitignore`. Each grammar is its own lazily loaded chunk.

### Background, surfaces and effects

Background is the theme's own glow, a solid colour, a gradient or an image.
Brightness, saturation and blur filter only that layer, never panes or text.
"Match colours to image" samples the wallpaper once at 48×48 and takes the
accent from its most vivid hue family and a surface tint from its own darkest
(or lightest) tone; text, code and status colours are untouched, so contrast
still holds.

The sidebar and the main panes each have their own opacity and blur. Three
styles set them at once: **Glass** (the theme's translucency, blurred), **Solid**
(opaque, no blur) and **Clear** (an opaque sidebar and a fully transparent main
pane over an unblurred background, dimmed and faded so text stays readable,
with the composer on its solid raised card — the owner's halftone reference).
Backdrop blur is emitted as `none` unless there is detail to soften (an image
or a pattern) and the surface is translucent, since WebKit composites even a
zero blur.

Effects sit between the background and the panes: a pattern (halftone dots,
scanlines, a fine grid or film grain, with strength and size), a fade towards
the bottom edge and a vignette. They are CSS gradients and one small SVG noise
tile, painted once; nothing animates. They darken towards the theme's ground,
so on a light theme they lighten. Page content in a Browser resource keeps its
own colours.

## Markdown

A Markdown file opens in Preview; the pane header's capsule (the Browser
frame's tool capsule) switches to Source, and the choice is kept per file for
the session. The preview is a reading surface on the Single transcript's 700px
measure in the interface font at body size and line: headings by weight and
size with hairline rules under the first two levels, links in accent-strong
with a soft underline, blockquotes on an accent-border rule, tables and code
blocks on the raised surface with the theme's borders, inline code on a fill
chip in the code font, task lists with read-only checkboxes, and front matter
shown as a quiet YAML block. Code blocks carry their language and a Copy
button. Links open inside JAM (ADR 0008); remote and project images show a
labelled placeholder. Unsaved Source edits appear in Preview.

## Settings icons

The Settings navigation icons are Paper's own vectors, not a library's:
drawn on a 16-unit grid, rendered at 14px inside a 16px slot, 1.3-unit glyph
strokes and 1.2 for large outlines, coloured through `currentColor` — muted,
and accent on the selected row. Rows follow the frame: 30px, 8px padding, a
9px gap, 13px text. Every page is reachable; pages that are not built yet say
so rather than being disabled, which kept the navigation identical to Paper.

## Snapshots settings

The page follows the Paper "Settings v2 · Snapshots" frame with two deliberate
changes. The shortcut is a picker, not a fixed double-tap with Change: Both
Shift keys (the default, as in T3 Code), ⌘⇧2, ⌃⇧2 and ⌥⇧2. No option needs
Input Monitoring, and the page never asks for it. A setup card, not yet drawn in
Paper, appears when Snapshots is turned on without Screen Recording: one step
with why it is needed, Allow and Open System Settings, and a check once allowed.
Turn on Snapshots stays disabled until it is allowed, and the header toggle
shows the effective state. A healthy page carries no status text; only a problem the user can act on
is shown, in the danger role under the header.

## Verification

Compare the running shell with Paper at 1440×900 in Single and Tiles; inspect sidebar width, transcript bounds, title/pane heights, gutters, typography and focus states. Check a smaller supported window for clipping and overflow. Exercise search, filters, draft preservation, view close/reopen during streaming, stop, failure, new chat and both Settings modes. Browser screenshots verify web rendering only; native window drag/chrome, WebView behavior, persistence and platform accessibility require desktop testing.
