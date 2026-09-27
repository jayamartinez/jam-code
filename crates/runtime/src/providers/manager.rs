//! The runtime's registry of adapters, their saved settings and the result
//! of the last explicit check. Installation, authentication, enablement,
//! default choice and running sessions are kept apart; nothing here turns
//! one into another.
use super::ProviderAdapter;
use crate::{
    error::JamError,
    protocol::{ProviderDescriptor, Session, SessionStatus},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};

/// One provider's saved preferences. Absent fields mean "JAM's default".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// An explicit executable path. Absent means automatic detection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable: Option<String>,
    /// Defaults for new chats, keyed like `Session.options`.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub defaults: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSettings {
    /// The provider new chats start with, when it is enabled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
    #[serde(default)]
    pub providers: BTreeMap<String, ProviderConfig>,
}

pub(crate) const SETTINGS_KEY: &str = "providers";
/// The order providers are listed and chosen as a fallback default.
const ORDER: [&str; 3] = ["claude", "codex", "mock"];
const PROBE_DEADLINE: Duration = Duration::from_secs(30);

impl ProviderSettings {
    pub fn config(&self, id: &str) -> ProviderConfig {
        self.providers.get(id).cloned().unwrap_or_default()
    }

    /// Real providers are enabled unless the reader turns them off. The demo
    /// provider is off unless the reader turns it on.
    pub fn enabled(&self, id: &str) -> bool {
        self.config(id).enabled.unwrap_or(id != "mock")
    }
}

pub(crate) struct ProviderManager {
    adapters: Vec<Arc<dyn ProviderAdapter>>,
    checked: Mutex<HashMap<String, ProviderDescriptor>>,
    probing: tokio::sync::Mutex<()>,
}

impl ProviderManager {
    pub fn new(adapters: Vec<Arc<dyn ProviderAdapter>>) -> Self {
        Self {
            adapters,
            checked: Mutex::new(HashMap::new()),
            probing: tokio::sync::Mutex::new(()),
        }
    }

    pub fn adapter(&self, id: &str) -> Option<Arc<dyn ProviderAdapter>> {
        self.adapters.iter().find(|a| a.id() == id).cloned()
    }

    pub fn has_checked(&self) -> bool {
        self.checked.lock().map(|c| !c.is_empty()).unwrap_or(false)
    }

    /// The last checked descriptor for one provider, if any.
    pub fn checked(&self, id: &str) -> Option<ProviderDescriptor> {
        self.checked.lock().ok()?.get(id).cloned()
    }

    /// Asks every adapter again, concurrently and within a deadline. A
    /// provider that does not answer in time keeps its unknown state.
    pub async fn refresh(&self, settings: &ProviderSettings) {
        let _gate = self.probing.lock().await;
        let probes = self.adapters.iter().map(|adapter| {
            let adapter = Arc::clone(adapter);
            let config = settings.config(adapter.id());
            tokio::spawn(async move {
                let id = adapter.id();
                match tokio::time::timeout(PROBE_DEADLINE, adapter.probe(config.clone())).await {
                    Ok(descriptor) => descriptor,
                    Err(_) => {
                        let mut descriptor = adapter.unchecked(&config);
                        descriptor.status = Some(crate::protocol::ProviderStatus {
                            tone: "warning".into(),
                            message: format!("Checking {id} took longer than 30 seconds."),
                        });
                        descriptor
                    }
                }
            })
        });
        let mut results = Vec::new();
        for probe in probes.collect::<Vec<_>>() {
            if let Ok(descriptor) = probe.await {
                results.push(descriptor);
            }
        }
        if let Ok(mut checked) = self.checked.lock() {
            for mut descriptor in results {
                descriptor.checked_at = Some(crate::runtime::now());
                checked.insert(descriptor.id.clone(), descriptor);
            }
        }
    }

    /// Forgets one provider's last check, such as after its executable changed.
    pub fn forget(&self, id: &str) {
        if let Ok(mut checked) = self.checked.lock() {
            checked.remove(id);
        }
    }

    /// Descriptors as the client sees them: last check plus saved settings
    /// plus live session counts.
    pub fn describe(
        &self,
        settings: &ProviderSettings,
        sessions: &[Session],
    ) -> Vec<ProviderDescriptor> {
        let checked = self.checked.lock().map(|c| c.clone()).unwrap_or_default();
        let mut descriptors: Vec<ProviderDescriptor> = ORDER
            .iter()
            .filter_map(|id| self.adapter(id))
            .map(|adapter| {
                let id = adapter.id();
                let config = settings.config(id);
                let mut descriptor = checked
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| adapter.unchecked(&config));
                descriptor.enabled = settings.enabled(id);
                let running = sessions
                    .iter()
                    .filter(|s| s.provider_id == id && s.status == SessionStatus::Running)
                    .count() as u32;
                descriptor.running = running > 0;
                descriptor.running_count = Some(running);
                descriptor.executable_override = config.executable.clone();
                descriptor.defaults =
                    (!config.defaults.is_empty()).then(|| config.defaults.clone());
                descriptor
            })
            .collect();
        let default = settings
            .default
            .as_deref()
            .filter(|id| descriptors.iter().any(|d| d.id == *id && d.enabled))
            .map(str::to_owned)
            .or_else(|| {
                descriptors
                    .iter()
                    .find(|d| d.enabled && d.installation == "installed")
                    .or_else(|| descriptors.iter().find(|d| d.enabled))
                    .map(|d| d.id.clone())
            });
        for descriptor in &mut descriptors {
            descriptor.is_default = default.as_deref() == Some(descriptor.id.as_str());
        }
        descriptors
    }

    pub fn shutdown(&self) {
        for adapter in &self.adapters {
            adapter.shutdown();
        }
    }
}

/// Checks `options` against what the provider reported. Unknown keys are
/// rejected; values are checked when the provider's lists are known.
pub(crate) fn validate_options(
    descriptor: &ProviderDescriptor,
    options: &BTreeMap<String, String>,
) -> Result<(), JamError> {
    for (key, value) in options {
        if value.trim().is_empty() || value.len() > 256 {
            return Err(JamError::invalid(
                "A provider option value is empty or too long.",
            ));
        }
        match key.as_str() {
            "model" => {
                if let Some(models) = &descriptor.models
                    && !models.iter().any(|m| &m.id == value)
                {
                    return Err(JamError::invalid(format!(
                        "{} did not report the model {value:?}.",
                        descriptor.name
                    )));
                }
            }
            "effort" => {
                let model = options.get("model");
                if let Some(models) = &descriptor.models {
                    let chosen = model
                        .and_then(|id| models.iter().find(|m| &m.id == id))
                        .or_else(|| models.iter().find(|m| m.is_default));
                    if let Some(chosen) = chosen
                        && !chosen.efforts.iter().any(|e| e == value)
                    {
                        return Err(JamError::invalid(format!(
                            "{} does not offer {value:?} effort for {}.",
                            descriptor.name, chosen.label
                        )));
                    }
                }
            }
            _ => {
                let option = descriptor
                    .options
                    .as_ref()
                    .and_then(|options| options.iter().find(|o| &o.id == key))
                    .ok_or_else(|| {
                        JamError::invalid(format!(
                            "{} has no option named {key:?}.",
                            descriptor.name
                        ))
                    })?;
                if !option.values.iter().any(|v| &v.value == value) {
                    return Err(JamError::invalid(format!(
                        "{value:?} is not a value of {}.",
                        option.label
                    )));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::MockProvider;

    #[test]
    fn states_stay_independent() {
        let manager = ProviderManager::new(vec![Arc::new(MockProvider)]);
        let mut settings = ProviderSettings::default();
        let described = manager.describe(&settings, &[]);
        assert_eq!(described.len(), 1);
        assert!(!described[0].enabled, "the demo provider is off by default");
        assert!(!described[0].is_default);
        assert_eq!(described[0].installation, "builtin");
        settings.providers.insert(
            "mock".into(),
            ProviderConfig {
                enabled: Some(true),
                ..Default::default()
            },
        );
        let described = manager.describe(&settings, &[]);
        assert!(described[0].enabled && described[0].is_default);
        assert_eq!(described[0].running_count, Some(0));
    }
}
