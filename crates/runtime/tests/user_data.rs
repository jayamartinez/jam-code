//! The user's database: a clean first run, the upgrade from the pre-alpha
//! `jam-demo.sqlite` (demo seed removed, the person's work kept), schema
//! guards, and adding, removing and restoring projects.

use jam_runtime::{Runtime, protocol::Request};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

struct TempDir(PathBuf);
impl TempDir {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("jam-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn call(
    runtime: &Arc<Runtime>,
    method: &str,
    params: Value,
) -> Result<Value, jam_runtime::JamError> {
    runtime.request(Request {
        protocol_version: 1,
        method: method.into(),
        params,
    })
}
fn request(runtime: &Arc<Runtime>, method: &str, params: Value) -> Value {
    call(runtime, method, params).unwrap()
}
fn workspace(runtime: &Arc<Runtime>) -> Value {
    request(runtime, "workspace.get", json!({}))
}
fn ids(workspace: &Value, key: &str) -> Vec<String> {
    workspace[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}
fn search(runtime: &Arc<Runtime>, text: &str) -> usize {
    request(runtime, "search.query", json!({ "query": text }))["results"]
        .as_array()
        .unwrap()
        .len()
}

#[test]
fn a_fresh_install_has_no_demo_content() {
    let data = TempDir::new("fresh");
    let runtime = Runtime::open_user_data(&data.0).unwrap();
    let snapshot = workspace(&runtime);
    assert!(snapshot["projects"].as_array().unwrap().is_empty());
    // Only the Settings resource, so Settings can still open as a tab.
    assert_eq!(ids(&snapshot, "resources"), ["settings"]);
    assert!(snapshot["sessions"].as_array().unwrap().is_empty());
    // The demo provider is not a product provider.
    assert_eq!(ids(&snapshot, "providers"), ["claude", "codex"]);
    assert!(data.0.join("jam.sqlite").exists());
    assert!(!data.0.join("jam-demo.sqlite").exists());
    drop(runtime);
    // Reopening adds nothing and backs up nothing.
    let runtime = Runtime::open_user_data(&data.0).unwrap();
    assert_eq!(ids(&workspace(&runtime), "resources"), ["settings"]);
    assert!(
        !std::fs::read_dir(&data.0)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().ends_with(".bak"))
    );
}

/// A database as a pre-alpha development build left it: schema 6, the demo
/// seed, and real work — a demo project pointed at a real folder holding a
/// Claude chat bound to its provider session, a person's own demo-provider
/// chat, a terminal opened in a folderless demo project, a message typed into
/// a seeded chat, and appearance settings.
fn pre_alpha_database(path: &Path, folder: &Path) {
    drop(Runtime::open_demo(path).unwrap());
    let db = Connection::open(path).unwrap();
    let project: String = db
        .query_row(
            "SELECT data FROM projects WHERE id='project-forge'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let mut project: Value = serde_json::from_str(&project).unwrap();
    project["paths"] = json!([folder.to_str().unwrap()]);
    db.execute(
        "UPDATE projects SET data=?1 WHERE id='project-forge'",
        [project.to_string()],
    )
    .unwrap();
    let conversation = |id: &str,
                        project: &str,
                        session: &str,
                        provider: &str,
                        title: &str,
                        text: &str| {
        let resource = json!({"id":id,"kind":"conversation","title":title,"projectId":project,
            "sessionId":session,"pinned":false,"updatedAt":"2026-09-29T12:00:00Z"});
        db.execute(
            "INSERT INTO resources(id,project_id,data) VALUES (?1,?2,?3)",
            params![id, project, resource.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO conversations(id,resource_id,data) VALUES (?1,?1,?2)",
            params![id, json!({"sessionId":session}).to_string()],
        )
        .unwrap();
        let session_data = json!({"id":session,"resourceId":id,"providerId":provider,
            "presentation": if provider == "codex" {"codex"} else {"claude"},"status":"idle","model":"opus"});
        db.execute(
            "INSERT INTO sessions(id,conversation_id,data) VALUES (?1,?2,?3)",
            params![session, id, session_data.to_string()],
        )
        .unwrap();
        let message_id = format!("{id}-message");
        let message = json!({"id":message_id,"role":"user","createdAt":"2026-09-29T12:00:00Z",
            "blocks":[{"type":"text","text":text}]});
        db.execute(
            "INSERT INTO messages(id,conversation_id,ordinal,data) VALUES (?1,?2,1,?3)",
            params![message_id, id, message.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO search_documents(resource_id,message_id,title,body) VALUES (?1,?2,?3,?4)",
            params![id, message_id, title, text],
        )
        .unwrap();
    };
    conversation(
        "conversation-real",
        "project-forge",
        "session-real",
        "claude",
        "Read math.ts",
        "list the exported functions quasarword",
    );
    db.execute(
        "INSERT INTO provider_bindings(session_id,provider_id,native_id,created_at,updated_at)
         VALUES ('session-real','claude','claude-native-1','2026-09-29','2026-09-29')",
        [],
    )
    .unwrap();
    conversation(
        "conversation-own-demo",
        "project-atlas",
        "session-own-demo",
        "mock",
        "My demo try",
        "trying the demo nebulaword",
    );
    let terminal = json!({"id":"terminal-own","kind":"terminal","title":"pwsh","projectId":"project-jam",
        "pinned":false,"updatedAt":"2026-09-28T00:00:00Z"});
    db.execute(
        "INSERT INTO resources(id,project_id,data) VALUES ('terminal-own','project-jam',?1)",
        [terminal.to_string()],
    )
    .unwrap();
    let typed = json!({"id":"typed-into-demo","role":"user","createdAt":"2026-09-28T00:00:00Z",
        "blocks":[{"type":"text","text":"typed into the seed pulsarword"}]});
    db.execute(
        "INSERT INTO messages(id,conversation_id,ordinal,data) VALUES ('typed-into-demo','conv-pane-lifetime',9,?1)",
        [typed.to_string()],
    )
    .unwrap();
    db.execute(
        "INSERT INTO search_documents(resource_id,message_id,title,body) VALUES ('conv-pane-lifetime','typed-into-demo','t','typed into the seed pulsarword')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO metadata(key,value) VALUES ('snapshot_last_conversation','conv-pane-lifetime')",
        [],
    )
    .unwrap();
    db.execute(
        "INSERT INTO settings(key,value,updated_at) VALUES ('providers','{\"providers\":{\"codex\":{\"enabled\":true}}}','2026-09-29')",
        [],
    )
    .unwrap();
    // A version 6 database has nothing a later migration adds.
    db.execute_batch(
        "DROP TABLE attachments;
         DROP TABLE provider_history;
         DROP INDEX messages_source;
         ALTER TABLE messages DROP COLUMN source_id;
         DROP INDEX provider_bindings_native;
         ALTER TABLE provider_bindings DROP COLUMN instance_id;
         CREATE INDEX provider_bindings_native ON provider_bindings(provider_id, native_id);",
    )
    .unwrap();
    db.pragma_update(None, "user_version", 6).unwrap();
}

#[test]
fn upgrading_a_pre_alpha_database_keeps_the_persons_work() {
    let data = TempDir::new("upgrade");
    let folder = data.0.join("café repo");
    std::fs::create_dir_all(folder.join(".git")).unwrap();
    std::fs::write(folder.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    let legacy = data.0.join("jam-demo.sqlite");
    pre_alpha_database(&legacy, &folder);
    let legacy_bytes = std::fs::metadata(&legacy).unwrap().len();

    let runtime = Runtime::open_user_data(&data.0).unwrap();
    let snapshot = workspace(&runtime);

    // Only the demo project that held real work stays, named after its folder
    // and on its live branch.
    let projects = snapshot["projects"].as_array().unwrap();
    assert_eq!(projects.len(), 2, "{projects:#?}");
    let forge = projects
        .iter()
        .find(|p| p["id"] == "project-forge")
        .unwrap();
    assert_eq!(forge["name"], "café repo");
    assert_eq!(forge["initials"], "CR");
    assert_eq!(forge["branch"], "main");
    assert!(forge.get("folderMissing").is_none());
    // A person's own chat keeps its folderless demo project.
    let atlas = projects
        .iter()
        .find(|p| p["id"] == "project-atlas")
        .unwrap();
    assert_eq!(atlas["branch"], "");

    let resources = ids(&snapshot, "resources");
    for kept in ["conversation-real", "conversation-own-demo", "settings"] {
        assert!(resources.iter().any(|id| id == kept), "{kept} kept");
    }
    for removed in [
        "conv-shortcuts",
        "conv-pane-lifetime",
        "conv-layout",
        "terminal-pane",
        "terminal-own",
        "file-pane",
    ] {
        assert!(
            !resources.iter().any(|id| id == removed),
            "{removed} removed"
        );
    }
    assert_eq!(resources.len(), 3);
    assert_eq!(
        ids(&snapshot, "sessions"),
        ["session-real", "session-own-demo"]
    );
    let conversation = request(
        &runtime,
        "conversation.get",
        json!({"resourceId":"conversation-real"}),
    );
    assert_eq!(conversation["messages"].as_array().unwrap().len(), 1);

    // Search follows the records.
    assert_eq!(search(&runtime, "quasarword"), 1);
    assert_eq!(search(&runtime, "nebulaword"), 1);
    assert_eq!(search(&runtime, "pulsarword"), 0);
    assert_eq!(search(&runtime, "resource"), 0);
    drop(runtime);

    let db = Connection::open(data.0.join("jam.sqlite")).unwrap();
    let version: i64 = db
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 9);
    let binding: String = db
        .query_row(
            "SELECT native_id FROM provider_bindings WHERE session_id='session-real'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(binding, "claude-native-1");
    let settings: String = db
        .query_row(
            "SELECT value FROM settings WHERE key='providers'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(settings.contains("codex"));
    let metadata: Vec<String> = db
        .prepare("SELECT key FROM metadata ORDER BY key")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(metadata, ["demo_seed_removed", "imported_from"]);
    let fts: i64 = db
        .query_row(
            "SELECT count(*) FROM search_fts WHERE search_fts MATCH 'pulsarword'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(fts, 0);

    // The old file is untouched and a pre-upgrade copy sits beside the new one.
    assert_eq!(std::fs::metadata(&legacy).unwrap().len(), legacy_bytes);
    let old = Connection::open(&legacy).unwrap();
    let old_version: i64 = old
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(old_version, 6);
    let seeded: i64 = old
        .query_row(
            "SELECT count(*) FROM resources WHERE id='conv-shortcuts'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(seeded, 1);
    assert!(data.0.join("jam.sqlite.before-v7.bak").exists());

    // Once imported, the new database is the one opened; nothing is re-imported.
    let runtime = Runtime::open_user_data(&data.0).unwrap();
    assert_eq!(ids(&workspace(&runtime), "resources").len(), 3);
}

#[test]
fn a_database_from_a_newer_version_is_refused_untouched() {
    let data = TempDir::new("newer");
    drop(Runtime::open_user_data(&data.0).unwrap());
    let path = data.0.join("jam.sqlite");
    Connection::open(&path)
        .unwrap()
        .pragma_update(None, "user_version", 99)
        .unwrap();
    let error = Runtime::open_user_data(&data.0).err().expect("refused");
    assert!(error.message.contains("newer version"), "{}", error.message);
    let version: i64 = Connection::open(&path)
        .unwrap()
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .unwrap();
    assert_eq!(version, 99);

    // The same guard applies to a legacy file from a newer build.
    let other = TempDir::new("newer-legacy");
    let legacy = other.0.join("jam-demo.sqlite");
    drop(Runtime::open_demo(&legacy).unwrap());
    Connection::open(&legacy)
        .unwrap()
        .pragma_update(None, "user_version", 99)
        .unwrap();
    assert!(Runtime::open_user_data(&other.0).is_err());
    assert!(!other.0.join("jam.sqlite").exists());
}

#[test]
fn an_explicit_demo_database_still_has_its_seed() {
    let data = TempDir::new("demo");
    let runtime = Runtime::open_demo(data.0.join("demo.sqlite")).unwrap();
    let snapshot = workspace(&runtime);
    assert_eq!(snapshot["projects"].as_array().unwrap().len(), 4);
    assert!(ids(&snapshot, "providers").iter().any(|id| id == "mock"));
}

#[test]
fn a_folder_belongs_to_one_project() {
    let data = TempDir::new("taken-folders");
    let (app, docs, other) = (
        data.0.join("app"),
        data.0.join("docs"),
        data.0.join("other"),
    );
    for folder in [&app, &docs, &other] {
        std::fs::create_dir_all(folder).unwrap();
    }
    let runtime = Runtime::open_user_data(data.0.join("app-data")).unwrap();
    let path = |folder: &std::path::PathBuf| folder.to_str().unwrap().to_owned();
    request(
        &runtime,
        "project.create",
        json!({ "paths": [path(&app), path(&docs)] }),
    );

    // Another project's second folder cannot start or join a new one.
    let error = call(
        &runtime,
        "project.create",
        json!({ "paths": [path(&docs)] }),
    )
    .unwrap_err();
    assert!(error.to_string().contains("already in app"), "{error}");
    let second = request(
        &runtime,
        "project.create",
        json!({ "paths": [path(&other)] }),
    );
    let id = second["project"]["id"].as_str().unwrap();
    let error = call(
        &runtime,
        "project.update",
        json!({ "projectId": id, "paths": [path(&other), path(&app)] }),
    )
    .unwrap_err();
    assert!(error.to_string().contains("already in app"), "{error}");
}

#[test]
fn folders_become_projects_that_can_be_removed_and_restored() {
    let data = TempDir::new("projects");
    let folder = data.0.join("My App");
    std::fs::create_dir_all(folder.join("src")).unwrap();
    std::fs::create_dir_all(folder.join(".git")).unwrap();
    std::fs::write(folder.join(".git/HEAD"), "ref: refs/heads/trunk\n").unwrap();
    std::fs::write(folder.join("README.md"), "hello").unwrap();
    std::fs::write(folder.join("src/lib.rs"), "fn main() {}").unwrap();
    let runtime = Runtime::open_user_data(data.0.join("app-data")).unwrap();

    let added = request(
        &runtime,
        "project.create",
        json!({ "paths": [folder.to_str().unwrap()] }),
    );
    assert_eq!(added["existing"], false);
    let project = &added["project"];
    let id = project["id"].as_str().unwrap().to_owned();
    assert_eq!(project["name"], "My App");
    assert_eq!(project["initials"], "MA");
    assert_eq!(project["branch"], "trunk");

    // The same folder, however it is written, is the same project.
    let spelled = format!("{}{}", folder.to_str().unwrap(), std::path::MAIN_SEPARATOR);
    let again = request(&runtime, "project.create", json!({ "paths": [spelled] }));
    assert_eq!(again["existing"], true);
    assert_eq!(again["project"]["id"], id.as_str());
    assert_eq!(
        ids(&workspace(&runtime), "projects"),
        std::slice::from_ref(&id)
    );

    // Its files list natively, one level at a time, without `.git`.
    let listing = request(
        &runtime,
        "directory.list",
        json!({ "projectId": id, "path": "" }),
    );
    assert_eq!(listing["demo"], false);
    let names: Vec<&str> = listing["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["src", "README.md"]);
    let inner = request(
        &runtime,
        "directory.list",
        json!({ "projectId": id, "path": "src" }),
    );
    assert_eq!(inner["entries"][0]["path"], "src/lib.rs");
    for escape in ["..", "../..", "src/../..", ".git", "/etc"] {
        assert!(
            call(
                &runtime,
                "directory.list",
                json!({ "projectId": id, "path": escape })
            )
            .is_err(),
            "{escape} refused"
        );
    }

    // Removing forgets the project, never its folder, and adding the folder
    // again brings the same project back.
    request(&runtime, "project.remove", json!({ "projectId": id }));
    assert!(
        workspace(&runtime)["projects"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(folder.join("README.md").exists());
    let restored = request(
        &runtime,
        "project.create",
        json!({ "paths": [folder.to_str().unwrap()] }),
    );
    assert_eq!(restored["existing"], true);
    assert_eq!(restored["project"]["id"], id.as_str());
    assert_eq!(
        ids(&workspace(&runtime), "projects"),
        std::slice::from_ref(&id)
    );

    // A plain folder is a project too; it has no branch.
    let plain = data.0.join("notes");
    std::fs::create_dir_all(&plain).unwrap();
    let plain = request(
        &runtime,
        "project.create",
        json!({ "paths": [plain.to_str().unwrap()] }),
    );
    assert_eq!(plain["project"]["branch"], "");

    // A folder that disappears is reported, not dropped.
    std::fs::remove_dir_all(&folder).unwrap();
    let snapshot = workspace(&runtime);
    let missing = snapshot["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id.as_str())
        .unwrap();
    assert_eq!(missing["folderMissing"], true);

    // Survives restart.
    drop(runtime);
    let runtime = Runtime::open_user_data(data.0.join("app-data")).unwrap();
    assert_eq!(workspace(&runtime)["projects"].as_array().unwrap().len(), 2);
}

#[test]
fn adding_a_folder_rejects_what_is_not_one() {
    let data = TempDir::new("invalid");
    let file = data.0.join("file.txt");
    std::fs::write(&file, "x").unwrap();
    let runtime = Runtime::open_user_data(data.0.join("app-data")).unwrap();
    for (path, expected) in [
        (file.to_str().unwrap().to_owned(), "not a file"),
        (
            data.0.join("gone").to_str().unwrap().to_owned(),
            "doesn't exist",
        ),
        ("relative/folder".to_owned(), "absolute"),
        (String::new(), "Choose a folder"),
    ] {
        let error = call(&runtime, "project.create", json!({ "paths": [path] })).unwrap_err();
        assert!(
            error.message.contains(expected),
            "{path}: {}",
            error.message
        );
    }
    assert!(
        call(
            &runtime,
            "project.create",
            json!({ "paths": ["/"], "extra": 1 })
        )
        .is_err()
    );
    assert!(
        call(
            &runtime,
            "project.remove",
            json!({ "projectId": "project-missing" })
        )
        .is_err()
    );
}

/// Upgrades a copy of a real pre-alpha database and prints what survived.
/// `JAM_UPGRADE_SOURCE=<path to jam-demo.sqlite> cargo test -p jam-runtime
/// --test user_data upgrade_a_copy -- --ignored --nocapture`. The source file
/// is only read.
#[test]
#[ignore = "needs JAM_UPGRADE_SOURCE"]
fn upgrade_a_copy_of_a_real_database() {
    let source = PathBuf::from(std::env::var("JAM_UPGRADE_SOURCE").expect("JAM_UPGRADE_SOURCE"));
    let data = TempDir::new("real-upgrade");
    Connection::open_with_flags(&source, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .unwrap()
        .execute(
            "VACUUM INTO ?1",
            [data.0.join("jam-demo.sqlite").to_str().unwrap()],
        )
        .unwrap();
    let before: Vec<(String, i64)> = {
        let db = Connection::open(data.0.join("jam-demo.sqlite")).unwrap();
        db.prepare("SELECT json_extract(s.data,'$.providerId'), count(m.id) FROM sessions s LEFT JOIN messages m ON m.conversation_id=s.conversation_id GROUP BY 1")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    let runtime = Runtime::open_user_data(&data.0).unwrap();
    let snapshot = workspace(&runtime);
    println!("messages by provider before: {before:?}");
    for project in snapshot["projects"].as_array().unwrap() {
        println!(
            "project {} {:?} branch {:?} missing {}",
            project["id"], project["name"], project["branch"], project["folderMissing"]
        );
    }
    for resource in snapshot["resources"].as_array().unwrap() {
        println!(
            "resource {} {} in {}",
            resource["id"], resource["kind"], resource["projectId"]
        );
    }
    for session in snapshot["sessions"].as_array().unwrap() {
        let messages = request(
            &runtime,
            "conversation.get",
            json!({ "resourceId": session["resourceId"] }),
        )["messages"]
            .as_array()
            .unwrap()
            .len();
        println!(
            "session {} {} messages {messages}",
            session["id"], session["providerId"]
        );
    }
}

#[test]
fn a_new_project_can_have_a_name_an_icon_and_several_folders() {
    let data = TempDir::new("named");
    let app = data.0.join("app");
    let docs = data.0.join("docs");
    std::fs::create_dir_all(&app).unwrap();
    std::fs::create_dir_all(&docs).unwrap();
    let runtime = Runtime::open_user_data(data.0.join("app-data")).unwrap();
    let added = request(
        &runtime,
        "project.create",
        json!({
            "paths": [app.to_str().unwrap(), docs.to_str().unwrap(), app.to_str().unwrap()],
            "name": "  Storefront  ",
            "icon": { "kind": "emoji", "value": "🛒" },
        }),
    );
    let project = &added["project"];
    assert_eq!(project["name"], "Storefront");
    assert_eq!(project["initials"], "ST");
    assert_eq!(project["icon"]["value"], "🛒");
    // The first folder is primary; a repeated folder is listed once.
    assert_eq!(project["paths"].as_array().unwrap().len(), 2);
    assert!(project["paths"][0].as_str().unwrap().ends_with("app"));
    // Every folder must exist, and names and icons are validated.
    let missing = data.0.join("missing");
    for params in [
        json!({ "paths": [app.to_str().unwrap(), missing.to_str().unwrap()] }),
        json!({ "paths": [app.to_str().unwrap()], "name": "x".repeat(200) }),
        json!({ "paths": [app.to_str().unwrap()], "icon": { "kind": "emoji", "value": "<b>" } }),
        json!({ "paths": [] }),
    ] {
        assert!(call(&runtime, "project.create", params).is_err());
    }
}
