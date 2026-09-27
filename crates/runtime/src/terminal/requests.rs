//! `terminal.*` request handling: validation, resource identity and the
//! working directory. Process ownership stays in the manager.
use super::{CwdSource, Spawn, TerminalSession, shell};
use crate::{
    commands::{parse, validate_id},
    error::JamError,
    protocol::{Project, Resource},
    runtime::{Runtime, new_id, now},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Input is bounded like any other request; a client splits larger pastes.
pub const MAX_INPUT_UTF16: usize = 65_536;
pub const MAX_COLS: u16 = 1000;
pub const MAX_ROWS: u16 = 500;
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateTerminal {
    project_id: String,
    /// An explicit absolute working directory instead of the project's.
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartTerminal {
    resource_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TerminalTarget {
    resource_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListTerminals {
    project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TerminalInput {
    resource_id: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResizeTerminal {
    resource_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AckTerminal {
    attachment_id: String,
    seq: u64,
}

fn validate_size(cols: u16, rows: u16) -> Result<(), JamError> {
    if !(2..=MAX_COLS).contains(&cols) || !(1..=MAX_ROWS).contains(&rows) {
        return Err(JamError::invalid(format!(
            "A terminal must be 2 to {MAX_COLS} columns and 1 to {MAX_ROWS} rows."
        )));
    }
    Ok(())
}

fn size(cols: Option<u16>, rows: Option<u16>) -> Result<(u16, u16), JamError> {
    let size = (cols.unwrap_or(DEFAULT_COLS), rows.unwrap_or(DEFAULT_ROWS));
    validate_size(size.0, size.1)?;
    Ok(size)
}

/// The project's first recorded folder that exists, else the home directory.
fn project_cwd(project: &Project) -> (PathBuf, CwdSource) {
    project
        .paths
        .iter()
        .map(|path| shell::expand_home(path.trim()))
        .find(|path| path.is_absolute() && path.is_dir())
        .map(|path| (path, CwdSource::Project))
        .or_else(|| shell::home().map(|home| (home, CwdSource::Home)))
        .unwrap_or_else(|| (PathBuf::from("/"), CwdSource::Home))
}

fn requested_cwd(path: &str) -> Result<PathBuf, JamError> {
    if path.encode_utf16().count() > 4096 {
        return Err(JamError::invalid("A working directory path is too long."));
    }
    let path = shell::expand_home(path.trim());
    if !path.is_absolute() || !Path::new(&path).is_dir() {
        return Err(JamError::invalid(
            "A terminal's working directory must be an existing absolute folder.",
        ));
    }
    Ok(path)
}

impl Runtime {
    fn project(&self, project_id: &str) -> Result<Project, JamError> {
        let state = self.lock()?;
        state
            .store
            .workspace(self.cursor(&state))?
            .projects
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| JamError::new("not_found", "Project not found."))
    }

    fn terminal_resource(&self, resource_id: &str) -> Result<Resource, JamError> {
        let resource = self.lock()?.store.resource(resource_id)?;
        if resource.kind != "terminal" {
            return Err(JamError::invalid("That resource is not a terminal."));
        }
        Ok(resource)
    }

    pub(crate) fn terminal_request(&self, method: &str, params: Value) -> Result<Value, JamError> {
        match method {
            "terminal.create" => {
                let input: CreateTerminal = parse(params)?;
                validate_id(&input.project_id)?;
                let (cols, rows) = size(input.cols, input.rows)?;
                let project = self.project(&input.project_id)?;
                let (cwd, cwd_source) = match input.cwd.as_deref() {
                    Some(path) => (requested_cwd(path)?, CwdSource::Requested),
                    None => project_cwd(&project),
                };
                let created_at = now();
                // Every terminal is a new resource: terminals are not keyed by
                // target the way files are, so several can run side by side.
                let resource_id = new_id("terminal");
                let terminal = self.terminals.start(Spawn {
                    resource_id: resource_id.clone(),
                    project_id: project.id.clone(),
                    cwd,
                    cwd_source,
                    cols,
                    rows,
                    created_at: created_at.clone(),
                    session_id: new_id("terminal-session"),
                })?;
                let resource = Resource {
                    id: resource_id.clone(),
                    kind: "terminal".into(),
                    title: terminal.title.clone(),
                    project_id: Some(project.id),
                    session_id: None,
                    path: None,
                    pinned: false,
                    updated_at: created_at,
                    closed_at: None,
                    close_suggestion_dismissed_at: None,
                };
                if let Err(error) = self
                    .lock()
                    .and_then(|state| state.store.save_resource(&resource))
                {
                    // Never leave a process behind a resource that was not recorded.
                    let _ = self.terminals.kill(&resource_id);
                    return Err(error);
                }
                Ok(json!({ "resource": resource, "terminal": terminal }))
            }
            "terminal.start" => {
                let input: StartTerminal = parse(params)?;
                validate_id(&input.resource_id)?;
                let (cols, rows) = size(input.cols, input.rows)?;
                let resource = self.terminal_resource(&input.resource_id)?;
                let project_id = resource
                    .project_id
                    .ok_or_else(|| JamError::invalid("This terminal has no project."))?;
                let project = self.project(&project_id)?;
                // A restart keeps a requested directory; otherwise the project's.
                let previous = self.terminals.get(&resource.id)?;
                let (cwd, cwd_source) = match previous {
                    Some(TerminalSession {
                        cwd,
                        cwd_source: CwdSource::Requested,
                        ..
                    }) if Path::new(&cwd).is_dir() => (PathBuf::from(cwd), CwdSource::Requested),
                    _ => project_cwd(&project),
                };
                let terminal = self.terminals.start(Spawn {
                    resource_id: resource.id,
                    project_id,
                    cwd,
                    cwd_source,
                    cols,
                    rows,
                    created_at: now(),
                    session_id: new_id("terminal-session"),
                })?;
                Ok(json!({ "terminal": terminal }))
            }
            "terminal.get" => {
                let input: TerminalTarget = parse(params)?;
                validate_id(&input.resource_id)?;
                self.terminal_resource(&input.resource_id)?;
                Ok(match self.terminals.get(&input.resource_id)? {
                    Some(terminal) => json!({ "terminal": terminal }),
                    None => json!({}),
                })
            }
            "terminal.list" => {
                let input: ListTerminals = parse(params)?;
                if let Some(id) = &input.project_id {
                    validate_id(id)?;
                }
                Ok(json!({ "terminals": self.terminals.list(input.project_id.as_deref())? }))
            }
            "terminal.input" => {
                let input: TerminalInput = parse(params)?;
                validate_id(&input.resource_id)?;
                let length = input.data.encode_utf16().count();
                if length == 0 || length > MAX_INPUT_UTF16 {
                    return Err(JamError::invalid(format!(
                        "Terminal input must be 1 to {MAX_INPUT_UTF16} characters."
                    )));
                }
                self.terminals.input(&input.resource_id, &input.data)?;
                Ok(json!({ "accepted": true }))
            }
            "terminal.resize" => {
                let input: ResizeTerminal = parse(params)?;
                validate_id(&input.resource_id)?;
                validate_size(input.cols, input.rows)?;
                let terminal = self
                    .terminals
                    .resize(&input.resource_id, input.cols, input.rows)?;
                Ok(json!({ "terminal": terminal }))
            }
            "terminal.kill" => {
                let input: TerminalTarget = parse(params)?;
                validate_id(&input.resource_id)?;
                Ok(json!({ "terminal": self.terminals.kill(&input.resource_id)? }))
            }
            "terminal.ack" => {
                let input: AckTerminal = parse(params)?;
                validate_id(&input.attachment_id)?;
                self.terminals.ack(&input.attachment_id, input.seq)?;
                Ok(json!({ "accepted": true }))
            }
            _ => Err(JamError::new(
                "unknown_method",
                "Unknown JAM request method.",
            )),
        }
    }
}
