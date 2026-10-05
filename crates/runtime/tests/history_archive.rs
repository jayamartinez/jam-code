mod history_support;
use history_support::*;
use std::process::Command;

/// Runs Git in `folder`, which must succeed.
fn git(folder: &str, args: &[&str]) {
    let out = Command::new("git")
        .current_dir(folder)
        .args(["-c", "core.hooksPath=", "-c", "commit.gpgsign=false"])
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A repository on `main` with a merged branch, a branch with work still
/// its own, and a branch that only points at `main`.
fn repository(folder: &str) {
    git(folder, &["init", "-b", "main"]);
    git(folder, &["config", "user.email", "test@example.invalid"]);
    git(folder, &["config", "user.name", "JAM Test"]);
    let commit = |name: &str| {
        std::fs::write(std::path::Path::new(folder).join(name), name).unwrap();
        git(folder, &["add", "--all"]);
        git(folder, &["commit", "-m", name]);
    };
    commit("start");
    git(folder, &["switch", "-c", "feat/done"]);
    commit("done");
    git(folder, &["switch", "main"]);
    git(
        folder,
        &["merge", "--no-ff", "-m", "merge done", "feat/done"],
    );
    git(folder, &["switch", "-c", "feat/live"]);
    commit("live");
    git(folder, &["switch", "main"]);
    git(folder, &["branch", "feat/fresh"]);
}

fn on_branch(native_id: &str, folder: &str, branch: Option<&str>) -> Thread {
    let mut thread = thread(native_id, native_id, Some(folder), &["hi", "hello"]);
    thread.item.branch = branch.map(Into::into);
    thread
}

#[tokio::test(flavor = "multi_thread")]
async fn a_folder_says_which_chats_finished_their_branch() {
    let temp = Temp::new();
    let folder = temp.folder("project");
    repository(&folder);
    let claude = Scripted::new(
        "claude",
        10,
        vec![
            on_branch("merged", &folder, Some("feat/done")),
            on_branch("unmerged", &folder, Some("feat/live")),
            on_branch("deleted", &folder, Some("feat/gone")),
            on_branch("fresh", &folder, Some("feat/fresh")),
            on_branch("default", &folder, Some("main")),
            on_branch("unknown", &folder, None),
            on_branch("unusable", &folder, Some("--output=x")),
        ],
    );
    let rt = open(&temp, &[&claude]);
    let found = ok(
        &rt,
        "providerHistory.findInFolders",
        json!({ "paths": [folder] }),
    )
    .await;
    let entries: Vec<HistoryEntry> = serde_json::from_value(found["entries"].clone()).unwrap();
    let merged = |title: &str| {
        let entry = entries
            .iter()
            .find(|entry| entry.title.as_deref() == Some(title))
            .unwrap();
        entry.merged
    };
    assert_eq!(merged("merged"), Some(true));
    assert_eq!(merged("deleted"), Some(true));
    assert_eq!(merged("unmerged"), Some(false));
    assert_eq!(merged("fresh"), Some(false));
    assert_eq!(merged("default"), Some(false));
    assert_eq!(merged("unknown"), None);
    assert_eq!(merged("unusable"), None);
    let branch = entries
        .iter()
        .find(|entry| entry.title.as_deref() == Some("merged"))
        .and_then(|entry| entry.branch.clone());
    assert_eq!(branch.as_deref(), Some("feat/done"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sync_can_bring_a_chat_in_archived() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let parser = entry(&rt, "Fix the parser").await;
    let synced = ok(
        &rt,
        "providerHistory.sync",
        json!({ "historyId": parser.id, "archive": true }),
    )
    .await;
    assert!(synced["resource"]["closedAt"].is_string());
    // Archiving applies to a new projection only; a later sync keeps the
    // reader's choice.
    let resource_id = synced["resource"]["id"].as_str().unwrap().to_owned();
    ok(
        &rt,
        "thread.setClosed",
        json!({ "resourceId": resource_id, "closed": false }),
    )
    .await;
    let again = ok(
        &rt,
        "providerHistory.sync",
        json!({ "historyId": parser.id, "archive": true }),
    )
    .await;
    assert!(again["resource"]["closedAt"].is_null());
}
