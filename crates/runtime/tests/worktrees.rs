//! New chats that choose where they work: branch listing, a checkout switch
//! on Send that never discards work, chats sharing a checkout, and worktrees created on Send that the
//! agent, Review, files and terminals then use. Runs the installed Git.
use jam_runtime::{
    Runtime,
    protocol::{
        CapabilitySupport, MessageBlock, ProviderDescriptor, Request, SessionStatus,
        SubscriptionScope,
    },
    providers::{
        MockProvider, ProbeFuture, ProviderAdapter, ProviderConfig, ProviderFuture, ProviderTurn,
        ProviderUpdate, TurnIo,
    },
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::Notify;

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("jam-worktrees-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("repo")).unwrap();
        // Resolved like the runtime resolves it (macOS /var is a link), but
        // without the Windows verbatim prefix the runtime also leaves out.
        let resolved = root.canonicalize().unwrap().display().to_string();
        let temp = Self(PathBuf::from(
            resolved.strip_prefix(r"\\?\").unwrap_or(&resolved),
        ));
        temp.git(&["init", "-q", "-b", "main"]);
        temp.git(&["config", "user.email", "jam@example.invalid"]);
        temp.git(&["config", "user.name", "JAM test"]);
        temp.write("a.txt", "one\n");
        temp.git(&["add", "a.txt"]);
        temp.git(&["commit", "-q", "-m", "init"]);
        temp.git(&["branch", "feat/other"]);
        temp
    }
    fn repo(&self) -> PathBuf {
        self.0.join("repo")
    }
    fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .current_dir(self.repo())
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap()
    }
    fn write(&self, path: &str, text: &str) {
        std::fs::write(self.repo().join(path), text).unwrap();
    }
    fn branch(&self) -> String {
        self.git(&["branch", "--show-current"]).trim().to_owned()
    }
    fn worktree_count(&self) -> usize {
        self.git(&["worktree", "list", "--porcelain"])
            .lines()
            .filter(|line| line.starts_with("worktree "))
            .count()
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
            .map_err(|e| format!("{}: {}", e.code, e.message))
    })
    .await
    .unwrap()
}

/// A provider that records its folder and, when held, keeps its turn running.
#[derive(Default)]
struct Agent {
    folders: Arc<Mutex<Vec<Option<PathBuf>>>>,
    hold: Option<Arc<Notify>>,
}

impl ProviderAdapter for Agent {
    fn id(&self) -> &'static str {
        "claude"
    }
    fn unchecked(&self, _config: &ProviderConfig) -> ProviderDescriptor {
        ProviderDescriptor {
            id: "claude".into(),
            name: "Agent".into(),
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
        let folders = Arc::clone(&self.folders);
        let hold = self.hold.clone();
        Box::pin(async move {
            folders.lock().unwrap().push(turn.cwd.clone());
            if let Some(hold) = hold {
                hold.notified().await;
            }
            let _ = io
                .updates
                .send(ProviderUpdate::Blocks(vec![MessageBlock::Text {
                    text: "done".into(),
                }]))
                .await;
            let _ = io
                .updates
                .send(ProviderUpdate::Finished(SessionStatus::Idle))
                .await;
            Ok(())
        })
    }
}

async fn runtime(temp: &Temp, agent: Arc<Agent>) -> Arc<Runtime> {
    let runtime = Runtime::open_with(
        temp.0.join("jam.sqlite"),
        vec![Arc::new(MockProvider), agent],
    )
    .unwrap();
    call(
        &runtime,
        "project.update",
        json!({"projectId":"project-jam","paths":[temp.repo().display().to_string()]}),
    )
    .await
    .unwrap();
    runtime
}

fn chat(workspace: Value) -> Value {
    json!({"projectId":"project-jam","presentation":"claude","providerId":"claude","workspace":workspace})
}

async fn conversations(runtime: &Arc<Runtime>) -> usize {
    call(runtime, "workspace.get", json!({})).await.unwrap()["resources"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["kind"] == "conversation")
        .count()
}

async fn finish(runtime: &Arc<Runtime>, resource: &str) {
    let mut events = runtime
        .subscribe(SubscriptionScope {
            resource_id: Some(resource.into()),
        })
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let conversation = call(runtime, "conversation.get", json!({"resourceId": resource}))
                .await
                .unwrap();
            let workspace = call(runtime, "workspace.get", json!({})).await.unwrap();
            let session = workspace["sessions"]
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["id"] == conversation["sessionId"])
                .cloned()
                .unwrap();
            if session["status"] != "running" {
                return;
            }
            let _ = events.receiver.recv().await;
        }
    })
    .await
    .expect("turn settles");
}

#[tokio::test(flavor = "multi_thread")]
async fn branches_mark_the_current_branch_and_other_worktrees() {
    let temp = Temp::new();
    temp.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    temp.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);
    let elsewhere = temp.0.join("elsewhere");
    temp.git(&[
        "worktree",
        "add",
        "-q",
        elsewhere.to_str().unwrap(),
        "feat/other",
    ]);
    let runtime = runtime(&temp, Arc::default()).await;
    let list = call(&runtime, "git.branches", json!({"projectId":"project-jam"}))
        .await
        .unwrap();
    assert_eq!(list["state"], "repository");
    assert_eq!(list["current"], "main");
    assert_eq!(list["changed"], 0);
    let names: Vec<_> = list["branches"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["feat/other", "main", "origin/main"],
        "origin/HEAD is not a branch"
    );
    let other = &list["branches"][0];
    assert!(
        other["worktree"].as_str().unwrap().ends_with("elsewhere"),
        "{other}"
    );
    assert!(
        list["branches"][1]["worktree"].is_null(),
        "this checkout is not another worktree"
    );
    assert_eq!(list["branches"][2]["remote"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_checkout_switch_waits_for_send_and_never_discards_work() {
    let temp = Temp::new();
    let hold = Arc::new(Notify::new());
    let agent = Arc::new(Agent {
        hold: Some(Arc::clone(&hold)),
        ..Agent::default()
    });
    let runtime = runtime(&temp, agent).await;
    let before = conversations(&runtime).await;

    // A branch whose a.txt differs from main's.
    temp.git(&["switch", "-q", "-c", "feat/differs"]);
    temp.write("a.txt", "two\n");
    temp.git(&["commit", "-q", "-am", "two"]);
    temp.git(&["switch", "-q", "main"]);
    let edited = || std::fs::read_to_string(temp.repo().join("a.txt")).unwrap();

    // A switch that would overwrite an uncommitted change is Git's to refuse;
    // nothing is created or changed.
    temp.write("a.txt", "edited\n");
    let refused = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout","branch":"feat/differs"})),
    )
    .await
    .unwrap_err();
    assert!(
        refused.starts_with("conflict: Git refused to switch to feat/differs")
            && refused.ends_with("or use a new worktree for this chat."),
        "{refused}"
    );
    assert_eq!(temp.branch(), "main");
    assert_eq!(edited(), "edited\n");
    assert_eq!(conversations(&runtime).await, before);
    let listed = call(&runtime, "git.branches", json!({"projectId":"project-jam"}))
        .await
        .unwrap();
    assert_eq!(listed["changed"], 1);

    // Otherwise uncommitted and untracked files come along on Send.
    temp.write("scratch.txt", "untracked\n");
    let created = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout","branch":"feat/other"})),
    )
    .await
    .unwrap();
    assert_eq!(temp.branch(), "feat/other");
    assert_eq!(edited(), "edited\n");
    assert!(temp.repo().join("scratch.txt").exists());
    assert!(created["resource"]["worktreeId"].is_null());
    assert!(
        created.get("worktree").is_none(),
        "optional fields are omitted, not null"
    );

    // Chats share the checkout: while one is running, another starts beside
    // it, and one that asks for another branch moves the folder for both.
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    call(
        &runtime,
        "turn.start",
        json!({"resourceId": resource, "text":"go", "context": [], "requestId":"t1"}),
    )
    .await
    .unwrap();
    call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout"})),
    )
    .await
    .unwrap();
    assert_eq!(temp.branch(), "feat/other");
    call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout","branch":"main"})),
    )
    .await
    .unwrap();
    assert_eq!(temp.branch(), "main");
    assert_eq!(edited(), "edited\n");
    hold.notify_one();
    finish(&runtime, &resource).await;
    temp.git(&["switch", "-q", "feat/other"]);

    // The current branch, or none, leaves the checkout as it is.
    call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout","branch":"feat/other"})),
    )
    .await
    .unwrap();
    call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout"})),
    )
    .await
    .unwrap();
    assert_eq!(temp.branch(), "feat/other");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chat_joins_a_worktree_that_already_exists() {
    let temp = Temp::new();
    // Made outside JAM, as a terminal or another tool would.
    let elsewhere = temp.0.join("elsewhere");
    temp.git(&[
        "worktree",
        "add",
        "-q",
        elsewhere.to_str().unwrap(),
        "feat/other",
    ]);
    let agent = Arc::new(Agent::default());
    let folders = Arc::clone(&agent.folders);
    let runtime = runtime(&temp, agent).await;
    let join = || chat(json!({"kind":"existing","branch":"feat/other"}));

    let created = call(&runtime, "conversation.create", join()).await.unwrap();
    let worktree = created["worktree"].clone();
    assert_eq!(worktree["branch"], "feat/other");
    assert_eq!(PathBuf::from(worktree["path"].as_str().unwrap()), elsewhere);
    assert_eq!(created["resource"]["worktreeId"], worktree["id"]);
    assert_eq!(temp.branch(), "main", "the checkout is untouched");
    assert_eq!(temp.worktree_count(), 2, "nothing was created");

    // The agent runs in that folder.
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    call(
        &runtime,
        "turn.start",
        json!({"resourceId": resource, "text":"go", "context": [], "requestId":"t1"}),
    )
    .await
    .unwrap();
    finish(&runtime, &resource).await;
    assert_eq!(
        folders.lock().unwrap().last().cloned().flatten(),
        Some(elsewhere.clone())
    );

    // A second chat there shares the one record, and so does a chat joining
    // a worktree JAM created itself.
    let second = call(&runtime, "conversation.create", join()).await.unwrap();
    assert_eq!(second["worktree"]["id"], worktree["id"]);
    assert_ne!(second["resource"]["id"], created["resource"]["id"]);
    let made = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"worktree","baseBranch":"main","nameHint":"Fix it"})),
    )
    .await
    .unwrap();
    let joined = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"existing","branch":"jam/fix-it"})),
    )
    .await
    .unwrap();
    assert_eq!(joined["worktree"]["id"], made["worktree"]["id"]);
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    assert_eq!(workspace["worktrees"].as_array().unwrap().len(), 2);
    assert_eq!(temp.worktree_count(), 3);

    // A branch with no worktree of its own, the checkout's included, is
    // refused, and a request never names a folder.
    for branch in ["main", "missing"] {
        let refused = call(
            &runtime,
            "conversation.create",
            chat(json!({"kind":"existing","branch":branch})),
        )
        .await
        .unwrap_err();
        assert!(refused.starts_with("conflict: "), "{refused}");
    }
    let named = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"existing","branch":"feat/other","path":elsewhere})),
    )
    .await
    .unwrap_err();
    assert!(named.starts_with("invalid"), "{named}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_started_chat_changes_branch_and_worktree_between_turns() {
    let temp = Temp::new();
    let elsewhere = temp.0.join("elsewhere");
    temp.git(&[
        "worktree",
        "add",
        "-q",
        elsewhere.to_str().unwrap(),
        "feat/other",
    ]);
    temp.git(&["branch", "feat/free"]);
    let hold = Arc::new(Notify::new());
    let agent = Arc::new(Agent {
        hold: Some(Arc::clone(&hold)),
        ..Agent::default()
    });
    let folders = Arc::clone(&agent.folders);
    let runtime = runtime(&temp, agent).await;
    let created = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout"})),
    )
    .await
    .unwrap();
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    let go = |workspace: Value| {
        call(
            &runtime,
            "conversation.workspace",
            json!({"resourceId": resource, "workspace": workspace}),
        )
    };
    let turn = |request: &'static str| {
        call(
            &runtime,
            "turn.start",
            json!({"resourceId": resource, "text":"go", "context": [], "requestId": request}),
        )
    };
    let ran_in = || folders.lock().unwrap().last().cloned().flatten();

    // Never under a running turn.
    turn("t1").await.unwrap();
    let busy = go(json!({"kind":"branch","branch":"feat/free"}))
        .await
        .unwrap_err();
    assert!(busy.starts_with("conflict: Wait for the agent"), "{busy}");
    hold.notify_one();
    finish(&runtime, &resource).await;
    assert_eq!(ran_in(), Some(temp.repo()));

    // A branch no folder has: the chat's folder switches to it.
    let moved = go(json!({"kind":"branch","branch":"feat/free"}))
        .await
        .unwrap();
    assert_eq!(temp.branch(), "feat/free");
    assert!(moved["resource"]["worktreeId"].is_null());
    assert!(moved.get("worktree").is_none());

    // A branch another worktree has: the chat moves there, and the agent's
    // next turn runs in that folder.
    let moved = go(json!({"kind":"branch","branch":"feat/other"}))
        .await
        .unwrap();
    let worktree = moved["worktree"]["id"].clone();
    assert_eq!(moved["resource"]["worktreeId"], worktree);
    assert_eq!(temp.branch(), "feat/free", "the checkout is left alone");
    turn("t2").await.unwrap();
    hold.notify_one();
    finish(&runtime, &resource).await;
    assert_eq!(ran_in(), Some(elsewhere.clone()));

    // Inside a worktree a free branch switches that worktree, and its record
    // follows.
    temp.git(&["branch", "feat/second"]);
    let moved = go(json!({"kind":"branch","branch":"feat/second"}))
        .await
        .unwrap();
    assert_eq!(moved["worktree"]["id"], worktree);
    assert_eq!(moved["worktree"]["branch"], "feat/second");
    let head = Command::new("git")
        .current_dir(&elsewhere)
        .args(["branch", "--show-current"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&head.stdout).trim(), "feat/second");

    // The checkout's branch, or the checkout itself, brings it back.
    let back = go(json!({"kind":"branch","branch":"feat/free"}))
        .await
        .unwrap();
    assert!(back["resource"]["worktreeId"].is_null());
    go(json!({"kind":"branch","branch":"feat/second"}))
        .await
        .unwrap();
    let back = go(json!({"kind":"checkout"})).await.unwrap();
    assert!(back["resource"]["worktreeId"].is_null());

    // A new worktree mid-chat starts from the branch the chat was on.
    let made = go(json!({"kind":"worktree","nameHint":"Split this out"}))
        .await
        .unwrap();
    assert_eq!(made["worktree"]["branch"], "jam/split-this-out");
    assert_eq!(made["worktree"]["baseBranch"], "feat/free");
    assert_eq!(made["resource"]["worktreeId"], made["worktree"]["id"]);

    // Unknown branches, folders in the request and demo chats are refused.
    let missing = go(json!({"kind":"branch","branch":"nope"}))
        .await
        .unwrap_err();
    assert!(missing.starts_with("not_found"), "{missing}");
    let named = go(json!({"kind":"checkout","path":"C:/"}))
        .await
        .unwrap_err();
    assert!(named.starts_with("invalid"), "{named}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_worktree_is_created_on_send_and_everything_in_the_chat_uses_it() {
    let temp = Temp::new();
    let agent = Arc::new(Agent::default());
    let folders = Arc::clone(&agent.folders);
    let runtime = runtime(&temp, agent).await;
    let mut params =
        chat(json!({"kind":"worktree","baseBranch":"main","nameHint":"Fix the flaky test!"}));
    params["requestId"] = json!("send-1");

    let created = call(&runtime, "conversation.create", params.clone())
        .await
        .unwrap();
    let worktree = created["worktree"].clone();
    assert_eq!(worktree["branch"], "jam/fix-the-flaky-test");
    assert_eq!(worktree["baseBranch"], "main");
    let path = PathBuf::from(worktree["path"].as_str().unwrap());
    assert_eq!(
        path,
        temp.0.join("repo-worktrees").join("fix-the-flaky-test")
    );
    assert_eq!(created["resource"]["worktreeId"], worktree["id"]);
    assert_eq!(temp.branch(), "main", "the checkout is untouched");
    assert_eq!(temp.worktree_count(), 2);

    // A retried Send returns the same chat instead of a second worktree.
    let again = call(&runtime, "conversation.create", params.clone())
        .await
        .unwrap();
    assert_eq!(again["resource"]["id"], created["resource"]["id"]);
    assert_eq!(temp.worktree_count(), 2);
    params["workspace"]["nameHint"] = json!("other text");
    let reused = call(&runtime, "conversation.create", params)
        .await
        .unwrap_err();
    assert!(reused.starts_with("conflict"), "{reused}");

    // The same name again gets a free one; nothing existing is reused.
    let second = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"worktree","baseBranch":"main","nameHint":"Fix the flaky test!"})),
    )
    .await
    .unwrap();
    assert_eq!(second["worktree"]["branch"], "jam/fix-the-flaky-test-2");

    // The agent runs in the worktree.
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    let worktree_id = worktree["id"].as_str().unwrap().to_owned();
    call(
        &runtime,
        "turn.start",
        json!({"resourceId": resource, "text":"go", "context": [], "requestId":"t1"}),
    )
    .await
    .unwrap();
    finish(&runtime, &resource).await;
    assert_eq!(
        folders.lock().unwrap().last().cloned().flatten(),
        Some(path.clone())
    );

    // Review, files and resources address the worktree by ID.
    std::fs::write(path.join("a.txt"), "worktree edit\n").unwrap();
    let status = call(
        &runtime,
        "git.status",
        json!({"projectId":"project-jam","worktreeId": worktree_id}),
    )
    .await
    .unwrap();
    assert_eq!(status["branch"], "jam/fix-the-flaky-test");
    assert_eq!(status["worktreeId"], worktree_id.as_str());
    assert_eq!(status["files"][0]["path"], "a.txt");
    let checkout = call(&runtime, "git.status", json!({"projectId":"project-jam"}))
        .await
        .unwrap();
    assert!(checkout["files"].as_array().unwrap().is_empty());
    let file = call(
        &runtime,
        "file.read",
        json!({"projectId":"project-jam","path":"a.txt","worktreeId": worktree_id}),
    )
    .await
    .unwrap();
    assert_eq!(file["text"], "worktree edit\n");
    let opened = call(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"diff","worktreeId": worktree_id}),
    )
    .await
    .unwrap();
    let plain = call(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"diff"}),
    )
    .await
    .unwrap();
    assert_ne!(opened["resource"]["id"], plain["resource"]["id"]);
    assert_eq!(opened["resource"]["worktreeId"], worktree_id.as_str());
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    assert_eq!(workspace["worktrees"].as_array().unwrap().len(), 2);

    // A worktree that disappears is an error, never the project's folder.
    let moved = temp.0.join("moved");
    std::fs::rename(&path, &moved).unwrap();
    let missing = call(
        &runtime,
        "turn.start",
        json!({"resourceId": resource, "text":"again", "context": [], "requestId":"t2"}),
    )
    .await
    .unwrap_err();
    assert!(
        missing.starts_with("not_found") && missing.contains("is missing"),
        "{missing}"
    );
    let missing = call(
        &runtime,
        "file.read",
        json!({"projectId":"project-jam","path":"a.txt","worktreeId": worktree_id}),
    )
    .await
    .unwrap_err();
    assert!(
        missing.starts_with("not_found") && missing.contains("is missing"),
        "{missing}"
    );
    assert_eq!(folders.lock().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_worktree_chat_keeps_its_worktree_branch_and_files() {
    let temp = Temp::new();
    let runtime = runtime(&temp, Arc::default()).await;
    let created = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"worktree","nameHint":"Delete this chat"})),
    )
    .await
    .unwrap();
    let resource = created["resource"]["id"].as_str().unwrap().to_owned();
    let worktree = created["worktree"].clone();
    let folder = PathBuf::from(worktree["path"].as_str().unwrap());
    call(
        &runtime,
        "turn.start",
        json!({"resourceId":resource,"text":"Work here","context":[],"requestId":"work"}),
    )
    .await
    .unwrap();
    finish(&runtime, &resource).await;
    std::fs::write(folder.join("made-by-agent.txt"), "kept\n").unwrap();
    // The interrupted or finished turn's task may take a moment to end.
    tokio::time::timeout(Duration::from_secs(10), async {
        while let Err(error) = call(
            &runtime,
            "conversation.delete",
            json!({"resourceId":resource}),
        )
        .await
        {
            assert!(error.starts_with("conflict"), "{error}");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("the chat is deleted");

    // JAM's record of the chat is gone; the worktree it made is not.
    let workspace = call(&runtime, "workspace.get", json!({})).await.unwrap();
    assert!(
        !workspace["resources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == json!(resource))
    );
    assert_eq!(workspace["worktrees"], json!([worktree]));
    assert_eq!(temp.worktree_count(), 2);
    assert!(
        temp.git(&["branch", "--list", worktree["branch"].as_str().unwrap()])
            .contains(worktree["branch"].as_str().unwrap())
    );
    assert_eq!(
        std::fs::read_to_string(folder.join("made-by-agent.txt")).unwrap(),
        "kept\n"
    );
    assert_eq!(
        std::fs::read_to_string(temp.repo().join("a.txt")).unwrap(),
        "one\n"
    );
    // The worktree is still usable from JAM: a Review of it opens.
    call(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"diff","worktreeId":worktree["id"]}),
    )
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn unsafe_names_unknown_targets_and_demo_chats_are_refused_before_git() {
    let temp = Temp::new();
    let runtime = runtime(&temp, Arc::default()).await;
    for base in ["--upload-pack=touch pwned", "-b", "a..b", "main\nx"] {
        let refused = call(
            &runtime,
            "conversation.create",
            chat(json!({"kind":"worktree","baseBranch":base,"nameHint":"x"})),
        )
        .await
        .unwrap_err();
        assert!(
            refused.starts_with("invalid_request"),
            "{base:?}: {refused}"
        );
    }
    let refused = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"checkout","branch":"--orphan"})),
    )
    .await
    .unwrap_err();
    assert!(refused.starts_with("invalid_request"), "{refused}");
    let missing = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"worktree","baseBranch":"nope","nameHint":"x"})),
    )
    .await
    .unwrap_err();
    assert!(missing.starts_with("not_found"), "{missing}");
    let path = call(
        &runtime,
        "conversation.create",
        chat(json!({"kind":"worktree","baseBranch":"main","nameHint":"x","path":"C:/"})),
    )
    .await
    .unwrap_err();
    assert!(
        path.starts_with("invalid_request"),
        "clients never choose the folder: {path}"
    );
    let demo = call(
        &runtime,
        "conversation.create",
        json!({"projectId":"project-jam","presentation":"claude","workspace":{"kind":"worktree","baseBranch":"main","nameHint":"x"}}),
    )
    .await
    .unwrap_err();
    assert!(demo.starts_with("invalid_request"), "{demo}");
    let unknown = call(
        &runtime,
        "git.status",
        json!({"projectId":"project-jam","worktreeId":"worktree-nope"}),
    )
    .await
    .unwrap_err();
    assert!(unknown.starts_with("not_found"), "{unknown}");
    let browser = call(
        &runtime,
        "resource.open",
        json!({"projectId":"project-jam","kind":"browser","worktreeId":"worktree-x"}),
    )
    .await
    .unwrap_err();
    assert!(browser.starts_with("invalid_request"), "{browser}");
    assert_eq!(temp.worktree_count(), 1);
    assert!(!Path::new(&temp.0.join("repo-worktrees")).join("x").exists());
    assert_eq!(temp.branch(), "main");
}
