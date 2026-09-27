//! Project file service.
//!
//! The runtime owns file access, so a client only ever addresses a project ID
//! and a project-relative path; it never hands the runtime a local path to
//! read. This milestone serves an isolated demo tree instead of the real
//! filesystem — no directory on this computer is opened, listed or read, and
//! every result is flagged `demo`.
//!
//! Listings resolve one directory level per request, so the wire shape already
//! matches a lazily expanded tree over a large repository. Replacing the demo
//! table with a scoped real reader changes neither the protocol nor the client.
//!
//! The tree itself lives in `packages/protocol/fixtures/files.json` so the Rust
//! runtime and the browser development preview cannot drift apart.

use crate::{
    error::JamError,
    protocol::{DirectoryEntry, DirectoryListing, FileContents},
};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Debug, Deserialize)]
struct DemoFile {
    path: String,
    text: String,
    #[serde(default)]
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DemoTrees {
    projects: BTreeMap<String, Vec<DemoFile>>,
}

pub const MAX_PATH_UTF16: usize = 512;
const MAX_ENTRIES: usize = 500;
const MAX_FILE_BYTES: usize = 256 * 1024;

fn trees() -> &'static DemoTrees {
    static TREES: OnceLock<DemoTrees> = OnceLock::new();
    TREES.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/files.json"
        ))
        .expect("the demo file fixture is valid")
    })
}

/// Project-relative, normalized, and never able to escape its project.
pub fn validate_path(path: &str) -> Result<(), JamError> {
    if path.encode_utf16().count() > MAX_PATH_UTF16 {
        return Err(JamError::invalid("That path is too long."));
    }
    if path.starts_with('/') || path.starts_with('\\') || path.contains('\0') {
        return Err(JamError::invalid("Paths must be project-relative."));
    }
    if path.contains("//") {
        return Err(JamError::invalid("Paths must not contain empty segments."));
    }
    if path
        .split('/')
        .any(|segment| segment == ".." || segment == ".")
    {
        return Err(JamError::invalid(
            "Paths must not contain relative segments.",
        ));
    }
    Ok(())
}

fn files_of(project_id: &str) -> Result<&'static [DemoFile], JamError> {
    trees()
        .projects
        .get(project_id)
        .map(Vec::as_slice)
        .ok_or_else(|| {
            JamError::new(
                "not_found",
                "This project has no readable files in the demo workspace.",
            )
        })
}

/// One directory level. Callers expand children by listing them separately.
pub fn list(project_id: &str, path: &str) -> Result<DirectoryListing, JamError> {
    validate_path(path)?;
    let files = files_of(project_id)?;
    let prefix = if path.is_empty() {
        String::new()
    } else {
        format!("{path}/")
    };
    let mut directories: Vec<&str> = Vec::new();
    let mut entries: Vec<DirectoryEntry> = Vec::new();
    for file in files {
        let Some(rest) = file.path.strip_prefix(prefix.as_str()) else {
            continue;
        };
        match rest.split_once('/') {
            Some((directory, _)) => {
                if !directories.contains(&directory) {
                    directories.push(directory);
                }
            }
            None => entries.push(DirectoryEntry {
                name: rest.to_string(),
                path: file.path.clone(),
                kind: "file".into(),
                status: file.status.clone(),
                has_children: None,
            }),
        }
    }
    if directories.is_empty() && entries.is_empty() && !path.is_empty() {
        return Err(JamError::new(
            "not_found",
            "That folder is not in this project.",
        ));
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    let mut listing: Vec<DirectoryEntry> = directories
        .into_iter()
        .map(|name| DirectoryEntry {
            name: name.to_string(),
            path: format!("{prefix}{name}"),
            kind: "directory".into(),
            status: None,
            has_children: Some(true),
        })
        .collect();
    listing.sort_by(|left, right| left.name.cmp(&right.name));
    listing.extend(entries);
    let truncated = listing.len() > MAX_ENTRIES;
    listing.truncate(MAX_ENTRIES);
    Ok(DirectoryListing {
        project_id: project_id.to_string(),
        path: path.to_string(),
        entries: listing,
        truncated,
        demo: true,
    })
}

pub fn read(project_id: &str, path: &str) -> Result<FileContents, JamError> {
    validate_path(path)?;
    if path.is_empty() {
        return Err(JamError::invalid("A file path is required."));
    }
    let file = files_of(project_id)?
        .iter()
        .find(|file| file.path == path)
        .ok_or_else(|| JamError::new("not_found", "That file is not in this project."))?;
    let truncated = file.text.len() > MAX_FILE_BYTES;
    let text = if truncated {
        let mut end = MAX_FILE_BYTES;
        while !file.text.is_char_boundary(end) {
            end -= 1;
        }
        file.text[..end].to_string()
    } else {
        file.text.clone()
    };
    Ok(FileContents {
        project_id: project_id.to_string(),
        path: path.to_string(),
        language: language_for(path).to_string(),
        text,
        truncated,
        // The demo tree has no writable backing store; editing is not pretended.
        writable: false,
        status: file.status.clone(),
        demo: true,
    })
}

/// A language name for syntax highlighting, from the file name alone. Mirrored
/// by `previewLanguage` in `@jam/protocol`; `fixtures/languages.json` holds the
/// cases both must agree on.
pub fn language_for(path: &str) -> &'static str {
    let name = path.rsplit('/').next().unwrap_or(path);
    let lower = name.to_ascii_lowercase();
    // Names that decide the language on their own, before any extension.
    match lower.as_str() {
        "dockerfile" | "containerfile" => return "dockerfile",
        "cargo.lock" | "poetry.lock" => return "toml",
        ".zshrc" | ".zprofile" | ".zshenv" | ".bashrc" | ".bash_profile" | ".profile" => {
            return "shell";
        }
        ".editorconfig" | ".gitattributes" | ".gitconfig" | ".npmrc" => return "ini",
        _ => {}
    }
    if lower.starts_with("dockerfile.") {
        return "dockerfile";
    }
    if lower == ".env" || lower.starts_with(".env.") {
        return "dotenv";
    }
    if lower.starts_with('.') && lower.ends_with("ignore") {
        return "ignore";
    }
    match lower.rsplit_once('.').map(|(_, extension)| extension) {
        Some("ts" | "mts" | "cts") => "typescript",
        Some("tsx") => "tsx",
        Some("js" | "mjs" | "cjs") => "javascript",
        Some("jsx") => "jsx",
        Some("rs") => "rust",
        Some("py" | "pyi") => "python",
        Some("json") => "json",
        Some("css" | "scss") => "css",
        Some("html" | "htm") => "html",
        Some("md" | "mdx" | "markdown") => "markdown",
        Some("toml") => "toml",
        Some("sql") => "sql",
        Some("yml" | "yaml") => "yaml",
        Some("sh" | "bash" | "zsh") => "shell",
        Some("dockerfile") => "dockerfile",
        Some("ini" | "cfg" | "conf") => "ini",
        Some("xml" | "svg" | "plist") => "xml",
        _ => "text",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_one_directory_level() {
        let root = list("project-jam", "").expect("root listing");
        let names: Vec<&str> = root.entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "docs",
                "scripts",
                "src",
                "src-tauri",
                ".env.example",
                ".gitignore",
                "README.md",
                "package.json",
                "tsconfig.json"
            ]
        );
        // `src/session/registry.ts` is two levels down and must not appear yet.
        assert!(root.entries.iter().all(|e| e.name != "registry.ts"));
        assert!(root.entries[0].has_children.unwrap_or(false));
        let nested = list("project-jam", "src/session").expect("nested listing");
        assert_eq!(nested.entries.len(), 2);
        assert_eq!(nested.entries[0].path, "src/session/registry.test.ts");
        assert_eq!(nested.entries[0].status.as_deref(), Some("added"));
    }

    #[test]
    fn rejects_paths_that_leave_the_project() {
        for path in [
            "../secrets",
            "/etc/passwd",
            "src/../../etc",
            "src//a",
            "./x",
        ] {
            assert!(validate_path(path).is_err(), "{path} should be rejected");
        }
        assert!(validate_path("src/session/registry.ts").is_ok());
        assert!(validate_path("").is_ok());
    }

    #[test]
    fn reads_a_file_with_its_language_and_status() {
        let file = read("project-jam", "src/session/registry.ts").expect("file");
        assert_eq!(file.language, "typescript");
        assert_eq!(file.status.as_deref(), Some("added"));
        assert!(file.text.contains("export function attach"));
        assert!(!file.writable);
        assert!(file.demo);
        assert_eq!(language_for("src-tauri/Cargo.toml"), "toml");
        #[derive(serde::Deserialize)]
        struct Cases {
            cases: Vec<(String, String)>,
        }
        let shared: Cases = serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/languages.json"
        ))
        .unwrap();
        for (path, language) in shared.cases {
            assert_eq!(language_for(&path), language, "{path}");
        }
        assert_eq!(language_for("LICENSE"), "text");
        assert!(read("project-jam", "src/session").is_err());
        assert!(read("project-jam", "nope.ts").is_err());
    }

    #[test]
    fn unknown_projects_and_folders_fail_rather_than_return_nothing() {
        assert!(list("project-missing", "").is_err());
        assert!(list("project-jam", "src/nope").is_err());
        // A prefix that is not a real folder boundary must not match.
        assert!(list("project-jam", "src/sess").is_err());
    }
}
