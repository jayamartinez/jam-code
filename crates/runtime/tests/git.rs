use jam_runtime::{
    Runtime,
    git::{Change, DiffSide, GitManager},
    protocol::{Project, Request},
};
use serde_json::json;
use std::{fs, path::PathBuf, process::Command};
struct Repo {
    path: PathBuf,
    git: GitManager,
    project: Project,
}
impl Repo {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("jam-git-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        let project = Project {
            id: "project-jam".into(),
            name: "Fixture".into(),
            initials: "FX".into(),
            branch: "fake".into(),
            paths: vec![path.to_str().unwrap().into()],
            icon: None,
            pinned: false,
        };
        let repo = Self {
            path,
            project,
            git: GitManager::default(),
        };
        repo.cmd(&["init", "-b", "main"]);
        repo.cmd(&["config", "user.email", "test@example.invalid"]);
        repo.cmd(&["config", "user.name", "JAM Test"]);
        repo
    }
    fn cmd(&self, args: &[&str]) {
        let out = Command::new("git")
            .current_dir(&self.path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    fn write(&self, path: &str, text: &str) {
        fs::write(self.path.join(path), text).unwrap();
    }
    fn commit(&self) {
        self.cmd(&["add", "--all"]);
        self.cmd(&["-c", "core.hooksPath=", "commit", "-m", "fixture"]);
    }
}
impl Drop for Repo {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[test]
fn detection_unborn_untracked_stage_unstage_and_clean() {
    let repo = Repo::new();
    let status = repo.git.status(&repo.project).unwrap();
    assert_eq!(status.state, "repository");
    assert_eq!(status.branch.as_deref(), Some("main"));
    assert!(status.unborn);
    assert!(status.files.is_empty());
    let path = "space ü name.txt";
    repo.write(path, "one\ntwo\n");
    let status = repo.git.status(&repo.project).unwrap();
    assert!(status.files[0].untracked);
    let diff = repo
        .git
        .diff(&repo.project, path, DiffSide::Unstaged)
        .unwrap();
    assert_eq!(diff.additions, 2);
    assert_eq!(diff.hunks[0].lines[1].new_line, Some(2));
    let status = repo.git.set_staged(&repo.project, path, true).unwrap();
    assert_eq!(status.files[0].staged, Change::Added);
    let diff = repo
        .git
        .diff(&repo.project, path, DiffSide::Staged)
        .unwrap();
    assert_eq!(diff.additions, 2);
    repo.git.set_staged(&repo.project, path, false).unwrap();
    assert!(repo.path.join(path).exists());
    assert!(repo.git.status(&repo.project).unwrap().files[0].untracked);
    repo.commit();
    assert!(repo.git.status(&repo.project).unwrap().files.is_empty());
    repo.cmd(&["checkout", "--detach"]);
    let status = repo.git.status(&repo.project).unwrap();
    assert!(status.detached);
    assert!(status.branch.is_none());
    assert!(status.head.is_some());
    let mut project = repo.project.clone();
    project.paths.clear();
    assert_eq!(repo.git.status(&project).unwrap().state, "no-folder");
    let nonrepo = repo.path.join("outside");
    fs::create_dir(&nonrepo).unwrap();
    let outside = std::env::temp_dir().join(format!("jam-no-git-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&outside).unwrap();
    project.paths = vec![outside.to_str().unwrap().into()];
    assert_eq!(repo.git.status(&project).unwrap().state, "not-repository");
    fs::remove_dir(outside).unwrap();
}
#[test]
fn multiple_hunks_and_both_index_and_working_tree() {
    let repo = Repo::new();
    let before = (1..=40).map(|i| format!("line {i}\n")).collect::<String>();
    repo.write("test.txt", &before);
    repo.commit();
    let staged = before
        .replace("line 2\n", "new 2\n")
        .replace("line 38\n", "new 38\n");
    repo.write("test.txt", &staged);
    let diff = repo
        .git
        .diff(&repo.project, "test.txt", DiffSide::Unstaged)
        .unwrap();
    assert_eq!(diff.hunks.len(), 2);
    assert_eq!((diff.additions, diff.deletions), (2, 2));
    assert_eq!(diff.hunks[0].lines[0].old_line, Some(1));
    repo.git
        .set_staged(&repo.project, "test.txt", true)
        .unwrap();
    repo.write("test.txt", &staged.replace("line 20\n", "new 20\n"));
    let status = repo.git.status(&repo.project).unwrap();
    assert_eq!(status.files[0].staged, Change::Modified);
    assert_eq!(status.files[0].working_tree, Change::Modified);
    assert_eq!(
        repo.git
            .diff(&repo.project, "test.txt", DiffSide::Staged)
            .unwrap()
            .additions,
        2
    );
    assert_eq!(
        repo.git
            .diff(&repo.project, "test.txt", DiffSide::Unstaged)
            .unwrap()
            .additions,
        1
    );
    repo.git
        .set_staged(&repo.project, "test.txt", false)
        .unwrap();
    assert_eq!(
        repo.git
            .diff(&repo.project, "test.txt", DiffSide::Unstaged)
            .unwrap()
            .additions,
        3
    );
}
#[test]
fn rename_deletion_binary_and_literal_hostile_paths() {
    let repo = Repo::new();
    repo.write("old name.txt", "hello\n");
    repo.write("delete.txt", "gone\n");
    repo.commit();
    repo.cmd(&["mv", "old name.txt", "new ü name.txt"]);
    let status = repo.git.status(&repo.project).unwrap();
    assert_eq!(
        status.files[0].previous_path.as_deref(),
        Some("old name.txt")
    );
    let diff = repo
        .git
        .diff(&repo.project, "new ü name.txt", DiffSide::Staged)
        .unwrap();
    assert!(diff.metadata.iter().any(|s| s.starts_with("rename from")));
    repo.git
        .set_staged(&repo.project, "new ü name.txt", false)
        .unwrap();
    assert!(repo.path.join("new ü name.txt").exists());
    fs::remove_file(repo.path.join("delete.txt")).unwrap();
    repo.git
        .set_staged(&repo.project, "delete.txt", true)
        .unwrap();
    assert_eq!(
        repo.git
            .diff(&repo.project, "delete.txt", DiffSide::Staged)
            .unwrap()
            .deletions,
        1
    );
    // NTFS cannot store `:`, `*`, tabs or newlines in a file name.
    let hostile: &[&str] = if cfg!(windows) {
        &["--help", "$(touch nope).txt"]
    } else {
        &["--help", ":(glob)*", "tab\tline\nfile", "$(touch nope).txt"]
    };
    for &path in hostile {
        repo.write(path, "safe\n");
        repo.git.set_staged(&repo.project, path, true).unwrap();
        assert_eq!(
            repo.git
                .diff(&repo.project, path, DiffSide::Staged)
                .unwrap()
                .additions,
            1
        );
    }
    assert!(!repo.path.join("nope").exists());
    fs::write(repo.path.join("binary"), [0, 1, 2]).unwrap();
    assert!(
        repo.git
            .diff(&repo.project, "binary", DiffSide::Unstaged)
            .unwrap()
            .binary
    );
    repo.git.set_staged(&repo.project, "binary", true).unwrap();
    assert!(
        repo.git
            .diff(&repo.project, "binary", DiffSide::Staged)
            .unwrap()
            .binary
    );
    for path in [
        "../escape",
        "/etc/passwd",
        "",
        ".git/config",
        "C:/outside",
        "a\\..\\b",
    ] {
        assert!(repo.git.set_staged(&repo.project, path, true).is_err());
    }
}
#[test]
fn conflict_and_large_diff_are_explicit() {
    let repo = Repo::new();
    repo.write("file", "base\n");
    repo.commit();
    repo.cmd(&["checkout", "-b", "other"]);
    repo.write("file", "other\n");
    repo.commit();
    repo.cmd(&["checkout", "main"]);
    repo.write("file", "main\n");
    repo.commit();
    let result = Command::new("git")
        .current_dir(&repo.path)
        .args(["merge", "other"])
        .output()
        .unwrap();
    assert!(!result.status.success());
    let status = repo.git.status(&repo.project).unwrap();
    assert!(status.files[0].conflict);
    assert!(repo.git.set_staged(&repo.project, "file", true).is_err());
    assert!(
        repo.git
            .diff(&repo.project, "file", DiffSide::Unstaged)
            .unwrap()
            .metadata[0]
            .contains("conflict")
    );
    repo.write("large", &"line\n".repeat(6000));
    let diff = repo
        .git
        .diff(&repo.project, "large", DiffSide::Unstaged)
        .unwrap();
    assert!(diff.truncated);
    assert_eq!(diff.additions, 5000);
}
#[test]
fn runtime_contract_and_file_resource_remain_distinct() {
    let repo = Repo::new();
    repo.write("hello.txt", "hello\n");
    let runtime = Runtime::open_demo(repo.path.join("runtime.sqlite")).unwrap();
    let request = |method: &str, params| {
        runtime.request(Request {
            protocol_version: 1,
            method: method.into(),
            params,
        })
    };
    request(
        "project.update",
        json!({"projectId":"project-jam","paths":repo.project.paths}),
    )
    .unwrap();
    let status = request("git.status", json!({"projectId":"project-jam"})).unwrap();
    assert_eq!(status["branch"], "main");
    let file = request(
        "resource.open",
        json!({"projectId":"project-jam","kind":"file","path":"hello.txt"}),
    )
    .unwrap();
    let review = request(
        "resource.open",
        json!({"projectId":"project-jam","kind":"diff"}),
    )
    .unwrap();
    assert_ne!(file["resource"]["id"], review["resource"]["id"]);
    let contents = request(
        "file.read",
        json!({"projectId":"project-jam","path":"hello.txt"}),
    )
    .unwrap();
    assert_eq!(contents["text"], "hello\n");
    assert_eq!(contents["demo"], false);
    assert_eq!(contents["writable"], false);
    assert!(
        request(
            "file.write",
            json!({"projectId":"project-jam","path":"hello.txt","text":"oops"})
        )
        .is_err()
    );
    assert!(
        request(
            "git.setStaged",
            json!({"projectId":"project-jam","path":"../bad","staged":true})
        )
        .is_err()
    );
    assert!(request("git.status", json!({"projectId":"missing"})).is_err());
}
#[cfg(unix)]
#[test]
fn symlink_preview_does_not_read_its_target() {
    let repo = Repo::new();
    std::os::unix::fs::symlink("/etc/passwd", repo.path.join("link")).unwrap();
    let diff = repo
        .git
        .diff(&repo.project, "link", DiffSide::Unstaged)
        .unwrap();
    assert!(diff.hunks.is_empty());
    let runtime = Runtime::open_demo(repo.path.join("runtime.sqlite")).unwrap();
    runtime
        .request(Request {
            protocol_version: 1,
            method: "project.update".into(),
            params: json!({"projectId":"project-jam","paths":repo.project.paths}),
        })
        .unwrap();
    assert!(
        runtime
            .request(Request {
                protocol_version: 1,
                method: "file.read".into(),
                params: json!({"projectId":"project-jam","path":"link"})
            })
            .is_err()
    );
}

#[test]
fn structured_diff_matches_shared_wire_fixture() {
    let value: serde_json::Value =
        serde_json::from_str(include_str!("../../../packages/protocol/fixtures/git.json")).unwrap();
    let diff: jam_runtime::git::FileDiff = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(diff).unwrap(), value);
}

#[test]
fn nested_project_file_scope_and_status_cap() {
    let mut repo = Repo::new();
    fs::create_dir(repo.path.join("sub")).unwrap();
    repo.write("outside.txt", "outside\n");
    repo.write("sub/inside.txt", "inside\n");
    repo.project.paths = vec![repo.path.join("sub").to_str().unwrap().into()];
    let status = repo.git.status(&repo.project).unwrap();
    assert!(
        status
            .files
            .iter()
            .find(|f| f.path == "outside.txt")
            .unwrap()
            .file_path
            .is_none()
    );
    assert_eq!(
        status
            .files
            .iter()
            .find(|f| f.path == "sub/inside.txt")
            .unwrap()
            .file_path
            .as_deref(),
        Some("inside.txt")
    );
    for i in 0..2005 {
        repo.write(&format!("sub/file-{i}"), "");
    }
    let status = repo.git.status(&repo.project).unwrap();
    assert!(status.truncated);
    assert_eq!(status.files.len(), 2000);
}

#[test]
fn renamed_diff_does_not_include_a_recreated_source_file() {
    let repo = Repo::new();
    repo.write("old.txt", &"original\n".repeat(20));
    repo.commit();
    repo.cmd(&["mv", "old.txt", "new.txt"]);
    repo.write("old.txt", "unrelated new source\n");
    let diff = repo
        .git
        .diff(&repo.project, "new.txt", DiffSide::Staged)
        .unwrap();
    assert_eq!((diff.additions, diff.deletions), (0, 0));
    repo.write("old.txt", "do not stage this\n");
    repo.write("new.txt", &format!("{}extra\n", "original\n".repeat(20)));
    repo.git.set_staged(&repo.project, "new.txt", true).unwrap();
    assert!(
        repo.git
            .status(&repo.project)
            .unwrap()
            .files
            .iter()
            .find(|f| f.path == "old.txt")
            .unwrap()
            .untracked
    );
    let old = repo
        .git
        .diff(&repo.project, "old.txt", DiffSide::Unstaged)
        .unwrap();
    assert_eq!(old.additions, 1);
    assert_eq!(
        repo.git
            .diff(&repo.project, "new.txt", DiffSide::Staged)
            .unwrap()
            .additions,
        1
    );
}

#[test]
#[ignore = "manual performance observation over a temporary large repository"]
fn observe_large_repository_costs() {
    let repo = Repo::new();
    for i in 0..10000 {
        repo.write(&format!("file-{i}.txt"), "before\n");
    }
    repo.commit();
    for i in 0..100 {
        repo.write(&format!("file-{i}.txt"), "after\n");
    }
    let mut status_ms = vec![];
    let mut diff_ms = vec![];
    for _ in 0..5 {
        let start = std::time::Instant::now();
        assert_eq!(repo.git.status(&repo.project).unwrap().files.len(), 100);
        status_ms.push(start.elapsed().as_millis());
        let start = std::time::Instant::now();
        assert_eq!(
            repo.git
                .diff(&repo.project, "file-0.txt", DiffSide::Unstaged)
                .unwrap()
                .additions,
            1
        );
        diff_ms.push(start.elapsed().as_millis());
    }
    status_ms.sort();
    diff_ms.sort();
    eprintln!(
        "10,000 tracked / 100 modified, debug build, five warm samples: status median {} ms, selected diff median {} ms (includes status reread)",
        status_ms[2], diff_ms[2]
    );
}

#[test]
fn tracked_patch_is_bounded_and_preserves_no_newline_notices() {
    let repo = Repo::new();
    repo.write("file", "before");
    repo.commit();
    repo.write("file", "after");
    let diff = repo
        .git
        .diff(&repo.project, "file", DiffSide::Unstaged)
        .unwrap();
    assert_eq!((diff.additions, diff.deletions), (1, 1));
    assert_eq!(
        diff.hunks[0]
            .lines
            .iter()
            .filter(|l| l.kind == "notice")
            .count(),
        2
    );
    repo.write("file", &"a".repeat(1024 * 1024));
    let diff = repo
        .git
        .diff(&repo.project, "file", DiffSide::Unstaged)
        .unwrap();
    assert!(diff.truncated);
    assert!(
        diff.hunks
            .iter()
            .flat_map(|h| &h.lines)
            .map(|l| l.text.len())
            .sum::<usize>()
            < 512 * 1024
    );
}

#[test]
fn untracked_utf8_at_capture_boundary_stays_a_text_preview() {
    let repo = Repo::new();
    repo.write("unicode", &"世".repeat(200_000));
    let diff = repo
        .git
        .diff(&repo.project, "unicode", DiffSide::Unstaged)
        .unwrap();
    assert!(diff.truncated);
    assert!(!diff.binary);
    assert_eq!(diff.additions, 1);
}
