use super::DiffSide;
use crate::{JamError, commands::parse, runtime::Runtime};
use serde::Deserialize;
use serde_json::Value;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectTarget {
    project_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiffTarget {
    project_id: String,
    path: String,
    side: DiffSide,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StageTarget {
    project_id: String,
    path: String,
    staged: bool,
}
impl Runtime {
    pub(crate) fn git_request(&self, method: &str, params: Value) -> Result<Value, JamError> {
        match method {
            "git.status" => {
                let input: ProjectTarget = parse(params)?;
                Ok(serde_json::to_value(
                    self.git.status(&self.project(&input.project_id)?)?,
                )?)
            }
            "git.diff" => {
                let input: DiffTarget = parse(params)?;
                Ok(serde_json::to_value(self.git.diff(
                    &self.project(&input.project_id)?,
                    &input.path,
                    input.side,
                )?)?)
            }
            "git.setStaged" => {
                let input: StageTarget = parse(params)?;
                Ok(serde_json::to_value(self.git.set_staged(
                    &self.project(&input.project_id)?,
                    &input.path,
                    input.staged,
                )?)?)
            }
            _ => Err(JamError::new("unknown_method", "Unknown Git request.")),
        }
    }
}
