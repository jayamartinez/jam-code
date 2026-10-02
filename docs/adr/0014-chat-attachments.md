# 0014 — Files attached to chats

Status: accepted for v0.1.0-alpha (2026-10-01). Extends ADR 0004's context
model and reuses ADR 0009's rule that binary context is a runtime-owned asset
behind an opaque ID.

## Context

A chat could carry project files, selections, browser annotations and
snapshots, but not a file from elsewhere on the computer: a log in Downloads,
a PDF on the Desktop. That needs a file chooser, and it needs answers to two
questions: what a chosen file _is_ afterwards, and how it reaches an agent.

It is not a project file. A project file is addressed by project ID and a
relative path that the runtime resolves and checks on every use; the grant is
the project folder. A chosen file is one file, anywhere, granted once by the
reader picking it in the operating system's dialog. Treating it as a path the
client holds would turn that one grant into a standing ability to name paths.

Delivery differs per provider. Claude Code's stream-json input and Codex's
`turn/start` document text and images only (Codex 0.157's generated schema:
`text`, `image`, `localImage`, audio, `skill`, `mention`). Other agents JAM
Code plans to support take other sets. A design built on what each protocol
carries would mean a different list of attachable types per agent, and
parsing or refusing everything else. T3 Code (MIT) was read as a reference
for this decision, not copied: it gives every agent the file's path and lets
each adapter add native delivery where its provider has it.

## Decision

**The chooser is the grant, and the host is the only caller.** Attach opens
the native file dialog in the desktop host (`attach_files`). Each chosen path
goes from the dialog straight to `Runtime::import_attachment`, which is a
host API, not a `JamTransport` request. The interface passes no path in and
gets none back, so nothing it sends can make the runtime read a file. Where
there is no host (the browser preview), the control is disabled and says so.

**Import is a copy.** The runtime reads the file once and copies it, byte for
byte, into `attachments/` in the application-data folder under an opaque
`attachment-<uuid>` ID with the file's own short extension. It records a
display name, a type label and the size. The original is never read again and
its location is not recorded, in the attachment, the transcript, the search
index or anything sent to a provider.

**Every agent gets the copy's path.** A Send adds one line per attachment to
the turn's text, naming the file and where JAM Code's copy is, and the agent
opens it with its own tools. This needs nothing from a provider's protocol,
so any file type can be attached and a new adapter supports attachments
without doing anything. The file is not pasted into the prompt, so a large log
costs no context until the agent reads the part it needs. JAM Code never
parses, converts or truncates a file.

**An adapter may also send natively.** `ProviderTurn.files` lists every
attachment for adapters whose provider takes a type directly. Today that is
images: a PNG, JPEG, GIF or WebP of at most 5 MB, recognized by content rather
than by name, is also sent as an image when the model accepts images. A
larger image, an SVG and everything else are files.

**One folder per conversation.** A staged copy sits in the store's root. When
it is sent it moves into `attachments/<conversation ID>/`, before the turn is
saved, so the path the agent is given is final; if the save fails it moves
back. That folder is the only one a conversation's agent is pointed at:
`ProviderTurn.attachment_dir`, which the Claude Code adapter passes as
`--add-dir` so its Read tool needs no approval there. A process started before
the chat had attachments is restarted and resumes the same session. An agent
is never given another conversation's folder or the store's root.

**One store for owned assets.** Snapshots and attachments share `AssetDir`:
a private directory that must not be a link, file and folder names built only
from validated identifiers, create-if-absent writes, moves that never replace
a file, bounded reads that do not follow links, and single-file deletion.

**Lifetime follows ownership.**

| State  | Where                         | Owner                                                     | Removed                                                 |
| ------ | ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| Staged | `attachments/`                | Nobody yet: a new chat has no conversation until it sends | With its chip, after 24 hours, and at the next start    |
| Sent   | `attachments/<conversation>/` | The one conversation that sent it                         | Only when that conversation is deleted, with its folder |

Sending resolves each attachment against the store inside the turn's
transaction: it must exist and be unsent, the client's copy of its metadata is
replaced by the record, and it becomes that conversation's. An attachment is
therefore sent at most once; a retried Send returns its receipt before any of
this runs. Attaching the same file again is a new copy.

**Limits** (one fixture, read by the runtime and the client): 16 files per use
of the chooser; files up to 25 MB; images sent natively up to 5 MB each and
12 MB per Send; 100 MB of attachments per Send; names shown up to 120
characters; at most 64 attachments waiting to be sent.

## Consequences

- A folder, a link, a device, an empty file and a file over the limit are
  refused by name with the reason. A chosen link is not followed; the reader
  picks the file it points to.
- What an agent can do with a file is up to the agent. Claude Code's Read
  tool opens PDFs and images; an agent whose tools cannot read a type says so
  itself. JAM Code makes no promise about a type beyond delivering the copy.
- Image capability is checked before Send in the composer and again by the
  runtime; an image is never dropped silently while the text goes through.
- The path given to a provider is inside JAM Code's application-data folder,
  so it contains the operating-system user name, as the project path already
  does.
- Codex is given no folder grant; it relies on its sandbox allowing reads
  outside the workspace. This has not been verified on Windows with "Ask for
  approval" and is listed in VALIDATION.md.
- Drag and drop and clipboard paste are not implemented; they would enter
  through the same host import.
- Closing a new chat that has staged attachments leaves their copies until
  the retention limit or the next start removes them.
- Previews are served by ID from JAM Code's copy, and the runtime decides what
  a copy may be shown as from its first bytes, never from its name or recorded
  type. A PNG, JPEG, GIF or WebP is shown as an image. A PDF is shown in the
  web view's built-in PDF viewer, in a frame. A file that is UTF-8 text shows
  its first 256 KB as text. Everything else has no preview. HTML and SVG are
  only ever shown as text. JAM Code never opens an attachment with another
  program; any attachment can be shown in Finder or Explorer, which selects
  the copy without opening it.
- The PDF frame is the one frame in the interface, so the content security
  policy allows `frame-src blob:` and nothing else. The interface makes a blob
  only from bytes the runtime served as `application/pdf`. A blob document
  inherits the policy of the page that made it, so it cannot load scripts the
  application could not. How the viewer looks is the web view's: WebView2's
  on Windows, WebKit's on macOS.
- An image or PDF preview crosses the transport whole as a data URL, up to the
  25 MB file limit. That is acceptable for an explicit click; it is not a
  streaming path.
- A reply that names an attached file in inline code, by its name or by the
  path of the copy, links to that preview. Matching is exact and happens in
  the interface; nothing is added to what the agent wrote.
