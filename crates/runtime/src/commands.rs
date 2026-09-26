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
