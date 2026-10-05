mod history_support;
use history_support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_folder_jam_trusts_links_its_entry() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 2, three(&temp));
    let rt = open(&temp, &[&codex]);
    let project = add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    let a = entry(&rt, "Fix the parser").await;
    assert_eq!(a.project_id.as_deref(), Some(project.as_str()));
    assert_eq!(entry(&rt, "Elsewhere").await.project_id, None);
    assert_eq!(entry(&rt, "No folder").await.project_id, None);
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
    let rt = open(&temp, &[&codex]);
    let project = add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;

    for title in [
        "Unknown folder",
        "System folder",
        "Relative",
        "Climbing",
        "Inside the project",
    ] {
        let unlinked = entry(&rt, title).await;
        assert_eq!(unlinked.project_id, None, "{title}");
    }
    assert_eq!(
        entry(&rt, "Exact").await.project_id.as_deref(),
        Some(project.as_str())
    );
    let workspace = workspace(&rt).await;
    assert_eq!(workspace["projects"].as_array().unwrap().len(), 1);
    assert_eq!(conversations(&workspace), 0);
    assert_eq!(codex.reads(), 0);
    // The reported folder is shown, and is never a project ID.
    let unknown = entry(&rt, "Unknown folder").await;
    assert_eq!(
        unknown.source_path.as_deref(),
        Some(temp.folder("unknown-folder").as_str())
    );
    assert_eq!(
        err(
            &rt,
            "providerHistory.associate",
            json!({ "historyId": unknown.id, "projectId": "project-nowhere" })
        )
        .await,
        "not_found"
    );
    // Adding the folder through the normal flow is what links it.
    std::fs::create_dir_all(temp.folder("unknown-folder")).unwrap();
    let added = add_project(&rt, &temp.folder("unknown-folder")).await;
    scan(&rt, "codex").await;
    assert_eq!(
        entry(&rt, "Unknown folder").await.project_id.as_deref(),
        Some(added.as_str())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chosen_project_outlasts_what_the_provider_reports() {
    let temp = Temp::new();
    let codex = Scripted::new("codex", 10, three(&temp));
    let rt = open(&temp, &[&codex]);
    add_project(&rt, &temp.folder("project")).await;
    let other = add_project(&rt, &temp.folder("other")).await;
    scan(&rt, "codex").await;
    let b = entry(&rt, "Elsewhere").await;
    let chosen = ok(
        &rt,
        "providerHistory.associate",
        json!({ "historyId": b.id, "projectId": other }),
    )
    .await;
    assert_eq!(chosen["entry"]["projectId"], other.as_str());
    // The provider now reports another project's folder; the choice stays.
    codex.edit("native-b", |t| t.item.cwd = Some(temp.folder("project")));
    scan(&rt, "codex").await;
    assert_eq!(
        entry(&rt, "Elsewhere").await.project_id.as_deref(),
        Some(other.as_str())
    );
}

/// Makes `link` another path to `target`: a symlink, or on Windows a
/// directory junction, which needs no administrator rights.
fn link_folder(target: &str, link: &str) {
    #[cfg(unix)]
    std::os::unix::fs::symlink(target, link).unwrap();
    #[cfg(windows)]
    {
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", link, target])
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_folder_spelled_another_way_still_links() {
    let temp = Temp::new();
    let linked = temp.folder("linked");
    link_folder(&temp.folder("project"), &linked);
    // The provider reports the folder through the link; JAM stores the
    // project's folder as it resolves. They are the same folder.
    let codex = Scripted::new(
        "codex",
        10,
        vec![thread(
            "through-link",
            "Through a link",
            Some(&linked),
            &["l"],
        )],
    );
    let rt = open(&temp, &[&codex]);
    let project = add_project(&rt, &temp.folder("project")).await;
    scan(&rt, "codex").await;
    assert_eq!(
        entry(&rt, "Through a link").await.project_id.as_deref(),
        Some(project.as_str())
    );
}
