use crate::{
    error::JamError,
    protocol::{ContextItem, Presentation},
};
use serde::Deserialize;
use serde_json::Value;

pub fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, JamError> {
    fn has_null(value: &Value) -> bool {
        match value {
            Value::Null => true,
            Value::Array(a) => a.iter().any(has_null),
            Value::Object(o) => o.values().any(has_null),
            _ => false,
        }
    }
    if has_null(&value) {
        return Err(JamError::invalid(
            "Optional fields must be omitted, not null.",
        ));
    }
    serde_json::from_value(value)
        .map_err(|_| JamError::invalid("Command parameters have an invalid structure."))
}

pub fn validate_id(value: &str) -> Result<(), JamError> {
    if value.trim().is_empty() || value.encode_utf16().count() > 128 {
        return Err(JamError::invalid(
            "An identifier is empty, too long, or contains invalid characters.",
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetConversation {
    pub resource_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateConversation {
    pub project_id: String,
    pub presentation: Presentation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartTurn {
    pub resource_id: String,
    pub text: String,
    pub context: Vec<ContextItem>,
    pub request_id: String,
}

impl StartTurn {
    pub fn validate(&self) -> Result<(), JamError> {
        validate_id(&self.resource_id)?;
        validate_id(&self.request_id)?;
        if (self.text.trim().is_empty() && self.context.is_empty())
            || self.text.encode_utf16().count() > 20_000
            || self.context.len() > 16
        {
            return Err(JamError::invalid(
                "Send text or context, at most 20,000 characters and 16 context items.",
            ));
        }
        for item in &self.context {
            validate_id(&item.id)?;
            if item.label.trim().is_empty()
                || item.label.encode_utf16().count() > 512
                || item
                    .source
                    .uri
                    .as_ref()
                    .is_some_and(|s| s.trim().is_empty() || s.encode_utf16().count() > 4096)
                || item
                    .source
                    .selection
                    .as_ref()
                    .is_some_and(|s| s.trim().is_empty() || s.encode_utf16().count() > 20_000)
            {
                return Err(JamError::invalid("A context label or source is too large."));
            }
            if let Some(id) = &item.asset_id {
                validate_id(id)?;
            }
            if let Some(id) = &item.source.resource_id {
                validate_id(id)?;
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InterruptTurn {
    pub session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchQuery {
    pub query: String,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub pinned: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListDirectory {
    pub project_id: String,
    pub path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadFile {
    pub project_id: String,
    pub path: String,
}

/// Opens (or re-finds) a non-conversation resource. Reopening the same target
/// must return the same resource identity so its state is not duplicated.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenResource {
    pub project_id: String,
    pub kind: String,
    pub path: Option<String>,
}

impl OpenResource {
    pub const KINDS: [&'static str; 5] = ["file", "file-browser", "terminal", "browser", "diff"];

    pub fn validate(&self) -> Result<(), JamError> {
        validate_id(&self.project_id)?;
        if !Self::KINDS.contains(&self.kind.as_str()) {
            return Err(JamError::invalid("That resource kind cannot be opened."));
        }
        match (&self.kind[..], self.path.as_deref()) {
            ("file", None) => Err(JamError::invalid("A file resource needs a path.")),
            ("file", Some(path)) => crate::files::validate_path(path),
            (_, Some(_)) => Err(JamError::invalid("Only file resources accept a path.")),
            _ => Ok(()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WriteFile {
    pub project_id: String,
    pub path: String,
    pub text: String,
}

impl WriteFile {
    /// A save is bounded like any other request payload.
    pub const MAX_UTF16: usize = 2_000_000;

    pub fn validate(&self) -> Result<(), JamError> {
        validate_id(&self.project_id)?;
        crate::files::validate_path(&self.path)?;
        if self.path.is_empty() || self.text.encode_utf16().count() > Self::MAX_UTF16 {
            return Err(JamError::invalid("That file is too large to save."));
        }
        Ok(())
    }
}

/// Presets, tones and limits shared with the client through one fixture.
#[derive(Deserialize)]
struct IconLimits {
    #[serde(rename = "imageUtf16")]
    image: usize,
    #[serde(rename = "emojiUtf16")]
    emoji: usize,
    #[serde(rename = "nameUtf16")]
    name: usize,
    paths: usize,
    #[serde(rename = "pathUtf16")]
    path: usize,
}

#[derive(Deserialize)]
struct ProjectIcons {
    presets: Vec<String>,
    tones: Vec<String>,
    limits: IconLimits,
}

fn project_icons() -> &'static ProjectIcons {
    static ICONS: std::sync::OnceLock<ProjectIcons> = std::sync::OnceLock::new();
    ICONS.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../packages/protocol/fixtures/project-icons.json"
        ))
        .expect("the project icon fixture is valid")
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateProject {
    pub project_id: String,
    pub name: Option<String>,
    pub paths: Option<Vec<String>>,
    pub icon: Option<crate::protocol::ProjectIcon>,
    pub pinned: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetThreadClosed {
    pub resource_id: String,
    pub closed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeepThreadOpen {
    pub resource_id: String,
}

fn utf16(value: &str) -> usize {
    value.encode_utf16().count()
}

/// Absolute on macOS/Linux (`/`, `~/`) or Windows (`C:\`, `\\server`).
fn is_absolute_folder(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/')
        || path.starts_with("~/")
        || path.starts_with("\\\\")
        || (bytes.len() > 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/'))
}

impl UpdateProject {
    pub fn validate(&self) -> Result<(), JamError> {
        validate_id(&self.project_id)?;
        let icons = project_icons();
        if let Some(name) = &self.name
            && (name.trim().is_empty() || utf16(name) > icons.limits.name)
        {
            return Err(JamError::invalid(
                "A project name must be 1 to 80 characters.",
            ));
        }
        if let Some(paths) = &self.paths {
            if paths.len() > icons.limits.paths {
                return Err(JamError::invalid("A project can list at most 16 folders."));
            }
            for path in paths {
                if utf16(path) > icons.limits.path || !is_absolute_folder(path.trim()) {
                    return Err(JamError::invalid(
                        "A project path must be an absolute folder path.",
                    ));
                }
            }
        }
        if let Some(icon) = &self.icon {
            if let Some(tone) = &icon.tone
                && !icons.tones.contains(tone)
            {
                return Err(JamError::invalid("Unknown project icon tone."));
            }
            let valid = match (icon.kind.as_str(), icon.value.as_deref()) {
                ("initials", None) => true,
                ("preset", Some(value)) => icons.presets.iter().any(|p| p == value),
                ("emoji", Some(value)) => {
                    !value.is_empty()
                        && utf16(value) <= icons.limits.emoji
                        && !value
                            .chars()
                            .any(|c| c == '<' || c == '>' || c.is_whitespace())
                }
                ("image", Some(value)) => {
                    value.starts_with("data:image/") && utf16(value) <= icons.limits.image
                }
                _ => false,
            };
            if !valid {
                return Err(JamError::invalid("That project icon is not valid."));
            }
        }
        Ok(())
    }
}

/// First letters of the first two words, else the first two letters.
pub fn initials_of(name: &str) -> String {
    let words: Vec<&str> = name
        .split(|c: char| c.is_whitespace() || matches!(c, '.' | '_' | '-'))
        .filter(|w| !w.is_empty())
        .collect();
    let letters: String = match words.as_slice() {
        [first, second, ..] => first
            .chars()
            .take(1)
            .chain(second.chars().take(1))
            .collect(),
        [only] => only.chars().take(2).collect(),
        [] => String::new(),
    };
    if letters.is_empty() {
        "··".into()
    } else {
        letters.to_uppercase()
    }
}
