//! Provider settings, checks and interaction answers.
use crate::{
    commands::{
        ConfigureProvider, ListProviders, RespondInteraction, model_ids, parse, validate_id,
        validate_options, validate_provider,
    },
    error::JamError,
    protocol::{Presentation, ProviderDescriptor},
    providers::{Answer, ProviderSettings},
    runtime::{Runtime, State, now},
};
use serde_json::{Value, json};
use std::{collections::BTreeMap, future::Future, sync::Arc};

/// Runs provider I/O from a synchronous request. The request already runs
/// off the async workers (the host uses a blocking thread), and a scoped
/// thread keeps this safe even when a caller is inside an async context.
pub(crate) fn block_on<F: Future + Send>(future: F) -> Option<F::Output>
where
    F::Output: Send,
{
    let handle = tokio::runtime::Handle::try_current().ok()?;
    std::thread::scope(|scope| scope.spawn(move || handle.block_on(future)).join().ok())
}

impl Runtime {
    pub(crate) fn provider_settings(&self, state: &State) -> Result<ProviderSettings, JamError> {
        Ok(state
            .store
            .setting(crate::providers::SETTINGS_KEY)?
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default())
    }

    fn save_provider_settings(
        &self,
        state: &State,
        settings: &ProviderSettings,
    ) -> Result<(), JamError> {
        state.store.save_setting(
            crate::providers::SETTINGS_KEY,
            &serde_json::to_string(settings)?,
            &now(),
        )
    }

    fn describe_providers(&self) -> Result<Vec<ProviderDescriptor>, JamError> {
        let state = self.lock()?;
        let settings = self.provider_settings(&state)?;
        let sessions = state.store.sessions()?;
        Ok(self.providers.describe(&settings, &sessions))
    }

    /// Checks every provider once per run unless asked again. The database
    /// lock is never held while a provider is asked.
    pub(crate) fn check_providers(&self, force: bool) -> Result<(), JamError> {
        if !force && self.providers.has_checked() {
            return Ok(());
        }
        let settings = {
            let state = self.lock()?;
            self.provider_settings(&state)?
        };
        block_on(self.providers.refresh(&settings));
        Ok(())
    }

    /// The descriptor for one provider, checking providers first if needed.
    pub(crate) fn provider_descriptor(&self, id: &str) -> Result<ProviderDescriptor, JamError> {
        self.check_providers(false)?;
        self.describe_providers()?
            .into_iter()
            .find(|d| d.id == id)
            .ok_or_else(|| JamError::invalid("Unknown provider."))
    }

    /// Provider, presentation, model label and options for a new session.
    pub(crate) fn session_choice(
        &self,
        state: &State,
        provider_id: Option<&str>,
        presentation: Presentation,
        mut options: BTreeMap<String, String>,
    ) -> Result<(String, Presentation, String, BTreeMap<String, String>), JamError> {
        validate_options(&options)?;
        let Some(provider_id) = provider_id else {
            // The original demo contract: no provider named means the mock.
            if !options.is_empty() {
                return Err(JamError::invalid("The demo provider has no options."));
            }
            return Ok(("mock".into(), presentation, "Demo model".into(), options));
        };
        validate_provider(provider_id)?;
        let settings = self.provider_settings(state)?;
        if !settings.enabled(provider_id) {
            return Err(JamError::new(
                "provider_disabled",
                "That provider is turned off in Settings → Providers.",
            ));
        }
        let presentation = match provider_id {
            "claude" => Presentation::Claude,
            "codex" => Presentation::Codex,
            _ => presentation,
        };
        if provider_id == "mock" {
            return Ok((
                "mock".into(),
                presentation,
                "Demo model".into(),
                BTreeMap::new(),
            ));
        }
        let descriptor = self.providers.checked(provider_id);
        if let Some(descriptor) = &descriptor {
            if descriptor.installation == "missing" {
                return Err(JamError::new(
                    "provider_unavailable",
                    format!("{} is not installed on this computer.", descriptor.name),
                ));
            }
            // What the new chat asked for must be something the provider offers.
            crate::providers::validate_option(descriptor, &options)?;
        }
        // Saved defaults fill whatever the new chat did not choose. One the
        // provider no longer offers is dropped rather than failing every chat.
        for (key, value) in settings.config(provider_id).defaults {
            if options.contains_key(&key) {
                continue;
            }
            let mut view = options_view(&key, &value);
            if let Some(model) = options.get("model") {
                view.insert("model".into(), model.clone());
            }
            if descriptor
                .as_ref()
                .is_none_or(|d| crate::providers::validate_option(d, &view).is_ok())
            {
                options.insert(key, value);
            }
        }
        let model = model_label(descriptor.as_ref(), &options);
        Ok((provider_id.to_string(), presentation, model, options))
    }

    pub(crate) fn provider_request(
        self: &Arc<Self>,
        method: &str,
        params: Value,
    ) -> Result<Value, JamError> {
        match method {
            "provider.list" => {
                let input: ListProviders = parse(params)?;
                self.check_providers(input.refresh)?;
                Ok(json!({ "providers": self.describe_providers()? }))
            }
            "provider.configure" => {
                let input: ConfigureProvider = parse(params)?;
                validate_provider(&input.provider_id)?;
                let id = input.provider_id.as_str();
                let executable_changed = {
                    let state = self.lock()?;
                    let mut settings = self.provider_settings(&state)?;
                    let mut config = settings.config(id);
                    if let Some(enabled) = input.enabled {
                        config.enabled = Some(enabled);
                    }
                    if let Some(is_default) = input.is_default {
                        if is_default {
                            settings.default = Some(id.to_string());
                        } else if settings.default.as_deref() == Some(id) {
                            settings.default = None;
                        }
                    }
                    let previous = config.executable.clone();
                    if let Some(executable) = input.executable {
                        let executable = executable.trim().to_string();
                        if executable.is_empty() {
                            config.executable = None;
                        } else {
                            if executable.encode_utf16().count() > 4096
                                || !(executable.starts_with('/')
                                    || executable.starts_with("~/")
                                    || std::path::Path::new(&executable).is_absolute())
                            {
                                return Err(JamError::invalid(
                                    "An executable must be an absolute path.",
                                ));
                            }
                            config.executable = Some(executable);
                        }
                    }
                    if let Some(defaults) = input.defaults {
                        validate_options(&defaults)?;
                        if id == "mock" && !defaults.is_empty() {
                            return Err(JamError::invalid("The demo provider has no options."));
                        }
                        if let Some(descriptor) = self.providers.checked(id) {
                            crate::providers::validate_option(&descriptor, &defaults)?;
                        }
                        config.defaults = defaults;
                    }
                    if let Some(models) = input.favorite_models {
                        config.favorite_models = model_ids(models)?;
                    }
                    if let Some(models) = input.hidden_models {
                        config.hidden_models = model_ids(models)?;
                    }
                    let changed = previous != config.executable;
                    settings.providers.insert(id.to_string(), config);
                    self.save_provider_settings(&state, &settings)?;
                    changed
                };
                if executable_changed {
                    // A different executable is a different installation.
                    self.providers.forget(id);
                    self.check_providers(true)?;
                }
                Ok(json!({ "providers": self.describe_providers()? }))
            }
            "interaction.respond" => {
                let input: RespondInteraction = parse(params)?;
                input.validate()?;
                validate_id(&input.resource_id)?;
                let session_id = self
                    .lock()?
                    .store
                    .resource(&input.resource_id)?
                    .session_id
                    .ok_or_else(|| JamError::invalid("That resource is not a conversation."))?;
                let answer = match (input.choice_id, input.answers) {
                    (Some(choice), None) => Answer::Choice(choice),
                    (None, Some(answers)) => Answer::Answers(answers),
                    _ => return Err(JamError::invalid("Answer with one choice or with answers.")),
                };
                self.interactions
                    .answer(&session_id, &input.interaction_id, answer)?;
                Ok(json!({ "accepted": true }))
            }
            _ => Err(JamError::new(
                "unknown_method",
                "Unknown JAM request method.",
            )),
        }
    }
}

fn options_view(key: &str, value: &str) -> BTreeMap<String, String> {
    BTreeMap::from([(key.to_string(), value.to_string())])
}

/// A display label for the session's model: the provider's own label for
/// the chosen model. With none chosen the provider decides (its own config
/// may differ from its listed default), so the label says so until the
/// provider reports the model it actually used.
pub(crate) fn model_label(
    descriptor: Option<&ProviderDescriptor>,
    options: &BTreeMap<String, String>,
) -> String {
    let models = descriptor.and_then(|d| d.models.as_deref()).unwrap_or(&[]);
    match options.get("model") {
        Some(id) => models
            .iter()
            .find(|m| &m.id == id)
            .map(|m| m.label.clone())
            .unwrap_or_else(|| id.clone()),
        None => "Default model".into(),
    }
}
