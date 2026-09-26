use serde::Serialize;
use std::fmt;

/// Stable transport error; never contains provider credentials or transcript payloads.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct JamError {
    pub code: String,
    pub message: String,
}

impl JamError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message)
    }
}

impl fmt::Display for JamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for JamError {}

impl From<rusqlite::Error> for JamError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new(
            "internal",
            format!("Local database operation failed: {error}"),
        )
    }
}

impl From<serde_json::Error> for JamError {
    fn from(_: serde_json::Error) -> Self {
        Self::new(
            "invalid_request",
            "The request or stored record has an invalid structure.",
        )
    }
}
