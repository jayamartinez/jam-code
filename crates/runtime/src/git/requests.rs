use super::DiffSide;
use crate::{JamError, commands::parse, runtime::Runtime};
use serde::Deserialize;
use serde_json::Value;
/// Every Git request addresses a project and, optionally, one of its JAM
/// worktrees by ID. Clients never supply a folder.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectTarget {
    project_id: String,
    worktree_id: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiffTarget {
    project_id: String,
    worktree_id: Option<String>,
    path: String,
    side: DiffSide,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StageTarget {
    project_id: String,
    worktree_id: Option<String>,
    path: String,
    staged: bool,
}
impl Runtime {
    pub(crate) fn git_request(&self, method: &str, params: Value) -> Result<Value, JamError> {
        match method {
            "git.status" => {
                let input: ProjectTarget = parse(params)?;
                let project = self.project(&input.project_id)?;
                let target = self.git_target(&project, input.worktree_id.as_deref())?;
                Ok(serde_json::to_value(self.git.status_at(&target)?)?)
            }
            "git.branches" => {
                let input: ProjectTarget = parse(params)?;
                let project = self.project(&input.project_id)?;
                let target = self.git_target(&project, input.worktree_id.as_deref())?;
                Ok(serde_json::to_value(self.git.branches(&target)?)?)
            }
            "git.diff" => {
                let input: DiffTarget = parse(params)?;
                let project = self.project(&input.project_id)?;
                let target = self.git_target(&project, input.worktree_id.as_deref())?;
                Ok(serde_json::to_value(self.git.diff_at(
                    &target,
                    &input.path,
                    input.side,
                )?)?)
            }
            "git.setStaged" => {
                let input: StageTarget = parse(params)?;
                let project = self.project(&input.project_id)?;
                let target = self.git_target(&project, input.worktree_id.as_deref())?;
                Ok(serde_json::to_value(self.git.set_staged_at(
                    &target,
                    &input.path,
                    input.staged,
                )?)?)
            }
            _ => Err(JamError::new("unknown_method", "Unknown Git request.")),
        }
    }
}
