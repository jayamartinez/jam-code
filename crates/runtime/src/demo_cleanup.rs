//! Schema migration 7: separate the user's history from the demo seed.
//!
//! Before the alpha, every desktop database was seeded with synthetic demo
//! projects and mock conversations, and real Claude Code and Codex chats were
//! then created beside them — often inside a demo project the developer had
//! pointed at a real folder. This step removes exactly the seeded records and
//! keeps everything a person made. See ADR 0013.
//!
//! - Seeded demo conversations and the demo panes are removed by their fixture
//!   IDs. They only ever ran the demo provider, which never edited files or
//!   called a model, so nothing real is lost with them.
//! - A seeded demo project is kept, as an ordinary project, when it has a
//!   folder or still owns a conversation or worktree; its fixture name is
//!   replaced by its folder's name and its fixture branch by the live one.
//!   A demo project with neither is removed with anything left inside it.
//! - Conversations and resources a person created are never removed, whatever
//!   provider they used.
//!
//! The step runs inside the migration's transaction, and the database was
//! backed up beside itself before any migration ran.

use crate::{commands::initials_of, error::JamError, protocol::Project};
use rusqlite::{OptionalExtension, Transaction, params};

/// Conversation IDs in `packages/protocol/fixtures/workspace.json`.
const DEMO_CONVERSATIONS: [&str; 9] = [
    "conv-pane-lifetime",
    "conv-navigation",
    "conv-layout",
    "conv-browser",
    "conv-shortcuts",
    "conv-tokens",
    "conv-search",
    "conv-composer",
    "conv-window",
];
/// The fixture's non-conversation panes. The Settings resource is not demo
/// content and stays.
const DEMO_RESOURCES: [&str; 4] = ["diff-pane", "terminal-pane", "file-pane", "browser-pane"];
/// Fixture project IDs and the names the fixture gave them.
const DEMO_PROJECTS: [(&str, &str); 4] = [
    ("project-jam", "jam-code"),
    ("project-atlas", "atlas-web"),
    ("project-forge", "forge-cli"),
    ("project-orbit", "orbit-api"),
];

pub(crate) fn remove_demo_seed(tx: &Transaction<'_>) -> Result<(), JamError> {
    let seeded = tx
        .query_row(
            "SELECT 1 FROM metadata WHERE key='demo_seed_v1'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !seeded {
        return Ok(());
    }
    let mut removed_conversations = Vec::new();
    for id in DEMO_CONVERSATIONS {
        // Only a conversation the demo provider ran is the seed's.
        let mock: Option<bool> = tx
            .query_row(
                "SELECT json_extract(data,'$.providerId')='mock' FROM sessions WHERE conversation_id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        if mock == Some(true) {
            crate::storage::delete_conversation_rows(tx, id)?;
            removed_conversations.push(id);
        }
    }
    for id in DEMO_RESOURCES {
        tx.execute("DELETE FROM resources WHERE id=?1", [id])?;
    }
    for (id, fixture_name) in DEMO_PROJECTS {
        let Some(data) = tx
            .query_row("SELECT data FROM projects WHERE id=?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?
        else {
            continue;
        };
        let mut project: Project = serde_json::from_str(&data)?;
        let owns = |sql: &str| -> Result<bool, JamError> {
            Ok(tx.query_row(sql, [id], |row| row.get::<_, i64>(0))? > 0)
        };
        let keep = !project.paths.is_empty()
            || owns(
                "SELECT count(*) FROM resources WHERE project_id=?1 AND json_extract(data,'$.kind')='conversation'",
            )?
            || owns("SELECT count(*) FROM worktrees WHERE project_id=?1")?;
        if keep {
            if project.name == fixture_name
                && let Some(name) = project.paths.first().and_then(|path| folder_name(path))
            {
                project.name = name;
                project.initials = initials_of(&project.name);
            }
            // The fixture's branch is fiction; the live one is read from Git.
            project.branch = String::new();
            tx.execute(
                "UPDATE projects SET data=?2 WHERE id=?1",
                params![id, serde_json::to_string(&project)?],
            )?;
        } else {
            // Only panes remain: terminals, files, reviews or browsers opened
            // in a folderless demo project. None holds anything durable.
            tx.execute("DELETE FROM resources WHERE project_id=?1", [id])?;
            tx.execute("DELETE FROM file_edits WHERE project_id=?1", [id])?;
            tx.execute("DELETE FROM projects WHERE id=?1", [id])?;
        }
    }
    for id in &removed_conversations {
        // A capture waiting for a removed chat goes back to the inbox.
        tx.execute(
            "UPDATE snapshots SET data=json_remove(data,'$.resourceId')
             WHERE sent=0 AND json_extract(data,'$.resourceId')=?1",
            [id],
        )?;
        tx.execute(
            "DELETE FROM metadata WHERE key='snapshot_last_conversation' AND value=?1",
            [id],
        )?;
    }
    tx.execute("DELETE FROM metadata WHERE key='demo_seed_v1'", [])?;
    tx.execute(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES ('demo_seed_removed',?1)",
        [crate::runtime::now()],
    )?;
    Ok(())
}

/// The last component of a stored folder path, written on either platform.
pub(crate) fn folder_name(path: &str) -> Option<String> {
    path.trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !name.ends_with(':'))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::folder_name;

    #[test]
    fn folder_names_come_from_either_separator() {
        assert_eq!(
            folder_name(r"C:\code\café repo\").as_deref(),
            Some("café repo")
        );
        assert_eq!(folder_name("/Users/a/code/jam").as_deref(), Some("jam"));
        assert_eq!(folder_name(r"C:\"), None);
        assert_eq!(folder_name("/"), None);
    }
}
