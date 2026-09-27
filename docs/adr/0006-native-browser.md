# 0006 — Browser is a native child webview owned by the desktop host

Status: accepted for the Browser prototype. Validated on macOS 26 (WKWebView) in the native app; Windows (WebView2) untested.

## Context

Browser has to handle localhost previews, arbitrary HTTPS sites, sign-ins,
several independent pages, annotations and eventually agent control. An
`<iframe>` in JAM's interface cannot do this. `X-Frame-Options` and CSP
`frame-ancestors` block most real sites. Cookies become third-party. The page
shares JAM's process and CSP, and JAM's own policy is `frame-src 'none'`.
Bundling Chromium (Electron or CEF) would add a full browser build to every
installation.

Tauri 2.11+ can place extra webviews inside a window through `Window::add_child`,
behind its `unstable` feature. Each child is a real platform browser: WKWebView
on macOS and WebView2 on Windows. It can be positioned, resized, shown, hidden,
focused, navigated, reloaded, evaluated against, and given its own data store.

## Decision

Each Browser resource is shown by one native child webview of the main window.
The desktop host (`apps/desktop/src-tauri/src/browser.rs`) owns it, keyed by
resource ID. The shared client never imports Tauri. It receives a `BrowserHost`
through `DesktopServices` and does three things: reports the rectangle where its
pane wants the page, forwards typed commands, and renders the state the host
sends back.

- **Lifetime follows JAM's view rules.** Attaching a pane creates no webview;
  the first navigation does, so an empty Browser costs no web content
  process. Unmounting a pane, switching tabs, or opening Settings hides the
  view (`setBounds(null)`). Only the explicit `browser_close` command (the
  pane menu's "Close browser page") destroys the page and its process; the
  resource then opens blank. When the interface reloads, every view is hidden and
  its listener dropped until a pane claims it again. At most 8 views may be
  live at once.
- **Geometry.** The pane measures its page slot with `getBoundingClientRect`
  in CSS pixels, which are logical window pixels at zoom 1. Updates are
  coalesced to one per animation frame and sent only when the rounded
  rectangle changes. Triggers are every render (layout reducer changes
  re-render panes), ResizeObserver on the slot and the document, and window
  resize. Nothing polls while idle.
- **Overlays.** A native view paints above the whole HTML document. Every
  floating JAM surface (dialogs, context and pane menus, the launcher)
  registers with `native-occlusion`, and native views hide while any is open.
- **One place per view.** If a resource is shown in two panes, the most
  recently mounted pane presents it and the other says so.
- **Isolation.** Pages are untrusted. Tauri injects its IPC bridge into every
  webview it creates. A capability with `windows: ["main"]` matches every
  webview inside that window, so the capability is scoped with
  `webviews: ["main"]`. Browsed pages then match no capability, and every
  command, including `jam_request`, is denied. The host allows navigation
  only to `http(s)` URLs with a host, plus `about:blank`. It turns
  `window.open`/`target=_blank` into same-view navigation and refuses
  downloads. Browsing data lives in a separate profile:
  `data_store_identifier` on macOS 14+ and a `browser-profile` data directory
  on Windows.
- **No page-to-host channel.** Everything JAM learns from a page's contents
  comes from host-initiated `eval_with_callback`: history availability,
  console ring, annotations. It is labelled as page data. Finished
  annotations are collected by asking the page every 200 ms, at most 16 per
  poll. The page can replace JAM's script, so the host parses each
  annotation into a fixed shape with bounded fields and drops anything else
  before it reaches the interface. This runs only while the reader has
  annotate mode on, with a 30-minute cap. URL, title and load state
  come from native callbacks (`on_page_load`, `on_document_title_changed`,
  `on_navigation`).
- **Runtime.** The runtime keeps owning resource identity. Every
  `resource.open` of kind `browser` creates a new resource, because each
  browser is its own page and history. The live page is host state, like the
  native window, and is not persisted yet.

## Consequences

- There is no Chromium to bundle. The cost is the platform differences
  ARCHITECTURE.md already anticipated: WKWebView and WebView2 differ in
  inspection, history introspection, snapshots and devtools.
- Native views cannot be clipped by CSS, rounded or drawn over. The page is
  square-cornered inside its 12px well, and menus hide pages while open.
- With `unstable`, every webview, JAM's own included, is built as a child
  view. The per-webview `traffic_light_position` is then ignored on macOS, so
  the main window is built from a `WindowConfig`, whose traffic-light
  position is applied by the window (tao) and survives resizes. On Windows
  the undecorated window no longer gets its edge-resize handler at creation,
  so the host re-asserts `set_resizable(true)`. That is untested on Windows.
- `get_webview_window("main")` stops finding the main window once a child
  webview exists, so the host uses `get_window("main")`. The global
  `on_page_load` hook sees Browser pages too and only reacts to `main`.
- Keyboard focus inside a page belongs to that page. JAM's shortcuts do not
  fire while a browsed page has focus. Fixing this needs native menu
  accelerators or a page-to-host channel, and both are deferred.
- Region capture and screenshots need `WKWebView.takeSnapshot` or WebView2
  `CapturePreview`. Both need platform code, which the workspace's
  `unsafe_code = "forbid"` excludes from the host crate. A small dedicated
  crate or plugin is the likely path.
- `unstable` is a Tauri feature flag, not a prerelease. Its child-webview API
  may change in a minor release, and upgrades must re-run the Browser checks
  in VALIDATION.md.

## Alternatives

- **iframe**: rejected for the reasons above.
- **Separate native browser window**: works everywhere but abandons JAM's pane
  model. Kept as a fallback only if a platform cannot embed children.
- **Bundled Chromium/CEF**: better automation parity (CDP) at a large install
  and update cost. The `BrowserHost` interface is the seam where such a
  backend, or a CDP-controlled external browser, could be added without
  changing the client.
