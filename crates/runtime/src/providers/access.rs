//! The access choice every agent offers in some form: ask before acting,
//! accept file edits, or run without asking. JAM presents the same three
//! choices for every provider; each adapter maps them onto its provider's
//! own permission settings and describes exactly what that means there.
use crate::protocol::{OptionValue, ProviderOption};

pub(crate) const OPTION: &str = "access";
pub(crate) const ASK: &str = "ask";
pub(crate) const EDITS: &str = "edits";
pub(crate) const FULL: &str = "full";

/// The access option with provider-specific descriptions of each choice.
pub(crate) fn option(ask: &str, edits: &str, full: &str) -> ProviderOption {
    let value = |value: &str, label: &str, description: &str| OptionValue {
        value: value.into(),
        label: label.into(),
        description: Some(description.into()),
    };
    ProviderOption {
        id: OPTION.into(),
        label: "Access".into(),
        description: Some("What the agent may do without asking you.".into()),
        values: vec![
            value(ASK, "Ask for approval", ask),
            value(EDITS, "Auto-accept edits", edits),
            value(FULL, "Full access", full),
        ],
        default: ASK.into(),
    }
}

/// The chosen access level, defaulting to asking.
pub(crate) fn chosen(options: &std::collections::BTreeMap<String, String>) -> &str {
    match options.get(OPTION).map(String::as_str) {
        Some(EDITS) => EDITS,
        Some(FULL) => FULL,
        _ => ASK,
    }
}
