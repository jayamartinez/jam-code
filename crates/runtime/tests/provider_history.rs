//! The provider-history contract, proven with a scripted provider whose own
//! history the tests control: discovery, identity, incremental scans,
//! lazy and idempotent sync, JAM-owned metadata, the project-folder rule,
//! tombstones and resume. Provider-specific adapters (Codex, Claude Code)
//! implement `ProviderHistory` and are held to the same behavior.
use jam_runtime::{
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
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jam-history-{}", uuid::Uuid::new_v4()));
        for folder in ["project", "other", "project/src"] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
        }
        Self(root)
    }
    fn db(&self) -> PathBuf {
        self.0.join("jam.sqlite")
    }
    fn folder(&self, name: &str) -> String {
        self.0.join(name).display().to_string()
    }
    /// Rows in `table` matching `filter`, read straight from the database.
    fn rows(&self, table: &str, filter: &str) -> i64 {
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

async fn call(runtime: &Arc<Runtime>, method: &str, params: Value) -> Result<Value, String> {
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
struct Thread {
    item: HistoryItem,
    messages: Vec<HistoryMessage>,
}

fn message(source_id: &str, role: &str, text: &str) -> HistoryMessage {
    HistoryMessage {
        source_id: source_id.into(),
        role: role.into(),
        created_at: Some("2026-09-01T10:00:00Z".into()),
        blocks: vec![MessageBlock::Text { text: text.into() }],
    }
}

fn thread(native_id: &str, title: &str, cwd: Option<&str>, words: &[&str]) -> Thread {
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
struct Scripted {
    id: &'static str,
    threads: Mutex<Vec<Thread>>,
    page_size: usize,
    fail_list_page: Mutex<Option<usize>>,
    reads: Mutex<usize>,
    /// The provider ID and folder each turn was given.
    turns: Mutex<Vec<(Option<String>, Option<PathBuf>)>>,
}

impl Scripted {
    fn new(id: &'static str, page_size: usize, threads: Vec<Thread>) -> Arc<Self> {
        Arc::new(Self {
            id,
            threads: Mutex::new(threads),
            page_size,
            fail_list_page: Mutex::new(None),
            reads: Mutex::new(0),
            turns: Mutex::new(Vec::new()),
        })
    }
    fn edit(&self, native_id: &str, change: impl FnOnce(&mut Thread)) {
        let mut threads = self.threads.lock().unwrap();
        change(
            threads
                .iter_mut()
                .find(|t| t.item.native_id == native_id)
                .unwrap(),
        );
    }
    fn remove(&self, native_id: &str) -> Thread {
        let mut threads = self.threads.lock().unwrap();
        let index = threads
            .iter()
            .position(|t| t.item.native_id == native_id)
            .unwrap();
        threads.remove(index)
    }
    fn reads(&self) -> usize {
        *self.reads.lock().unwrap()
    }
}

fn page_of(token: Option<&str>) -> usize {
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
struct Shared(Arc<Scripted>);
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

fn open(temp: &Temp, providers: &[&Arc<Scripted>]) -> Arc<Runtime> {
    Runtime::open_unseeded_with(
        temp.db(),
        providers
            .iter()
            .map(|p| Arc::new(Shared(Arc::clone(p))) as Arc<dyn ProviderAdapter>)
            .collect(),
    )
    .unwrap()
}

async fn add_project(runtime: &Arc<Runtime>, folder: &str) -> String {
    call(runtime, "project.create", json!({ "paths": [folder] }))
        .await
        .unwrap()["project"]["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

async fn scan(runtime: &Arc<Runtime>, provider: &str) -> Value {
    call(
        runtime,
        "providerHistory.scan",
        json!({ "providerId": provider }),
    )
    .await
    .unwrap()
}

async fn entries(runtime: &Arc<Runtime>, params: Value) -> Vec<HistoryEntry> {
    let listed = call(runtime, "providerHistory.list", params).await.unwrap();
    serde_json::from_value(listed["entries"].clone()).unwrap()
}

async fn entry(runtime: &Arc<Runtime>, title: &str) -> HistoryEntry {
    let mut all = entries(runtime, json!({})).await;
    all.extend(entries(runtime, json!({ "ignored": true })).await);
    all.into_iter()
        .find(|entry| entry.title.as_deref() == Some(title))
        .unwrap_or_else(|| panic!("no entry titled {title}"))
}

async fn workspace(runtime: &Arc<Runtime>) -> Value {
    call(runtime, "workspace.get", json!({})).await.unwrap()
}

fn conversations(workspace: &Value) -> usize {
    workspace["resources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == "conversation")
        .count()
}

async fn search(runtime: &Arc<Runtime>, query: &str) -> Vec<Value> {
    call(runtime, "search.query", json!({ "query": query }))
        .await
        .unwrap()["results"]
        .as_array()
        .unwrap()
        .clone()
}

async fn idle(runtime: &Arc<Runtime>, resource_id: &str) {
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
fn three(temp: &Temp) -> Vec<Thread> {
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

#[tokio::test(flavor = "multi_thread")]
async fn a_scan_indexes_history_without_creating_conversations() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let runtime = open(&temp, &[&codex]);
    let project = add_project(&runtime, &temp.folder("project")).await;

    let summary = scan(&runtime, "codex").await;
    assert_eq!(summary["discovered"], 3);
    assert_eq!(summary["complete"], true);
    assert_eq!(summary["missing"], 0);
    let listed = entries(&runtime, json!({ "providerId": "codex" })).await;
    assert_eq!(listed.len(), 3);
    assert!(
        listed
            .iter()
            .all(|e| e.origin == "external" && e.resource_id.is_none())
    );
    // Discovery is metadata only: no transcript was read, no conversation
    // made, no project added, nothing searchable.
    assert_eq!(codex.reads(), 0);
    let workspace = workspace(&runtime).await;
    assert_eq!(conversations(&workspace), 0);
    assert_eq!(workspace["projects"].as_array().unwrap().len(), 1);
    assert!(search(&runtime, "quokkaword").await.is_empty());
    // The folder JAM trusts links its entry; the others are unlinked.
    let a = entry(&runtime, "Fix the parser").await;
    assert_eq!(a.project_id.as_deref(), Some(project.as_str()));
    assert_eq!(a.preview.as_deref(), Some("Fix the parser preview"));
    assert!(a.resumable);
    assert_eq!(entry(&runtime, "Elsewhere").await.project_id, None);
    assert_eq!(entry(&runtime, "No folder").await.project_id, None);
    // The provider's own IDs never reach the client.
    let wire = call(&runtime, "providerHistory.list", json!({}))
        .await
        .unwrap()
        .to_string();
    assert!(!wire.contains("native-"), "{wire}");
}

#[tokio::test(flavor = "multi_thread")]
async fn rescans_are_incremental_and_follow_the_provider() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let runtime = open(&temp, &[&codex]);
    scan(&runtime, "codex").await;
    let ids: Vec<String> = entries(&runtime, json!({}))
        .await
        .into_iter()
        .map(|e| e.id)
        .collect();

    // The same history scanned again is the same entries, unchanged.
    let again = scan(&runtime, "codex").await;
    assert_eq!(again["discovered"], 0);
    assert_eq!(again["unchanged"], 3);
    let mut same: Vec<String> = entries(&runtime, json!({}))
        .await
        .into_iter()
        .map(|e| e.id)
        .collect();
    let mut before = ids.clone();
    same.sort();
    before.sort();
    assert_eq!(same, before);

    // A rename in the provider updates the entry, not its identity.
    codex.edit("native-a", |t| {
        t.item.title = Some("Fix the parser for real".into());
        t.item.revision = Some("2".into());
        t.item.updated_at = Some("2026-09-02T10:00:00Z".into());
    });
    let renamed = scan(&runtime, "codex").await;
    assert_eq!(
        (renamed["updated"].clone(), renamed["unchanged"].clone()),
        (json!(1), json!(2))
    );
    let a = entry(&runtime, "Fix the parser for real").await;
    assert!(ids.contains(&a.id));
    assert_eq!(a.updated_at.as_deref(), Some("2026-09-02T10:00:00Z"));

    // A conversation the provider no longer lists is marked, not dropped.
    let gone = codex.remove("native-c");
    let after = scan(&runtime, "codex").await;
    assert_eq!(after["missing"], 1);
    let c = entry(&runtime, "No folder").await;
    assert!(c.missing_since.is_some());
    // And clears when it is listed again.
    codex.threads.lock().unwrap().push(gone);
    scan(&runtime, "codex").await;
    assert_eq!(entry(&runtime, "No folder").await.missing_since, None);
    assert_eq!(entries(&runtime, json!({})).await.len(), 3);
}

#[tokio::test(flavor = "multi_thread")]
async fn identity_is_the_provider_instance_and_native_id() {
    let temp = Temp::new();
    let codex = Scripted::new(
        "codex",
        10,
        vec![
            thread("same-title-1", "Same title", None, &["one"]),
            thread("same-title-2", "Same title", None, &["two"]),
            thread("shared-id", "From Codex", None, &["codex"]),
        ],
    );
    let claude = Scripted::new(
        "claude",
        10,
        vec![thread("shared-id", "From Claude", None, &["claude"])],
    );
    let runtime = open(&temp, &[&codex, &claude]);
    scan(&runtime, "codex").await;
    scan(&runtime, "codex").await;
    scan(&runtime, "claude").await;
    // Scanned twice, still one entry each; the same title is not the same
    // conversation, and the same ID at another provider is not either.
    assert_eq!(
        entries(&runtime, json!({ "providerId": "codex" }))
            .await
            .len(),
        3
    );
    assert_eq!(
        entries(&runtime, json!({ "providerId": "claude" }))
            .await
            .len(),
        1
    );
    assert_eq!(temp.rows("provider_history", "native_id='shared-id'"), 2);
    assert_eq!(temp.rows("provider_history", "instance_id='default'"), 4);
    // A second instance of a provider (another account or home) is a
    // separate conversation even with the same native ID.
    rusqlite::Connection::open(temp.db())
        .unwrap()
        .execute(
            "INSERT INTO provider_history(id,provider_id,instance_id,native_id,origin,discovered_at,sort_at)
             VALUES ('history-work','codex','work','shared-id','external','2026-09-01','2026-09-01')",
            [],
        )
        .unwrap();
    scan(&runtime, "codex").await;
    assert_eq!(temp.rows("provider_history", "native_id='shared-id'"), 3);
    let duplicate = rusqlite::Connection::open(temp.db()).unwrap().execute(
        "INSERT INTO provider_history(id,provider_id,instance_id,native_id,origin,discovered_at,sort_at)
         VALUES ('history-dup','codex','default','shared-id','external','2026-09-01','2026-09-01')",
        [],
    );
    assert!(duplicate.is_err(), "identity is unique");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_interrupted_scan_keeps_what_it_saw_and_marks_nothing_missing() {
    let temp = Temp::new();
    let threads: Vec<Thread> = (0..5)
        .map(|i| thread(&format!("native-{i}"), &format!("Thread {i}"), None, &["x"]))
        .collect();
    let codex = Scripted::new("codex", 2, threads);
    let runtime = open(&temp, &[&codex]);
    *codex.fail_list_page.lock().unwrap() = Some(1);
    let failed = call(
        &runtime,
        "providerHistory.scan",
        json!({ "providerId": "codex" }),
    )
    .await;
    assert_eq!(failed.unwrap_err(), "provider_error");
    // The first page was kept.
    assert_eq!(entries(&runtime, json!({})).await.len(), 2);

    *codex.fail_list_page.lock().unwrap() = None;
    assert_eq!(scan(&runtime, "codex").await["discovered"], 3);
    // An interrupted scan after a conversation went away marks nothing.
    codex.remove("native-4");
    *codex.fail_list_page.lock().unwrap() = Some(1);
    assert!(
        call(
            &runtime,
            "providerHistory.scan",
            json!({ "providerId": "codex" })
        )
        .await
        .is_err()
    );
    assert_eq!(
        temp.rows("provider_history", "missing_since IS NOT NULL"),
        0
    );
    *codex.fail_list_page.lock().unwrap() = None;
    assert_eq!(scan(&runtime, "codex").await["missing"], 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn large_histories_are_listed_and_paged_in_bounded_steps() {
    let temp = Temp::new();
    let threads: Vec<Thread> = (0..1_050)
        .map(|i| {
            let mut t = thread(&format!("native-{i:04}"), &format!("Thread {i}"), None, &[]);
            t.item.updated_at = Some(format!("2026-09-01T10:{:02}:{:02}Z", i / 60 % 60, i % 60));
            t
        })
        .collect();
    let codex = Scripted::new("codex", 1_000, threads);
    let runtime = open(&temp, &[&codex]);
    let summary = scan(&runtime, "codex").await;
    assert_eq!(summary["discovered"], 1_050);
    assert_eq!(summary["complete"], true);
    assert_eq!(conversations(&workspace(&runtime).await), 0);

    let mut seen = std::collections::HashSet::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0;
    loop {
        let mut params = json!({ "limit": 200 });
        if let Some(cursor) = &cursor {
            params["cursor"] = json!(cursor);
        }
        let page = call(&runtime, "providerHistory.list", params)
            .await
            .unwrap();
        let listed: Vec<HistoryEntry> = serde_json::from_value(page["entries"].clone()).unwrap();
        assert!(listed.len() <= 200);
        for entry in listed {
            assert!(seen.insert(entry.id), "a page never repeats an entry");
        }
        pages += 1;
        match page["cursor"].as_str() {
            Some(next) => cursor = Some(next.to_owned()),
            None => break,
        }
    }
    assert_eq!(seen.len(), 1_050);
    assert_eq!(pages, 6);
    assert_eq!(
        call(&runtime, "providerHistory.list", json!({ "limit": 500 }))
            .await
            .unwrap_err(),
        "invalid_request"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_conversation_jam_started_is_linked_not_duplicated() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 10, Vec::new());
    let runtime = open(&temp, &[&codex]);
    let project = add_project(&runtime, &temp.folder("project")).await;
    let created = call(
        &runtime,
        "conversation.create",
        json!({ "projectId": project, "presentation": "codex", "providerId": "codex" }),
    )
    .await
    .unwrap();
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    let session = created["session"]["id"].as_str().unwrap().to_owned();
    call(
        &runtime,
        "turn.start",
        json!({ "resourceId": resource, "text": "hello", "context": [], "requestId": "r1" }),
    )
    .await
    .unwrap();
    idle(&runtime, &resource).await;
    // The provider now lists the thread JAM started.
    codex.threads.lock().unwrap().push(thread(
        &format!("jam-made-{session}"),
        "Started in JAM",
        Some(&temp.folder("project")),
        &["hello"],
    ));
    assert_eq!(scan(&runtime, "codex").await["discovered"], 1);
    let linked = entry(&runtime, "Started in JAM").await;
    assert_eq!(linked.origin, "jam");
    assert_eq!(linked.resource_id.as_deref(), Some(resource.as_str()));
    assert_eq!(conversations(&workspace(&runtime).await), 1);
    // Linking reads nothing; the transcript is the one JAM recorded.
    assert_eq!(codex.reads(), 0);

    // Deleting the chat still works and leaves the entry indexed, unlinked.
    call(
        &runtime,
        "conversation.delete",
        json!({ "resourceId": resource }),
    )
    .await
    .unwrap();
    assert_eq!(conversations(&workspace(&runtime).await), 0);
    let unlinked = entry(&runtime, "Started in JAM").await;
    assert_eq!((unlinked.id, unlinked.resource_id), (linked.id, None));
    assert_eq!(
        temp.rows("provider_bindings", &format!("session_id='{session}'")),
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_reported_folder_grants_nothing() {
    let temp = Temp::new();
    let sensitive = if cfg!(windows) {
        r"C:\Windows\System32"
    } else {
        "/etc"
    };
    let climbing = format!("{}{}..", temp.folder("project"), std::path::MAIN_SEPARATOR);
    let codex = Scripted::new(
        "codex",
        10,
        vec![
            thread(
                "unknown",
                "Unknown folder",
                Some(&temp.folder("unknown-folder")),
                &["u"],
            ),
            thread("system", "System folder", Some(sensitive), &["s"]),
            thread("relative", "Relative", Some("../.."), &["r"]),
            thread("climbing", "Climbing", Some(&climbing), &["c"]),
            thread(
                "inside",
                "Inside the project",
                Some(&temp.folder("project/src")),
                &["i"],
            ),
            thread(
                "exact",
                "Exact",
                Some(&format!(
                    "{}{}",
                    temp.folder("project"),
                    std::path::MAIN_SEPARATOR
                )),
                &["e"],
            ),
        ],
    );
    let runtime = open(&temp, &[&codex]);
    let project = add_project(&runtime, &temp.folder("project")).await;
    scan(&runtime, "codex").await;

    for title in [
        "Unknown folder",
        "System folder",
        "Relative",
        "Climbing",
        "Inside the project",
    ] {
        let unlinked = entry(&runtime, title).await;
        assert_eq!(unlinked.project_id, None, "{title}");
    }
    assert_eq!(
        entry(&runtime, "Exact").await.project_id.as_deref(),
        Some(project.as_str())
    );
    let workspace = workspace(&runtime).await;
    assert_eq!(workspace["projects"].as_array().unwrap().len(), 1);
    assert_eq!(conversations(&workspace), 0);
    assert_eq!(codex.reads(), 0);
    // The reported folder is shown, and is never a project ID.
    let unknown = entry(&runtime, "Unknown folder").await;
    assert_eq!(
        unknown.source_path.as_deref(),
        Some(temp.folder("unknown-folder").as_str())
    );
    assert_eq!(
        call(
            &runtime,
            "providerHistory.associate",
            json!({ "historyId": unknown.id, "projectId": "project-nowhere" })
        )
        .await
        .unwrap_err(),
        "not_found"
    );
    // Adding the folder through the normal flow is what links it.
    std::fs::create_dir_all(temp.folder("unknown-folder")).unwrap();
    let added = add_project(&runtime, &temp.folder("unknown-folder")).await;
    scan(&runtime, "codex").await;
    assert_eq!(
        entry(&runtime, "Unknown folder")
            .await
            .project_id
            .as_deref(),
        Some(added.as_str())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chosen_project_outlasts_what_the_provider_reports() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 10, three(&temp));
    let runtime = open(&temp, &[&codex]);
    add_project(&runtime, &temp.folder("project")).await;
    let other = add_project(&runtime, &temp.folder("other")).await;
    scan(&runtime, "codex").await;
    let b = entry(&runtime, "Elsewhere").await;
    let chosen = call(
        &runtime,
        "providerHistory.associate",
        json!({ "historyId": b.id, "projectId": other }),
    )
    .await
    .unwrap();
    assert_eq!(chosen["entry"]["projectId"], other.as_str());
    // The provider now reports another project's folder; the choice stays.
    codex.edit("native-b", |t| t.item.cwd = Some(temp.folder("project")));
    scan(&runtime, "codex").await;
    assert_eq!(
        entry(&runtime, "Elsewhere").await.project_id.as_deref(),
        Some(other.as_str())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn ignored_entries_stay_hidden_until_restored() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 10, three(&temp));
    let runtime = open(&temp, &[&codex]);
    scan(&runtime, "codex").await;
    let b = entry(&runtime, "Elsewhere").await;
    let ignored = call(
        &runtime,
        "providerHistory.ignore",
        json!({ "historyId": b.id }),
    )
    .await
    .unwrap();
    assert!(ignored["entry"]["ignoredAt"].is_string());
    // A rescan neither shows it again nor indexes it twice.
    assert_eq!(scan(&runtime, "codex").await["discovered"], 0);
    assert!(
        entries(&runtime, json!({}))
            .await
            .iter()
            .all(|e| e.id != b.id)
    );
    let tombstones = entries(&runtime, json!({ "ignored": true })).await;
    assert_eq!(tombstones.len(), 1);
    assert_eq!(tombstones[0].id, b.id);
    // The provider's history is untouched.
    assert_eq!(codex.threads.lock().unwrap().len(), 3);
    call(
        &runtime,
        "providerHistory.restore",
        json!({ "historyId": b.id }),
    )
    .await
    .unwrap();
    assert!(
        entries(&runtime, json!({}))
            .await
            .iter()
            .any(|e| e.id == b.id)
    );
    assert!(
        entries(&runtime, json!({ "ignored": true }))
            .await
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn providers_without_history_say_so() {
    let temp = Temp::new();
    let runtime = Runtime::open_with(temp.db(), vec![Arc::new(MockProvider)]).unwrap();
    for (method, params, code) in [
        (
            "providerHistory.scan",
            json!({ "providerId": "mock" }),
            "unsupported",
        ),
        (
            "providerHistory.scan",
            json!({ "providerId": "codex" }),
            "provider_unavailable",
        ),
        (
            "providerHistory.scan",
            json!({ "providerId": "other" }),
            "invalid_request",
        ),
        (
            "providerHistory.ignore",
            json!({ "historyId": "history-none" }),
            "not_found",
        ),
        (
            "providerHistory.list",
            json!({ "cursor": "nonsense" }),
            "invalid_request",
        ),
        (
            "providerHistory.list",
            json!({ "nativeId": "x" }),
            "invalid_request",
        ),
    ] {
        assert_eq!(
            call(&runtime, method, params).await.unwrap_err(),
            code,
            "{method}"
        );
    }
    assert_eq!(
        call(&runtime, "providerHistory.list", json!({}))
            .await
            .unwrap(),
        json!({ "entries": [] })
    );
}

#[test]
fn the_wire_entry_matches_the_shared_fixture() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../packages/protocol/fixtures/provider-history.json"
    ))
    .unwrap();
    let entries: Vec<HistoryEntry> = serde_json::from_value(fixture["entries"].clone()).unwrap();
    assert_eq!(serde_json::to_value(&entries).unwrap(), fixture["entries"]);
}
