use crate::{
    appearance::{Appearance, SetWallpaper, UpdateAppearance, Wallpaper},
    commands::*,
    error::JamError,
    events::{self, EventReceiver, Subscriber},
    protocol::*,
    providers::{
        ClaudeAdapter, CodexAdapter, Interactions, MockProvider, ProviderAdapter, ProviderManager,
    },
    storage::Store,
    terminal::{ShellSpec, TerminalManager, TerminalSink},
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::watch;

pub struct Subscription {
    pub id: String,
    pub receiver: EventReceiver,
}
pub(crate) struct RunningTask {
    pub session_id: String,
    pub cancel: watch::Sender<bool>,
    pub handle: tokio::task::JoinHandle<()>,
    /// Closes when the task has fully ended, including a provider still
    /// stopping after an interrupt.
    pub finished: watch::Receiver<()>,
}
pub(crate) struct State {
    pub store: Store,
    pub sequence: u64,
    pub tasks: HashMap<String, RunningTask>,
    subscribers: HashMap<String, Subscriber>,
}

/// The host owns one runtime. Views only subscribe; they never own provider tasks.
pub struct Runtime {
    pub(crate) snapshots: crate::snapshots::SnapshotManager,
    pub(crate) id: String,
    pub(crate) state: Mutex<State>,
    pub(crate) shutting_down: AtomicBool,
    /// Provider adapters and the processes they own.
    pub(crate) providers: ProviderManager,
    /// Approvals and questions waiting for the reader, by JAM interaction ID.
    pub(crate) interactions: Interactions,
    /// Terminal processes. Empty, with no PTY, until a terminal is created.
    pub(crate) terminals: TerminalManager,
    pub(crate) git: crate::git::GitManager,
}

const APPEARANCE_KEY: &str = "appearance";
/// Kept apart from the appearance record so saving a font size never rewrites
/// a megabyte of image data.
const WALLPAPER_KEY: &str = "appearance.wallpaper";

pub(crate) fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4())
}
pub(crate) fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .expect("UTC timestamp is representable")
}

impl Runtime {
    /// Opens the local database with the demo seed, the demo provider and
    /// the real Claude Code and Codex adapters. Adapters start no process
    /// until a provider is checked or a turn is sent.
    pub fn open_demo(path: impl AsRef<Path>) -> Result<Arc<Self>, JamError> {
        Self::open_with(
            path,
            vec![
                Arc::new(MockProvider),
                Arc::new(ClaudeAdapter::default()),
                Arc::new(CodexAdapter::default()),
            ],
        )
    }

    /// Opens with a chosen set of adapters, for tests and alternative hosts.
    pub fn open_with(
        path: impl AsRef<Path>,
        adapters: Vec<Arc<dyn ProviderAdapter>>,
    ) -> Result<Arc<Self>, JamError> {
        let mut store = Store::open(path.as_ref())?;
        store.seed_demo()?;
        Ok(Arc::new(Self {
            id: new_id("runtime"),
            snapshots: crate::snapshots::SnapshotManager::new(
                path.as_ref().parent().unwrap_or_else(|| Path::new(".")),
            ),
            state: Mutex::new(State {
                store,
                sequence: 0,
                tasks: HashMap::new(),
                subscribers: HashMap::new(),
            }),
            shutting_down: AtomicBool::new(false),
            providers: ProviderManager::new(adapters),
            interactions: Interactions::default(),
            terminals: TerminalManager::default(),
            git: crate::git::GitManager::default(),
        }))
    }

    pub(crate) fn lock(&self) -> Result<MutexGuard<'_, State>, JamError> {
        self.state.lock().map_err(|_| {
            JamError::new(
                "internal",
                "Runtime state is unavailable after an internal failure.",
            )
        })
    }

    pub(crate) fn cursor(&self, state: &State) -> Cursor {
        Cursor {
            runtime_id: self.id.clone(),
            sequence: state.sequence,
        }
    }

    pub fn request(self: &Arc<Self>, request: Request) -> Result<Value, JamError> {
        if request.protocol_version != VERSION {
            return Err(JamError::new(
                "unsupported_version",
                "Unsupported JAM protocol version.",
            ));
        }
        if self.shutting_down.load(Ordering::Acquire) {
            return Err(JamError::new("unavailable", "JAM is shutting down."));
        }
        match request.method.as_str() {
            method if method.starts_with("snapshot.") => {
                self.snapshot_request(method, request.params)
            }
            "workspace.get" => {
                let _: Empty = parse(request.params)?;
                let state = self.lock()?;
                let mut workspace = state.store.workspace(self.cursor(&state))?;
                workspace.providers = self
                    .providers
                    .describe(&self.provider_settings(&state)?, &workspace.sessions);
                Ok(serde_json::to_value(workspace)?)
            }
            method if method.starts_with("provider.") || method == "interaction.respond" => {
                self.provider_request(method, request.params)
            }
            "conversation.get" => {
                let input: GetConversation = parse(request.params)?;
                validate_id(&input.resource_id)?;
                let state = self.lock()?;
                Ok(serde_json::to_value(
                    state
                        .store
                        .conversation(&input.resource_id, self.cursor(&state))?,
                )?)
            }
            "conversation.create" => {
                let input: CreateConversation = parse(request.params)?;
                validate_id(&input.project_id)?;
                // Options are checked against what the provider reports, so
                // it is asked first, before the database lock is taken.
                if let Some(provider) = input.provider_id.as_deref() {
                    validate_provider(provider)?;
                    if provider != "mock" {
                        self.check_providers(false)?;
                    }
                }
                let mut state = self.lock()?;
                if self.shutting_down.load(Ordering::Acquire) {
                    return Err(JamError::new("unavailable", "JAM is shutting down."));
                }
                let workspace = state.store.workspace(self.cursor(&state))?;
                if !workspace.projects.iter().any(|p| p.id == input.project_id) {
                    return Err(JamError::new("not_found", "Project not found."));
                }
                let (provider_id, presentation, model, options) = self.session_choice(
                    &state,
                    input.provider_id.as_deref(),
                    input.presentation,
                    input.options,
                )?;
                let resource = Resource {
                    id: new_id("conversation"),
                    kind: "conversation".into(),
                    title: "New conversation".into(),
                    project_id: Some(input.project_id),
                    session_id: Some(new_id("session")),
                    path: None,
                    pinned: false,
                    updated_at: now(),
                    closed_at: None,
                    close_suggestion_dismissed_at: None,
                };
                let session = Session {
                    id: resource.session_id.clone().expect("new session ID"),
                    resource_id: resource.id.clone(),
                    provider_id,
                    presentation,
                    status: SessionStatus::Idle,
                    model,
                    options,
                    needs_input: false,
                    usage: None,
                };
                state.store.create_conversation(&resource, &session)?;
                self.publish(
                    &mut state,
                    &resource.id,
                    EventPayload::SessionUpdated {
                        session: session.clone(),
                    },
                );
                let conversation = state
                    .store
                    .conversation(&resource.id, self.cursor(&state))?;
                Ok(json!({"resource":resource,"session":session,"conversation":conversation}))
            }
            "turn.start" => {
                let fingerprint = serde_json::to_string(&request.params)?;
                let input: StartTurn = parse(request.params)?;
                input.validate()?;
                self.start_turn(input, fingerprint)
            }
            "turn.interrupt" => {
                let input: InterruptTurn = parse(request.params)?;
                validate_id(&input.session_id)?;
                let interrupted = self.interrupt(&input.session_id)?;
                Ok(json!({"sessionId":input.session_id,"interrupted":interrupted}))
            }
            "directory.list" => {
                let input: ListDirectory = parse(request.params)?;
                validate_id(&input.project_id)?;
                if !self.project(&input.project_id)?.paths.is_empty() {
                    return Err(JamError::new(
                        "unavailable",
                        "Native directory browsing is not available yet. Open changed files from Review.",
                    ));
                }
                Ok(serde_json::to_value(crate::files::list(
                    &input.project_id,
                    &input.path,
                )?)?)
            }
            "file.read" => {
                let input: ReadFile = parse(request.params)?;
                validate_id(&input.project_id)?;
                if let Some(root) =
                    crate::native_files::project_folder(&self.project(&input.project_id)?)?
                {
                    return Ok(serde_json::to_value(crate::native_files::read_native(
                        &input.project_id,
                        &root,
                        &input.path,
                    )?)?);
                }
                let state = self.lock()?;
                let mut contents = crate::files::read(&input.project_id, &input.path)?;
                // A saved working copy replaces the fixture's content.
                if let Some(text) = state.store.file_edit(&input.project_id, &input.path)? {
                    contents.truncated = false;
                    contents.text = text;
                }
                contents.writable = true;
                Ok(serde_json::to_value(contents)?)
            }
            "file.write" => {
                let input: WriteFile = parse(request.params)?;
                input.validate()?;
                let state = self.lock()?;
                if !state
                    .store
                    .workspace(self.cursor(&state))?
                    .projects
                    .iter()
                    .any(|p| p.id == input.project_id)
                {
                    return Err(JamError::new("not_found", "Project not found."));
                }
                if state
                    .store
                    .workspace(self.cursor(&state))?
                    .projects
                    .iter()
                    .any(|p| p.id == input.project_id && !p.paths.is_empty())
                {
                    return Err(JamError::new(
                        "unavailable",
                        "Native files are read-only in this milestone.",
                    ));
                }
                // Only a path the project actually contains can be written.
                crate::files::read(&input.project_id, &input.path)?;
                let saved_at = now();
                state.store.save_file_edit(
                    &input.project_id,
                    &input.path,
                    &input.text,
                    &saved_at,
                )?;
                Ok(serde_json::to_value(FileSaved {
                    project_id: input.project_id,
                    path: input.path,
                    saved_at,
                })?)
            }
            "project.update" => {
                let input: UpdateProject = parse(request.params)?;
                input.validate()?;
                let state = self.lock()?;
                let mut project = state
                    .store
                    .workspace(self.cursor(&state))?
                    .projects
                    .into_iter()
                    .find(|p| p.id == input.project_id)
                    .ok_or_else(|| JamError::new("not_found", "Project not found."))?;
                if let Some(name) = input.name {
                    project.name = name.trim().to_string();
                    project.initials = initials_of(&project.name);
                }
                if let Some(paths) = input.paths {
                    project.paths = paths.into_iter().map(|p| p.trim().to_string()).collect();
                }
                if let Some(icon) = input.icon {
                    // Plain initials in the default tone is the absence of an icon.
                    project.icon = if icon.kind == "initials" && icon.tone.is_none() {
                        None
                    } else {
                        Some(icon)
                    };
                }
                if let Some(pinned) = input.pinned {
                    project.pinned = pinned;
                }
                state.store.save_project(&project)?;
                Ok(json!({ "project": project }))
            }
            "thread.setClosed" => {
                let input: SetThreadClosed = parse(request.params)?;
                validate_id(&input.resource_id)?;
                let state = self.lock()?;
                let mut resource = state.store.resource(&input.resource_id)?;
                if resource.kind != "conversation" {
                    return Err(JamError::invalid("Only a conversation can be closed."));
                }
                resource.closed_at = input.closed.then(now);
                state.store.save_resource(&resource)?;
                Ok(json!({ "resource": resource }))
            }
            "thread.keepOpen" => {
                let input: KeepThreadOpen = parse(request.params)?;
                validate_id(&input.resource_id)?;
                let state = self.lock()?;
                let mut resource = state.store.resource(&input.resource_id)?;
                if resource.kind != "conversation" {
                    return Err(JamError::invalid("Only a conversation can be kept open."));
                }
                resource.close_suggestion_dismissed_at = Some(now());
                state.store.save_resource(&resource)?;
                Ok(json!({ "resource": resource }))
            }
            "appearance.get" => {
                let _: Empty = parse(request.params)?;
                let state = self.lock()?;
                // A record this version cannot read is treated as absent, so the
                // client falls back to defaults instead of failing to start.
                let read = |key: &str| -> Result<Option<Value>, JamError> {
                    Ok(state
                        .store
                        .setting(key)?
                        .and_then(|text| serde_json::from_str::<Value>(&text).ok()))
                };
                let mut result = serde_json::Map::new();
                if let Some(appearance) = read(APPEARANCE_KEY)?.and_then(Appearance::from_stored) {
                    result.insert("appearance".into(), serde_json::to_value(appearance)?);
                }
                if let Some(wallpaper) = read(WALLPAPER_KEY)?
                    .and_then(|value| serde_json::from_value::<Wallpaper>(value).ok())
                    .filter(|wallpaper| wallpaper.validate().is_ok())
                {
                    result.insert("wallpaper".into(), serde_json::to_value(wallpaper)?);
                }
                Ok(Value::Object(result))
            }
            "appearance.update" => {
                let input: UpdateAppearance = parse(request.params)?;
                input.appearance.validate()?;
                let state = self.lock()?;
                state.store.save_setting(
                    APPEARANCE_KEY,
                    &serde_json::to_string(&input.appearance)?,
                    &now(),
                )?;
                Ok(json!({ "appearance": input.appearance }))
            }
            "appearance.setWallpaper" => {
                let input: SetWallpaper = parse(request.params)?;
                let updated_at = now();
                let state = self.lock()?;
                match input.wallpaper {
                    Some(wallpaper) => {
                        wallpaper.validate()?;
                        state.store.save_setting(
                            WALLPAPER_KEY,
                            &serde_json::to_string(&wallpaper)?,
                            &updated_at,
                        )?;
                    }
                    None => state.store.delete_setting(WALLPAPER_KEY)?,
                }
                Ok(json!({ "updatedAt": updated_at }))
            }
            "resource.open" => {
                let input: OpenResource = parse(request.params)?;
                input.validate()?;
                Ok(json!({ "resource": self.open_resource(input)? }))
            }
            method if method.starts_with("terminal.") => {
                self.terminal_request(method, request.params)
            }
            method if method.starts_with("git.") => self.git_request(method, request.params),
            "search.query" => {
                let input: SearchQuery = parse(request.params)?;
                Ok(json!({"results":self.lock()?.store.search(input)?}))
            }
            _ => Err(JamError::new(
                "unknown_method",
                "Unknown JAM request method.",
            )),
        }
    }

    pub(crate) fn project(&self, id: &str) -> Result<Project, JamError> {
        validate_id(id)?;
        let state = self.lock()?;
        state
            .store
            .workspace(self.cursor(&state))?
            .projects
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| JamError::new("not_found", "Project not found."))
    }
    /// Resource identity is stable per target: reopening a file returns the
    /// record that already exists rather than creating a second resource.
    /// A browser is the exception: each is its own page and history, so every
    /// open creates one.
    fn open_resource(&self, input: OpenResource) -> Result<Resource, JamError> {
        let state = self.lock()?;
        let workspace = state.store.workspace(self.cursor(&state))?;
        if !workspace.projects.iter().any(|p| p.id == input.project_id) {
            return Err(JamError::new("not_found", "Project not found."));
        }
        if input.kind == "file" {
            // Fail before creating a record if the target cannot be read.
            let project = workspace
                .projects
                .iter()
                .find(|p| p.id == input.project_id)
                .expect("checked project");
            let path = input.path.as_deref().unwrap_or_default();
            if let Some(root) = crate::native_files::project_folder(project)? {
                crate::native_files::read_native(&input.project_id, &root, path)?;
            } else {
                crate::files::read(&input.project_id, path)?;
            }
        }
        let existing = workspace.resources.iter().find(|resource| {
            input.kind != "browser"
                && resource.kind == input.kind
                && resource.project_id.as_deref() == Some(input.project_id.as_str())
                && resource.path == input.path
        });
        if let Some(resource) = existing {
            return Ok(resource.clone());
        }
        let title = match (&input.kind[..], input.path.as_deref()) {
            ("file", Some(path)) => {
                let name = path.rsplit('/').next().unwrap_or(path);
                if name.trim().is_empty() {
                    format!("File {name:?}")
                } else {
                    name.to_string()
                }
            }
            ("file-browser", _) => "Files".to_string(),
            ("terminal", _) => "Terminal".to_string(),
            ("browser", _) => "Browser".to_string(),
            _ => "Review changes".to_string(),
        };
        let resource = Resource {
            id: new_id(&input.kind),
            kind: input.kind,
            title,
            project_id: Some(input.project_id),
            session_id: None,
            path: input.path,
            pinned: false,
            updated_at: now(),
            closed_at: None,
            close_suggestion_dismissed_at: None,
        };
        state.store.save_resource(&resource)?;
        Ok(resource)
    }

    /// Attaches a terminal view. See `TerminalManager::attach`.
    pub fn attach_terminal(
        &self,
        resource_id: &str,
        sink: TerminalSink,
    ) -> Result<String, JamError> {
        validate_id(resource_id)?;
        if self.shutting_down.load(Ordering::Acquire) {
            return Err(JamError::new("unavailable", "JAM is shutting down."));
        }
        let resource = self.lock()?.store.resource(resource_id)?;
        if resource.kind != "terminal" {
            return Err(JamError::invalid("That resource is not a terminal."));
        }
        self.terminals.attach(resource.id, sink)
    }

    /// Detaches a terminal view. The shell keeps running.
    pub fn detach_terminal(&self, attachment_id: &str) -> Result<(), JamError> {
        validate_id(attachment_id)?;
        self.terminals.detach(attachment_id)
    }

    /// Replaces the shell new terminals start. `None` uses the detected default.
    pub fn set_terminal_shell(&self, shell: Option<ShellSpec>) -> Result<(), JamError> {
        self.terminals.set_shell(shell)
    }

    pub fn subscribe(&self, scope: SubscriptionScope) -> Result<Subscription, JamError> {
        let mut state = self.lock()?;
        if let Some(id) = &scope.resource_id {
            validate_id(id)?;
            state.store.resource(id)?;
        }
        if state.subscribers.len() >= 128 {
            return Err(JamError::new(
                "unavailable",
                "Too many active subscriptions.",
            ));
        }
        let id = new_id("subscription");
        let (subscriber, receiver) = events::channel(scope);
        state.subscribers.insert(id.clone(), subscriber);
        Ok(Subscription { id, receiver })
    }

    pub fn unsubscribe(&self, id: &str) -> Result<(), JamError> {
        validate_id(id)?;
        self.lock()?.subscribers.remove(id);
        Ok(())
    }

    /// Detaches a destroyed/reloading desktop client without altering sessions.
    pub fn detach_clients(&self) -> Result<(), JamError> {
        self.lock()?.subscribers.clear();
        self.terminals.detach_all()
    }

    pub(crate) fn publish(&self, state: &mut State, resource_id: &str, payload: EventPayload) {
        state.sequence += 1;
        let event = Event {
            protocol_version: VERSION,
            cursor: self.cursor(state),
            resource_id: resource_id.into(),
            payload,
        };
        state.subscribers.retain(|_, subscriber| {
            if subscriber
                .scope
                .resource_id
                .as_deref()
                .is_none_or(|id| id == resource_id)
            {
                subscriber.deliver(event.clone())
            } else {
                !subscriber.is_closed()
            }
        });
    }

    pub async fn shutdown(&self) -> Result<(), JamError> {
        self.shutting_down.store(true, Ordering::Release);
        // Explicit Quit ends terminal shells; they do not outlive the app. A
        // failure here must not stop provider tasks from being interrupted.
        if let Err(error) = self.terminals.shutdown() {
            eprintln!("Terminal shutdown: {error}");
        }
        let tasks = {
            let mut state = self.lock()?;
            for task in state.tasks.values() {
                let _ = task.cancel.send(true);
            }
            state.store.transaction(|| {
                for mut session in state.store.sessions()? {
                    if session.status == SessionStatus::Running {
                        session.status = SessionStatus::Interrupted;
                        session.needs_input = false;
                        state.store.save_session(&session)?;
                        state.store.interrupt_messages(
                            &session.resource_id,
                            InteractionStatus::Cancelled,
                        )?;
                    }
                }
                Ok(())
            })?;
            state.subscribers.clear();
            std::mem::take(&mut state.tasks)
        };
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
        for task in tasks.into_values() {
            let mut handle = task.handle;
            if tokio::time::timeout_at(deadline, &mut handle)
                .await
                .is_err()
            {
                handle.abort();
                let _ = handle.await;
            }
        }
        // Every provider process ends with JAM, including idle ones kept
        // for their next turn; sessions resume from the provider's ID.
        self.providers.shutdown();
        Ok(())
    }
}
