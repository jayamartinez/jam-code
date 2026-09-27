use super::model::*;
use crate::JamError;

fn change(value: u8) -> Result<Change, JamError> {
    Ok(match value {
        b'.' => Change::None,
        b'M' => Change::Modified,
        b'A' => Change::Added,
        b'D' => Change::Deleted,
        b'R' => Change::Renamed,
        b'C' => Change::Copied,
        b'T' => Change::TypeChanged,
        b'U' => Change::Unmerged,
        _ => return Err(JamError::new("git_failed", "Unsupported Git status.")),
    })
}
/// Porcelain v2 -z keeps filenames literal, including tabs and newlines.
pub fn status(bytes: &[u8], status: &mut GitStatus) -> Result<(), JamError> {
    let text = std::str::from_utf8(bytes).map_err(|_| {
        JamError::new(
            "unavailable",
            "This repository contains a non-UTF-8 filename.",
        )
    })?;
    let mut records = text.split('\0').filter(|s| !s.is_empty());
    while let Some(record) = records.next() {
        if let Some(head) = record.strip_prefix("# branch.oid ") {
            status.unborn = head == "(initial)";
            if !status.unborn {
                status.head = Some(head.into());
            }
            continue;
        }
        if let Some(branch) = record.strip_prefix("# branch.head ") {
            status.detached = branch == "(detached)";
            if !status.detached {
                status.branch = Some(branch.into());
            }
            continue;
        }
        if record.starts_with('#') || record.starts_with('!') {
            continue;
        }
        let (path, previous_path, staged, working_tree, conflict, submodule) =
            if let Some(path) = record.strip_prefix("? ") {
                (path, None, Change::None, Change::Untracked, false, false)
            } else {
                let count = match record.as_bytes()[0] {
                    b'1' => 9,
                    b'2' => 10,
                    b'u' => 11,
                    _ => return Err(JamError::new("git_failed", "Unknown Git status record.")),
                };
                let fields: Vec<_> = record.splitn(count, ' ').collect();
                if fields.len() != count || fields[1].len() != 2 {
                    return Err(JamError::new("git_failed", "Malformed Git status."));
                }
                let previous = if count == 10 {
                    Some(
                        records
                            .next()
                            .ok_or_else(|| JamError::new("git_failed", "Missing rename source."))?
                            .to_string(),
                    )
                } else {
                    None
                };
                (
                    fields[count - 1],
                    previous,
                    change(fields[1].as_bytes()[0])?,
                    change(fields[1].as_bytes()[1])?,
                    count == 11,
                    fields[2].starts_with('S'),
                )
            };
        if status.files.len() == 2000 {
            status.truncated = true;
            continue;
        }
        status.files.push(FileStatus {
            path: path.into(),
            previous_path,
            file_path: None,
            staged,
            working_tree,
            untracked: working_tree == Change::Untracked,
            conflict,
            submodule: submodule || path.ends_with('/'),
        });
    }
    Ok(())
}
fn range(text: &str) -> Option<(u32, u32)> {
    let (start, count) = text
        .get(1..)?
        .split_once(',')
        .unwrap_or((text.get(1..)?, "1"));
    Some((start.parse().ok()?, count.parse().ok()?))
}
/// Only Git's own unified patch is parsed here; filenames come from porcelain.
pub fn patch(bytes: &[u8], diff: &mut FileDiff) {
    let Ok(text) = std::str::from_utf8(bytes) else {
        diff.binary = true;
        return;
    };
    let mut old = 0;
    let mut new = 0;
    for (index, line) in text.split_terminator('\n').enumerate() {
        if index >= 5000 {
            diff.truncated = true;
            break;
        }
        if line.starts_with("Binary files ") || line == "GIT binary patch" {
            diff.binary = true;
        }
        if line.starts_with("@@ ") {
            let fields: Vec<_> = line.splitn(4, ' ').collect();
            if let Some(((a, b), (c, d))) = fields
                .get(1)
                .and_then(|x| range(x))
                .zip(fields.get(2).and_then(|x| range(x)))
            {
                old = a;
                new = c;
                diff.hunks.push(DiffHunk {
                    header: line.into(),
                    old_start: a,
                    old_lines: b,
                    new_start: c,
                    new_lines: d,
                    lines: vec![],
                });
            }
        } else if let Some(hunk) = diff.hunks.last_mut() {
            let (kind, old_line, new_line) = match line.as_bytes().first() {
                Some(b'+') => {
                    diff.additions += 1;
                    let n = new;
                    new += 1;
                    ("addition", None, Some(n))
                }
                Some(b'-') => {
                    diff.deletions += 1;
                    let n = old;
                    old += 1;
                    ("deletion", Some(n), None)
                }
                Some(b' ') => {
                    let a = old;
                    let b = new;
                    old += 1;
                    new += 1;
                    ("context", Some(a), Some(b))
                }
                Some(b'\\') => ("notice", None, None),
                _ => continue,
            };
            hunk.lines.push(DiffLine {
                kind: kind.into(),
                text: line.get(1..).unwrap_or("").into(),
                old_line,
                new_line,
            });
        } else if diff.metadata.len() < 40 {
            diff.metadata.push(line.into());
        }
    }
}
