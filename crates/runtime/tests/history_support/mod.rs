//! A scripted provider whose own history the provider-history tests
//! control: it lists and reads in small pages, can fail a listing page, and
//! runs turns like a real adapter. Shared by the `history_*` test files.
#![allow(dead_code, unused_imports)]
pub use jam_runtime::{
    Runtime,
    protocol::{
        CapabilitySupport, HistoryEntry, MessageBlock, ProviderDescriptor, Request, SessionStatus,
    },
    providers::{
        HistoryFuture, HistoryItem, HistoryListRequest, HistoryMessage, HistoryPage,
        HistoryReadRequest, HistoryTranscript, MockProvider, ProbeFuture, ProviderAdapter,
        ProviderConfig, ProviderFuture, ProviderHistory, ProviderTurn, ProviderUpdate, TurnIo,
    },
};
pub use serde_json::{Value, json};
pub use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

pub struct Temp(pub PathBuf);
impl Temp {
    pub fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jam-history-{}", uuid::Uuid::new_v4()));
        for folder in ["project", "other", "project/src"] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
        }
        Self(root)
    }
    pub fn db(&self) -> PathBuf {
        self.0.join("jam.sqlite")
    }
    pub fn folder(&self, name: &str) -> String {
        self.0.join(name).display().to_string()
    }
    /// Rows in `table` matching `filter`, read straight from the database.
    pub fn rows(&self, table: &str, filter: &str) -> i64 {
        rusqlite::Connection::open(self.db())
            .unwrap()
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE {filter}"),
                [],
                |row| row.get(0),
            )
            .unwrap()
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub async fn call(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, String> {
    let runtime = Arc::clone(runtime);
    let method = method.to_string();
    tokio::task::spawn_blocking(move || {
        runtime
            .request(Request {
                protocol_version: 1,
                method,
                params,
            })
            .map_err(|e| e.code)
    })
    .await
    .unwrap()
}

/// One conversation in the scripted provider's own history.
#[derive(Clone)]
pub struct Thread {
    pub item: HistoryItem,
    pub messages: Vec<HistoryMessage>,
}

pub fn message(source_id: &str, role: &str, text: &str) -> HistoryMessage {
    HistoryMessage {
        source_id: source_id.into(),
        role: role.into(),
        created_at: Some("2026-09-01T10:00:00Z".into()),
        blocks: vec![MessageBlock::Text { text: text.into() }],
    }
}

pub fn thread(native_id: &str, title: &str, cwd: Option<&str>, words: &[&str]) -> Thread {
    Thread {
        item: HistoryItem {
            native_id: native_id.into(),
            title: Some(title.into()),
            preview: Some(format!("{title} preview")),
            created_at: Some("2026-09-01T10:00:00Z".into()),
            updated_at: Some("2026-09-01T10:00:00Z".into()),
            revision: Some("1".into()),
            cwd: cwd.map(Into::into),
            resumable: true,
        },
        messages: words
            .iter()
            .enumerate()
            .map(|(index, word)| {
                let role = if index % 2 == 0 { "user" } else { "assistant" };
                message(&format!("{native_id}/{index}"), role, word)
            })
            .collect(),
    }
}

/// A provider whose own history the test controls. It lists and reads in
/// small pages, can fail a listing page, and runs turns like a real adapter.
pub struct Scripted {
    pub id: &'static str,
    pub threads: Mutex<Vec<Thread>>,
    pub page_size: usize,
    pub fail_list_page: Mutex<Option<usize>>,
    pub reads: Mutex<usize>,
    /// The provider ID and folder each turn was given.
    pub turns: Mutex<Vec<(Option<String>, Option<PathBuf>)>>,
}

impl Scripted {
    pub fn new(id: &'static str, page_size: usize, threads: Vec<Thread>) -> Arc<Self> {
        Arc::new(Self {
            id,
            threads: Mutex::new(threads),
            page_size,
            fail_list_page: Mutex::new(None),
            reads: Mutex::new(0),
            turns: Mutex::new(Vec::new()),
        })
    }
    pub fn edit(&self, native_id: &str, change: impl FnOnce(&mut Thread)) {
        let mut threads = self.threads.lock().unwrap();
        change(
            threads
                .iter_mut()
                .find(|t| t.item.native_id == native_id)
                .unwrap(),
        );
    }
    pub fn remove(&self, native_id: &str) -> Thread {
        let mut threads = self.threads.lock().unwrap();
        let index = threads
            .iter()
            .position(|t| t.item.native_id == native_id)
            .unwrap();
        threads.remove(index)
    }
    pub fn reads(&self) -> usize {
        *self.reads.lock().unwrap()
    }
}

pub fn page_of(token: Option<&str>) -> usize {
    token.map_or(0, |token| token.parse().unwrap())
}

impl ProviderHistory for Scripted {
    fn list(&self, request: HistoryListRequest) -> HistoryFuture<HistoryPage> {
        let page = page_of(request.page.as_deref());
        let size = self.page_size.min(request.limit);
        let failing = *self.fail_list_page.lock().unwrap() == Some(page);
        let threads = self.threads.lock().unwrap();
        let items: Vec<HistoryItem> = threads
            .iter()
            .skip(page * size)
            .take(size)
            .map(|t| t.item.clone())
            .collect();
        let next_page = (threads.len() > (page + 1) * size).then(|| (page + 1).to_string());
        Box::pin(async move {
            if failing {
                return Err(jam_runtime::JamError::new(
                    "provider_error",
                    "The listing stopped.",
                ));
            }
            Ok(HistoryPage { items, next_page })
        })
    }

    fn read(&self, request: HistoryReadRequest) -> HistoryFuture<HistoryTranscript> {
        *self.reads.lock().unwrap() += 1;
        let page = page_of(request.page.as_deref());
        let size = self.page_size;
        let found = self
            .threads
            .lock()
            .unwrap()
            .iter()
            .find(|t| t.item.native_id == request.native_id)
            .cloned();
        Box::pin(async move {
            let thread = found
                .ok_or_else(|| jam_runtime::JamError::new("not_found", "No such conversation."))?;
            let more = thread.messages.len() > (page + 1) * size;
            Ok(HistoryTranscript {
                item: Some(thread.item.clone()),
                messages: thread
                    .messages
                    .iter()
                    .skip(page * size)
                    .take(size)
                    .cloned()
                    .collect(),
                next_page: more.then(|| (page + 1).to_string()),
                checkpoint: (!more).then(|| format!("{}", thread.messages.len())),
            })
        })
    }
}

impl ProviderAdapter for Scripted {
    fn id(&self) -> &'static str {
        self.id
    }
    fn unchecked(&self, _config: &ProviderConfig) -> ProviderDescriptor {
        ProviderDescriptor {
            id: self.id.into(),
            name: "Scripted".into(),
            installation: "installed".into(),
            authentication: "authenticated".into(),
            enabled: true,
            is_default: false,
            running: false,
            capabilities: jam_runtime::protocol::CAPABILITIES
                .iter()
                .map(|key| (key.to_string(), CapabilitySupport::supported()))
                .collect(),
            running_count: None,
            version: Some("1.0.0".into()),
            executable: None,
            executable_source: None,
            executable_override: None,
            status: None,
            account: None,
            models: None,
            options: None,
            defaults: None,
            favorite_models: Vec::new(),
            hidden_models: Vec::new(),
            checked_at: None,
        }
    }
    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        let descriptor = self.unchecked(&config);
        Box::pin(async move { descriptor })
    }
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        self.turns
            .lock()
            .unwrap()
            .push((turn.native_id.clone(), turn.cwd.clone()));
        let native = turn
            .native_id
            .clone()
            .unwrap_or_else(|| format!("jam-made-{}", turn.session_id));
        Box::pin(async move {
            let _ = io.updates.send(ProviderUpdate::Native(native)).await;
            let _ = io
                .updates
                .send(ProviderUpdate::Blocks(vec![MessageBlock::Text {
                    text: "continued in jam".into(),
                }]))
                .await;
            let _ = io
                .updates
                .send(ProviderUpdate::Finished(SessionStatus::Idle))
                .await;
            Ok(())
        })
    }
    fn history(&self) -> Option<&dyn ProviderHistory> {
        Some(self)
    }
}

/// Lets `Runtime` own an adapter the test also keeps a handle to.
pub struct Shared(pub Arc<Scripted>);
impl ProviderAdapter for Shared {
    fn id(&self) -> &'static str {
        self.0.id()
    }
    fn unchecked(&self, config: &ProviderConfig) -> ProviderDescriptor {
        self.0.unchecked(config)
    }
    fn probe(&self, config: ProviderConfig) -> ProbeFuture {
        self.0.probe(config)
    }
    fn run_turn(&self, turn: ProviderTurn, io: TurnIo) -> ProviderFuture {
        self.0.run_turn(turn, io)
    }
    fn history(&self) -> Option<&dyn ProviderHistory> {
        Some(self.0.as_ref())
    }
}

pub fn open(temp: &Temp, providers: &[&Arc<Scripted>]) -> Arc<Runtime> {
    Runtime::open_unseeded_with(
        temp.db(),
        providers
            .iter()
            .map(|p| Arc::new(Shared(Arc::clone(p))) as Arc<dyn ProviderAdapter>)
            .collect(),
    )
    .unwrap()
}

pub async fn add_project(runtime: &Arc<Runtime>, folder: &str) -> String {
    call(runtime, "project.create", json!({ "paths": [folder] }))
        .await
        .unwrap()["project"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

pub async fn workspace(runtime: &Arc<Runtime>) -> Value {
    call(runtime, "workspace.get", json!({})).await.unwrap()
}

pub fn conversations(workspace: &Value) -> usize {
    workspace["resources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == "conversation")
        .count()
}

pub async fn search(runtime: &Arc<Runtime>, query: &str) -> Vec<Value> {
    call(runtime, "search.query", json!({ "query": query }))
        .await
        .unwrap()["results"]
        .as_array()
        .unwrap()
        .clone()
}

pub async fn idle(runtime: &Arc<Runtime>, resource_id: &str) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let workspace = workspace(runtime).await;
            let session = workspace["sessions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["resourceId"] == resource_id)
                .cloned()
                .unwrap();
            if session["status"] != "running" {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the turn settles");
}

/// Three provider conversations: one from a JAM project's folder, one from
/// a folder JAM does not know, one with no folder.
pub fn three(temp: &Temp) -> Vec<Thread> {
    vec![
        thread(
            "native-a",
            "Fix the parser",
            Some(&temp.folder("project")),
            &["parser quokkaword", "fixed it", "thanks", "welcome", "bye"],
        ),
        thread(
            "native-b",
            "Elsewhere",
            Some(&temp.folder("unknown-folder")),
            &["elsewhere wombatword"],
        ),
        thread("native-c", "No folder", None, &["no folder"]),
    ]
}
