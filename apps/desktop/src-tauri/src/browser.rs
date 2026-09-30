//! Native Browser views.
//!
//! Each Browser resource is presented by one native child webview (WKWebView
//! on macOS, WebView2 on Windows) placed over its pane in the main window. The
//! React client never touches it directly: it reports the pane's rectangle and
//! issues typed commands, and this module owns the webview's lifetime.
//!
//! A pane attaching to a browser creates no webview: the first navigation
//! does, so an empty Browser costs no web content process. Closing or hiding a
//! pane only hides the page, exactly like any other resource. The page is
//! destroyed only by the explicit `browser_close` command, so it keeps its
//! state while the reader switches tabs.
//!
//! Browsed pages are untrusted. Tauri injects its IPC bridge into every
//! webview it creates, so isolation rests on the capability file granting
//! commands to the `main` webview only, never to the window. The page gets no
//! JAM command of its own: everything it could tell us is read by the host on
//! request with `eval_with_callback`, and those results are treated as page
//! data, not facts.

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl,
    ipc::Channel,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
};

/// Each view is a full web content process; bound how many can live at once.
const MAX_VIEWS: usize = 8;
/// Largest rectangle accepted from the client, in logical pixels.
const MAX_EDGE: f64 = 16_384.0;
/// URLs longer than this are refused rather than shipped around.
const MAX_URL: usize = 8_192;
/// Annotate mode ends by itself after this long, so collection cannot run on
/// forever in a forgotten pane.
const ANNOTATE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const ANNOTATE_INTERVAL: Duration = Duration::from_millis(200);

/// Browsed sites keep their cookies and storage in a profile separate from
/// JAM's own interface. macOS names a WKWebsiteDataStore; Windows points
/// WebView2 at its own user-data folder.
#[cfg(target_os = "macos")]
const PROFILE_ID: [u8; 16] = *b"jam-browser-prof";

#[derive(Default)]
pub struct BrowserHost {
    views: Mutex<HashMap<String, View>>,
}

/// One Browser resource as the host knows it. `webview` exists only while a
/// page is open; `bounds` is where the page belongs whenever it is.
struct View {
    webview: Option<Webview>,
    bounds: Option<Bounds>,
    state: BrowserState,
    channel: Option<Channel<BrowserEvent>>,
    annotating: bool,
}

impl BrowserState {
    fn blank() -> Self {
        Self {
            url: "about:blank".into(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    url: String,
    title: String,
    loading: bool,
    /// `None` when the platform cannot say; the client keeps the control usable.
    can_go_back: Option<bool>,
    can_go_forward: Option<bool>,
    /// Why the last navigation was refused, if it was.
    blocked: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum BrowserEvent {
    State {
        state: BrowserState,
    },
    /// One finished annotation (element or region, with its comment).
    /// Everything in it came from the page.
    Annotated {
        annotation: Annotation,
    },
    AnnotateEnded,
}

/// The largest poll result read from a page. A page that answers with more
/// has replaced JAM's script, and its answer is dropped.
const MAX_POLL_RESULT: usize = 256 * 1024;

#[derive(Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationKind {
    Element,
    Region,
}

#[derive(Deserialize, Serialize, Clone, Copy, Default)]
pub struct AnnotationRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ConsoleEntry {
    level: String,
    text: String,
    #[serde(default)]
    at: f64,
}

/// An annotation as the page reported it. The page can replace JAM's script,
/// so this is parsed into a fixed shape and every field is bounded before it
/// reaches the interface; anything that does not fit is dropped.
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    kind: AnnotationKind,
    /// Its number on the page. An edited annotation comes again with the same one.
    #[serde(default)]
    index: u32,
    #[serde(default)]
    comment: String,
    #[serde(default)]
    selector: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    html: String,
    #[serde(default)]
    rect: AnnotationRect,
    #[serde(default)]
    styles: std::collections::BTreeMap<String, String>,
    url: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    console: Vec<ConsoleEntry>,
    #[serde(default)]
    console_errors: u32,
}

fn clip(text: &mut String, max: usize) {
    if let Some((index, _)) = text.char_indices().nth(max) {
        text.truncate(index);
    }
}

impl Annotation {
    /// Bounds match what JAM's own annotate script produces.
    fn bounded(mut self) -> Option<Self> {
        let rect = [self.rect.x, self.rect.y, self.rect.width, self.rect.height];
        if rect.iter().any(|v| !v.is_finite() || v.abs() > MAX_EDGE) {
            return None;
        }
        clip(&mut self.comment, 2_000);
        clip(&mut self.selector, 1_000);
        clip(&mut self.label, 200);
        clip(&mut self.text, 300);
        clip(&mut self.html, 600);
        clip(&mut self.url, MAX_URL);
        clip(&mut self.title, 300);
        self.styles = std::mem::take(&mut self.styles)
            .into_iter()
            .take(16)
            .map(|(mut name, mut value)| {
                clip(&mut name, 64);
                clip(&mut value, 200);
                (name, value)
            })
            .collect();
        self.console.truncate(10);
        for entry in &mut self.console {
            if entry.level != "error" {
                entry.level = "warn".into();
            }
            clip(&mut entry.text, 500);
            if !entry.at.is_finite() {
                entry.at = 0.0;
            }
        }
        Some(self)
    }
}

/// Parses one poll's annotations, keeping at most 16 that fit.
fn annotations_from(items: &[serde_json::Value]) -> Vec<Annotation> {
    items
        .iter()
        .take(16)
        .filter_map(|item| serde_json::from_value::<Annotation>(item.clone()).ok())
        .filter_map(Annotation::bounded)
        .collect()
}

#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Bounds {
    fn validate(self) -> Result<Rect, String> {
        let values = [self.x, self.y, self.width, self.height];
        if values.iter().any(|v| !v.is_finite() || v.abs() > MAX_EDGE)
            || self.width < 0.0
            || self.height < 0.0
        {
            return Err("Invalid browser bounds.".into());
        }
        Ok(Rect {
            position: LogicalPosition::new(self.x, self.y).into(),
            size: LogicalSize::new(self.width, self.height).into(),
        })
    }
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum BrowserAction {
    Back,
    Forward,
    Reload,
    Stop,
    Focus,
    Annotate,
    StopAnnotating,
    ClearAnnotations,
}

fn validate_id(id: &str) -> Result<(), String> {
    let valid = id.starts_with("browser-")
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if valid {
        Ok(())
    } else {
        Err("Invalid browser resource.".into())
    }
}

/// What JAM itself will open: ordinary web pages only.
fn allowed(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

/// What a page may load. WKWebView asks about subframes too, and real sites
/// use `about:srcdoc`, `data:` and `blob:` frames, so those pass; local
/// files and the app's own protocols (`tauri:`, `ipc:`, `asset:`) never do.
/// WebKit and WebView2 already refuse page-initiated top-level `data:`.
fn page_may_load(url: &Url) -> bool {
    allowed(url) || matches!(url.scheme(), "about" | "data" | "blob")
}

fn parse_url(text: &str) -> Result<Url, String> {
    if text.len() > MAX_URL {
        return Err("That address is too long.".into());
    }
    let url = Url::parse(text).map_err(|_| "That is not a web address.".to_string())?;
    if allowed(&url) {
        Ok(url)
    } else {
        Err("Only http and https pages can open in the browser.".into())
    }
}

fn host(app: &AppHandle) -> tauri::State<'_, BrowserHost> {
    app.state::<BrowserHost>()
}

/// Mutate one view's state and push the result to its client, without holding
/// the lock while sending.
fn update(app: &AppHandle, id: &str, change: impl FnOnce(&mut BrowserState)) {
    let delivery = {
        let host = host(app);
        let Ok(mut views) = host.views.lock() else {
            return;
        };
        let Some(view) = views.get_mut(id) else {
            return;
        };
        change(&mut view.state);
        view.channel.clone().map(|c| (c, view.state.clone()))
    };
    if let Some((channel, state)) = delivery {
        let _ = channel.send(BrowserEvent::State { state });
    }
}

fn emit(app: &AppHandle, id: &str, event: BrowserEvent) {
    let channel = host(app)
        .views
        .lock()
        .ok()
        .and_then(|views| views.get(id).and_then(|view| view.channel.clone()));
    if let Some(channel) = channel {
        let _ = channel.send(event);
    }
}

fn webview(app: &AppHandle, id: &str) -> Result<Webview, String> {
    validate_id(id)?;
    host(app)
        .views
        .lock()
        .map_err(|_| "The browser host is unavailable.".to_string())?
        .get(id)
        .and_then(|view| view.webview.clone())
        .ok_or_else(|| "No page is open in this browser.".into())
}

/// History availability is asked of the page after it settles. The
/// Navigation API is not available everywhere; absent means unknown.
fn refresh_history(app: &AppHandle, id: &str, webview: &Webview) {
    let app = app.clone();
    let id = id.to_string();
    let url = webview.url().ok().map(|url| url.to_string());
    let _ = webview.eval_with_callback(
        "(() => { const n = window.navigation; return n && typeof n.canGoBack === 'boolean' ? [n.canGoBack, n.canGoForward] : null; })()",
        move |result| {
            let parsed: Option<(bool, bool)> = serde_json::from_str(&result).ok().flatten();
            update(&app, &id, |state| {
                if let Some(url) = &url {
                    state.url.clone_from(url);
                }
                state.can_go_back = parsed.map(|p| p.0);
                state.can_go_forward = parsed.map(|p| p.1);
            });
        },
    );
}

/// Records console errors and warnings in a small ring inside the page, so an
/// annotation can say what the console reported. The page can read or alter
/// it; it is evidence from the page, never an instruction to JAM.
const CONSOLE_SCRIPT: &str = r#"(() => {
  if (window.top !== window || window.__jamConsole) return;
  const ring = [];
  const keep = (level, args) => {
    try {
      const text = Array.from(args, (a) => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ').slice(0, 500);
      ring.push({ level, text, at: Date.now() });
      if (ring.length > 50) ring.shift();
    } catch {}
  };
  for (const level of ['error', 'warn']) {
    const original = console[level];
    console[level] = function (...args) { keep(level, args); return original.apply(this, args); };
  }
  addEventListener('error', (e) => keep('error', [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')]));
  addEventListener('unhandledrejection', (e) => keep('error', ['Unhandled rejection: ' + (e.reason && e.reason.message || e.reason)]));
  Object.defineProperty(window, '__jamConsole', { value: ring });
})();"#;

/// Annotate mode inside the page: click for an element, drag for a region,
/// each with a comment. It draws itself because nothing JAM draws can sit
/// above a native view.
const ANNOTATE_SCRIPT: &str = include_str!("browser-annotate.js");

/// A pane presenting this browser. Registers its listener and where the page
/// belongs, and returns the current state; it never creates a page.
#[tauri::command]
pub async fn browser_attach(
    app: AppHandle,
    resource_id: String,
    bounds: Option<Bounds>,
    on_event: Channel<BrowserEvent>,
) -> Result<BrowserState, String> {
    validate_id(&resource_id)?;
    if let Some(bounds) = bounds {
        bounds.validate()?;
    }
    let (webview, state) = {
        let host = host(&app);
        let mut views = host
            .views
            .lock()
            .map_err(|_| "The browser host is unavailable.")?;
        let view = views.entry(resource_id).or_insert_with(|| View {
            webview: None,
            bounds: None,
            state: BrowserState::blank(),
            channel: None,
            annotating: false,
        });
        view.channel = Some(on_event);
        view.bounds = bounds;
        (view.webview.clone(), view.state.clone())
    };
    if let Some(webview) = webview {
        place(&webview, bounds)?;
    }
    Ok(state)
}

/// Opens the page for a browser that has none yet.
fn create(app: &AppHandle, id: &str, url: Url) -> Result<(), String> {
    let bounds = {
        let host = host(app);
        let views = host
            .views
            .lock()
            .map_err(|_| "The browser host is unavailable.")?;
        let open = views.values().filter(|view| view.webview.is_some()).count();
        if open >= MAX_VIEWS {
            return Err(format!(
                "At most {MAX_VIEWS} browser pages can be open. Close one from its pane menu first."
            ));
        }
        views.get(id).ok_or("That browser is not attached.")?.bounds
    };
    let window = app
        .get_window("main")
        .ok_or("The main window is unavailable.")?;
    let rect = match bounds {
        Some(bounds) => bounds.validate()?,
        None => Bounds {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        }
        .validate()?,
    };
    let webview = window
        .add_child(builder(app, id, url), rect.position, rect.size)
        .map_err(|e| format!("The browser could not start: {e}"))?;
    if bounds.is_none() {
        let _ = webview.hide();
    }
    let orphan = {
        let host = host(app);
        let mut views = host
            .views
            .lock()
            .map_err(|_| "The browser host is unavailable.")?;
        match views.get_mut(id) {
            Some(view) if view.webview.is_none() => {
                view.webview = Some(webview);
                None
            }
            // Closed or superseded while starting; do not leak the page.
            _ => Some(webview),
        }
    };
    if let Some(webview) = orphan {
        let _ = webview.close();
    }
    Ok(())
}

fn builder(app: &AppHandle, id: &str, url: Url) -> WebviewBuilder<tauri::Wry> {
    let nav_app = app.clone();
    let nav_id = id.to_string();
    let load_app = app.clone();
    let load_id = id.to_string();
    let title_app = app.clone();
    let title_id = id.to_string();
    let window_app = app.clone();
    let window_id = id.to_string();

    let builder = WebviewBuilder::new(id, WebviewUrl::External(url))
        .initialization_script(CONSOLE_SCRIPT)
        .accept_first_mouse(true)
        .on_navigation(move |url| {
            let ok = page_may_load(url);
            if !ok {
                let scheme = url.scheme().to_string();
                update(&nav_app, &nav_id, |state| {
                    state.blocked = Some(format!("Blocked a {scheme}: navigation."));
                });
            }
            ok
        })
        .on_page_load(move |webview, payload| {
            let url = payload.url().to_string();
            match payload.event() {
                PageLoadEvent::Started => update(&load_app, &load_id, |state| {
                    state.url = url;
                    state.loading = true;
                    state.blocked = None;
                }),
                PageLoadEvent::Finished => {
                    update(&load_app, &load_id, |state| {
                        state.url = url;
                        state.loading = false;
                    });
                    refresh_history(&load_app, &load_id, &webview);
                }
            }
        })
        .on_document_title_changed(move |webview, title| {
            let title: String = title.chars().take(300).collect();
            update(&title_app, &title_id, |state| state.title = title);
            // Single-page apps change the address without a page load; the
            // title is the cheapest signal that something moved.
            refresh_history(&title_app, &title_id, &webview);
        })
        // `window.open` and target=_blank stay in this pane instead of
        // creating an unmanaged native window.
        .on_new_window(move |url, _| {
            if allowed(&url)
                && let Ok(webview) = webview(&window_app, &window_id)
            {
                let _ = webview.navigate(url);
            }
            NewWindowResponse::Deny
        })
        // Downloads need a destination and consent flow that does not exist yet.
        .on_download(|_, _| false);

    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(PROFILE_ID);
    #[cfg(not(target_os = "macos"))]
    let builder = match app.path().app_data_dir() {
        Ok(dir) => builder.data_directory(dir.join("browser-profile")),
        Err(_) => builder,
    };
    builder
}

fn place(webview: &Webview, bounds: Option<Bounds>) -> Result<(), String> {
    match bounds {
        Some(bounds) => {
            webview
                .set_bounds(bounds.validate()?)
                .map_err(|e| e.to_string())?;
            webview.show().map_err(|e| e.to_string())
        }
        None => webview.hide().map_err(|e| e.to_string()),
    }
}

/// `None` hides the view: its pane is gone, covered, or not on screen.
#[tauri::command]
pub async fn browser_bounds(
    app: AppHandle,
    resource_id: String,
    bounds: Option<Bounds>,
) -> Result<(), String> {
    validate_id(&resource_id)?;
    if let Some(bounds) = bounds {
        bounds.validate()?;
    }
    let webview = {
        let host = host(&app);
        let mut views = host
            .views
            .lock()
            .map_err(|_| "The browser host is unavailable.")?;
        let Some(view) = views.get_mut(&resource_id) else {
            return Ok(());
        };
        view.bounds = bounds;
        view.webview.clone()
    };
    match webview {
        Some(webview) => place(&webview, bounds),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    resource_id: String,
    url: String,
) -> Result<(), String> {
    validate_id(&resource_id)?;
    let url = parse_url(&url)?;
    match webview(&app, &resource_id) {
        Ok(webview) => webview.navigate(url).map_err(|e| e.to_string()),
        Err(_) => create(&app, &resource_id, url),
    }
}

#[tauri::command]
pub async fn browser_action(
    app: AppHandle,
    resource_id: String,
    action: BrowserAction,
) -> Result<(), String> {
    let view = webview(&app, &resource_id)?;
    let result = match action {
        BrowserAction::Back => view.eval("history.back()"),
        BrowserAction::Forward => view.eval("history.forward()"),
        BrowserAction::Reload => view.reload(),
        BrowserAction::Stop => view.eval("window.stop()"),
        BrowserAction::Focus => view.set_focus(),
        BrowserAction::Annotate => return start_annotating(app, resource_id, view),
        BrowserAction::StopAnnotating => {
            set_annotating(&app, &resource_id, false);
            view.eval("window.__jamAnnotate && window.__jamAnnotate.stop()")
        }
        BrowserAction::ClearAnnotations => {
            view.eval("window.__jamAnnotate && window.__jamAnnotate.clear()")
        }
    };
    result.map_err(|e| e.to_string())
}

fn set_annotating(app: &AppHandle, id: &str, annotating: bool) -> bool {
    host(app)
        .views
        .lock()
        .ok()
        .and_then(|mut views| {
            views.get_mut(id).map(|view| {
                let was = view.annotating;
                view.annotating = annotating;
                was
            })
        })
        .unwrap_or(false)
}

fn is_annotating(app: &AppHandle, id: &str) -> bool {
    host(app)
        .views
        .lock()
        .ok()
        .and_then(|views| views.get(id).map(|view| view.annotating))
        .unwrap_or(false)
}

/// There is deliberately no channel from the page to the host, so finished
/// annotations are collected by asking the page. This runs only while the
/// reader has annotate mode on, and stops when they turn it off, press Escape
/// in the page, the page navigates away, or the timeout passes.
fn start_annotating(app: AppHandle, id: String, view: Webview) -> Result<(), String> {
    if set_annotating(&app, &id, true) {
        return Ok(());
    }
    view.eval(ANNOTATE_SCRIPT).map_err(|e| e.to_string())?;
    let _ = view.set_focus();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        loop {
            tokio::time::sleep(ANNOTATE_INTERVAL).await;
            let (sender, receiver) = tokio::sync::oneshot::channel();
            let sender = Mutex::new(Some(sender));
            let asked = view.eval_with_callback(
                "window.__jamAnnotate ? window.__jamAnnotate.take() : { state: 'gone', items: [] }",
                move |result| {
                    if let Some(sender) = sender.lock().ok().and_then(|mut s| s.take()) {
                        let _ = sender.send(result);
                    }
                },
            );
            if asked.is_err() {
                break;
            }
            if let Ok(Ok(result)) = tokio::time::timeout(Duration::from_secs(2), receiver).await {
                let value: serde_json::Value = if result.len() <= MAX_POLL_RESULT {
                    serde_json::from_str(&result).unwrap_or_default()
                } else {
                    serde_json::Value::Null
                };
                if let Some(items) = value.get("items").and_then(|items| items.as_array()) {
                    // Bounded: a page cannot flood the client in one poll.
                    for annotation in annotations_from(items) {
                        emit(&app, &id, BrowserEvent::Annotated { annotation });
                    }
                }
                if value.get("state").and_then(|s| s.as_str()) != Some("active") {
                    break;
                }
            }
            if !is_annotating(&app, &id) || started.elapsed() > ANNOTATE_TIMEOUT {
                break;
            }
        }
        set_annotating(&app, &id, false);
        let _ = view.eval("window.__jamAnnotate && window.__jamAnnotate.stop()");
        emit(&app, &id, BrowserEvent::AnnotateEnded);
    });
    Ok(())
}

/// The explicit lifecycle command: the page and its process are gone. The
/// browser itself remains and opens blank; its panes are told so.
#[tauri::command]
pub async fn browser_close(app: AppHandle, resource_id: String) -> Result<(), String> {
    validate_id(&resource_id)?;
    let webview = {
        let host = host(&app);
        let mut views = host
            .views
            .lock()
            .map_err(|_| "The browser host is unavailable.")?;
        views.get_mut(&resource_id).and_then(|view| {
            view.annotating = false;
            view.webview.take()
        })
    };
    update(&app, &resource_id, |state| *state = BrowserState::blank());
    if let Some(webview) = webview {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The interface reloaded: its listeners are gone and its panes will measure
/// again. Views stay alive, hidden, until a pane claims them.
pub fn detach_all(app: &AppHandle) {
    let host = host(app);
    let webviews: Vec<Webview> = match host.views.lock() {
        Ok(mut views) => views
            .values_mut()
            .filter_map(|view| {
                view.channel = None;
                view.bounds = None;
                view.annotating = false;
                view.webview.clone()
            })
            .collect(),
        Err(_) => return,
    };
    for webview in webviews {
        let _ = webview.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_pages_are_allowed() {
        for ok in [
            "https://example.com/",
            "http://localhost:5173/x?y=1",
            "about:blank",
        ] {
            assert!(parse_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "tauri://localhost/",
            "ipc://localhost/",
            "asset://localhost/x",
            "about:config",
            "http://",
            "not a url",
        ] {
            assert!(parse_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn pages_may_load_frames_but_never_local_or_app_protocols() {
        let ok = |s: &str| page_may_load(&Url::parse(s).unwrap());
        assert!(ok("about:srcdoc") && ok("data:text/html,x") && ok("https://a.test/"));
        assert!(ok("blob:https://a.test/1b2c"));
        for bad in [
            "file:///etc/hosts",
            "tauri://localhost/",
            "ipc://localhost/jam_request",
            "asset://localhost/x",
            "x-custom://y",
        ] {
            assert!(!ok(bad), "{bad}");
        }
    }

    #[test]
    fn resource_ids_are_constrained() {
        assert!(validate_id("browser-1f0c2a7e-0000-4000-8000-000000000000").is_ok());
        assert!(validate_id("main").is_err());
        assert!(validate_id("browser-../x").is_err());
        assert!(validate_id(&format!("browser-{}", "a".repeat(200))).is_err());
    }

    #[test]
    fn page_annotations_are_parsed_into_a_bounded_shape() {
        let good = serde_json::json!({
            "kind": "element", "comment": "c".repeat(5_000), "selector": "h1", "label": "h1",
            "text": "t", "html": "<h1>", "rect": {"x": 1, "y": 2, "width": 3, "height": 4},
            "styles": {"color": "red"}, "url": "https://a.test/", "title": "A",
            "console": [{"level": "log", "text": "x".repeat(900), "at": 1}], "consoleErrors": 0,
            "index": 1
        });
        let parsed = annotations_from(&[
            good.clone(),
            // Wrong types, a missing URL, or impossible geometry drop the item.
            serde_json::json!({ "kind": "element", "url": 42 }),
            serde_json::json!({ "kind": "script", "url": "https://a.test/" }),
            serde_json::json!({ "kind": "region", "url": "https://a.test/",
                "rect": {"x": 1e300, "y": 0, "width": 1, "height": 1} }),
        ]);
        assert_eq!(parsed.len(), 1);
        let annotation = &parsed[0];
        assert_eq!(annotation.comment.chars().count(), 2_000);
        assert_eq!(annotation.console[0].level, "warn");
        assert_eq!(annotation.console[0].text.chars().count(), 500);
        let many: Vec<_> = std::iter::repeat_n(good, 40).collect();
        assert_eq!(annotations_from(&many).len(), 16);
    }

    #[test]
    fn bounds_are_finite_and_bounded() {
        let ok = Bounds {
            x: 10.0,
            y: 20.0,
            width: 300.0,
            height: 200.0,
        };
        assert!(ok.validate().is_ok());
        for bad in [
            Bounds { width: -1.0, ..ok },
            Bounds { x: f64::NAN, ..ok },
            Bounds { height: 1e9, ..ok },
        ] {
            assert!(bad.validate().is_err());
        }
    }
}
