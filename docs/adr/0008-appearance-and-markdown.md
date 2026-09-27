# 0008 — Appearance is a runtime setting; Markdown renders without HTML

Status: accepted.

## Context

JAM's customization (theme, accent, type, background) had been a few editor
font preferences kept in the WebView's `localStorage`. That store belongs to
one browser profile, is invisible to the runtime and to any future client, and
is where a wallpaper image would have ended up as megabytes of string.
Separately, agents write reports, plans and research as Markdown, and a
repository's Markdown is untrusted content that JAM's own window now renders.

## Decision

### Appearance

- **Ownership.** Appearance is a persistent product setting, owned by the
  runtime. Migration 003 adds a `settings` table (key, JSON value, updated
  time). `appearance.get`, `appearance.update` (whole-record replace) and
  `appearance.setWallpaper` are ordinary `jam_request` methods; no new IPC
  command or capability is added.
- **One contract.** Theme and accent names, background modes, defaults and
  every numeric bound live in `packages/protocol/fixtures/appearance.json`,
  read by the TypeScript validators and the Rust runtime alike. A font family
  must be letters, digits, spaces and `._-`, so it can never escape the quoted
  CSS string it is placed in.
- **Client projection.** `AppearanceStore` applies a change immediately,
  writes the last change of a burst (300 ms) to the runtime, serializes writes
  so an older one never lands last, and flushes on `pagehide`. A copy of the
  last record in `localStorage` is used only for first paint, so a Frost user
  does not see a flash of Nightglass; it is never read as the source of truth.
  The old per-profile editor font is carried into the runtime record once.
- **Forward-compatible reads.** Updates are strict whole records, but a stored
  record is read over the fixture's defaults, so fields added by a later
  version (per-surface blur, effects, auto colours) never make an earlier
  record unreadable.
- **Tokens, not components.** Settings resolve to semantic custom properties
  (`appearance/resolve.ts`), written into one `<style>` element. Components,
  CodeMirror (through class names) and xterm (through the pane's roles) read
  roles only; a theme change re-renders nothing that draws colour.
- **Wallpapers are copied.** A chosen image arrives through a file input, so
  the interface receives bytes and never a path. It is decoded once, drawn no
  larger than 2560 px on its long edge, re-encoded as WebP or JPEG and stored
  in the runtime as a bounded `data:` URL (8 M UTF-16 units at most) under its
  own key, so saving a font size never rewrites image data. Moving or deleting
  the original changes nothing, and no absolute path is stored. `data:` images
  were already allowed by the content policy; `blob:` and the asset protocol
  are not needed.

### Markdown

- **Parse, then build elements.** markdown-it parses CommonMark with GitHub
  tables and strikethrough, with raw HTML disabled, so markup in a document is
  shown as text. Its tokens become React elements through an allow-list, one
  element per token type; attributes are never copied from the source and
  nothing is assigned to `innerHTML`. There is no sanitizer to bypass because
  no HTML string exists.
- **Links.** Every destination is classified before rendering: a heading in
  the same document (scrolled to), an `http(s)` page (opened in a new Browser
  resource, the isolated native view with its own profile), a path inside the
  same project (opened as a File resource; paths that climb out of the project
  are refused), or nothing. The real destination is never an `href`, so JAM's
  own window cannot navigate on any kind of click. `javascript:`, `data:`
  documents, `file:`, custom schemes and malformed input render as text.
- **Images.** Only inline raster `data:` images load. Remote images are not
  fetched (tracking pixels, and the content policy blocks them); project images
  wait for a binary file service. Both render as a labelled placeholder.
- **Cost.** markdown-it and the preview are a lazily loaded chunk (≈44 KB
  gzip), fetched the first time a Markdown file is shown in Preview.

## Consequences

- A future remote client reads the same appearance as the desktop.
- The runtime validates appearance but never interprets it.
- Mermaid, raw HTML in Markdown, and project images in the preview are not
  supported. Adding project images needs a binary, project-scoped file read.
- Wallpaper decoding costs one full-size bitmap in the compositor (about
  16 MB at 2560×1600), the same as any image of that size.
