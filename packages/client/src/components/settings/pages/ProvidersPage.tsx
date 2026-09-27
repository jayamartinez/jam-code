import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ProviderCapability, ProviderDescriptor } from '@jam/protocol';
import { PROVIDER_CAPABILITIES } from '@jam/protocol';
import { ProviderIcon } from '../../icons';
import { Planned, Row, Segmented, Select, Toggle } from '../controls';
import { ComingSoonGlyph } from '../provider-glyphs';
import {
  CAPABILITY_LABELS,
  CAPABILITY_STATUS,
  COMING_SOON,
  checkedLabel,
  initialProviderId,
  providerDescription,
  providerSummary,
  statusCells,
} from '../providers-model';
import type { ProviderControl, SettingsPageProps } from '../types';
import { effortLabel } from '../../composer-model';

/**
 * Providers as a list and a detail, from the Settings v2 frame. Everything
 * shown comes from the runtime's descriptor, which comes from the provider's
 * own CLI; anything it did not report stays unknown. Saved choices go to the
 * runtime; nothing here reads or stores provider credentials.
 */
export default function ProvidersPage({ providers, providerControl }: SettingsPageProps) {
  const [selectedId, setSelectedId] = useState(() => initialProviderId(providers));
  const [checking, setChecking] = useState(false);
  const selected =
    providers.find((provider) => provider.id === selectedId) ??
    providers.find((provider) => provider.id === initialProviderId(providers));
  useEffect(() => {
    void providerControl.ensure();
  }, [providerControl]);
  const check = () => {
    setChecking(true);
    void providerControl.refresh().finally(() => setChecking(false));
  };
  const checkedAt = providers
    .map((provider) => provider.checkedAt)
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);

  return (
    <div className="sv-page wide">
      <div className="sv-providers-bar">
        <p className="sv-providers-intro">
          Agents JAM can run in your projects. Credentials stay with each CLI.
        </p>
        <button
          type="button"
          className="sv-button quiet"
          onClick={check}
          disabled={checking}
          title="Ask every installed agent again"
        >
          <RefreshCw size={12} className={checking ? 'spinning' : ''} />
          {checking ? 'Checking…' : checkedLabel(checkedAt)}
        </button>
      </div>
      <div className="sv-split">
        <nav className="sv-split-list" aria-label="Providers">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className={`sv-provider-row ${provider.id === selected?.id ? 'selected' : ''}`}
            >
              <button
                type="button"
                className="sv-provider-select"
                aria-current={provider.id === selected?.id ? 'true' : undefined}
                onClick={() => setSelectedId(provider.id)}
              >
                <span className="sv-provider-glyph">
                  <ProviderIcon providerId={provider.id} density="pane" />
                </span>
                <span className="sv-provider-name">
                  <strong>
                    {provider.name}
                    {provider.version && <span className="sv-version">v{provider.version}</span>}
                  </strong>
                  <small>{providerSummary(provider)}</small>
                </span>
              </button>
              <Toggle
                label={`${provider.name} enabled`}
                on={provider.enabled}
                onChange={(enabled) =>
                  void providerControl.configure({ providerId: provider.id, enabled })
                }
              />
            </div>
          ))}
          <div className="sv-split-group">
            <span>Coming soon</span>
            <small>Not yet supported</small>
          </div>
          {COMING_SOON.map((agent) => (
            <div key={agent.id} className="sv-provider-row soon" aria-disabled="true">
              <ComingSoonGlyph id={agent.id} />
              <span className="sv-provider-name">
                <span>{agent.name}</span>
              </span>
              <span className="sv-soon-pill">Soon</span>
            </div>
          ))}
        </nav>
        {selected ? (
          <ProviderDetail
            key={selected.id}
            provider={selected}
            control={providerControl}
            checking={checking}
            onCheck={check}
          />
        ) : (
          <div className="sv-split-detail empty">The runtime reported no providers.</div>
        )}
      </div>
    </div>
  );
}

function ProviderDetail({
  provider,
  control,
  checking,
  onCheck,
}: {
  provider: ProviderDescriptor;
  control: ProviderControl;
  checking: boolean;
  onCheck(): void;
}) {
  const live = provider.id !== 'mock';
  const defaults = provider.defaults ?? {};
  const models = provider.models ?? [];
  const chosenModel = models.find((item) => item.id === defaults.model);
  // Effort levels follow the chosen model, else the one the provider lists first.
  const model = chosenModel ?? models.find((item) => item.isDefault) ?? models[0];
  const efforts = model?.efforts ?? [];
  const [executable, setExecutable] = useState(provider.executableOverride ?? '');
  const saveDefault = (key: string, value: string | undefined) => {
    const next = { ...defaults };
    if (value) next[key] = value;
    else delete next[key];
    // A model change keeps effort only if the new model offers it.
    if (key === 'model') {
      const chosen = models.find((item) => item.id === value);
      if (next.effort && !chosen?.efforts?.includes(next.effort)) delete next.effort;
    }
    void control.configure({ providerId: provider.id, defaults: next });
  };
  const saveExecutable = () => {
    const value = executable.trim();
    if (value === (provider.executableOverride ?? '')) return;
    void control.configure({ providerId: provider.id, executable: value });
  };

  return (
    <section className="sv-split-detail" aria-label={provider.name}>
      <header className="sv-detail-header">
        <span className="sv-detail-glyph">
          <ProviderIcon providerId={provider.id} density="pane" />
        </span>
        <div>
          <h2>
            {provider.name}
            {provider.version && <span className="sv-version">v{provider.version}</span>}
          </h2>
          <p>{providerDescription(provider)}</p>
        </div>
        {live && (
          <button
            type="button"
            className="sv-button sv-detail-action"
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Test connection'}
          </button>
        )}
      </header>

      <div className="sv-status-strip">
        {statusCells(provider).map((cell, index) => (
          <div key={index} className="sv-status-cell">
            <strong>
              <span className={`sv-dot ${cell.tone}`} />
              {cell.label}
            </strong>
            <small title={cell.detail}>{cell.detail}</small>
          </div>
        ))}
      </div>
      {provider.status && (
        <p className={`sv-provider-status ${provider.status.tone}`}>{provider.status.message}</p>
      )}

      <div className="sv-detail-group">
        <h3>Agent defaults</h3>
        <div className="sv-detail-card">
          <Row
            title="Default for new chats"
            sub={
              provider.enabled
                ? 'New chats start with this agent; you can switch before sending.'
                : 'Turn this agent on to make it the default.'
            }
          >
            <Toggle
              label="Default for new chats"
              on={provider.isDefault}
              disabled={!provider.enabled}
              onChange={(isDefault) =>
                void control.configure({ providerId: provider.id, isDefault })
              }
            />
          </Row>
          {live ? (
            <>
              <Row
                title="Model"
                sub={models.length ? undefined : 'Reported by the agent once it has been checked.'}
                disabled={!models.length}
              >
                <Select
                  label="Model"
                  value={models.length ? (chosenModel?.id ?? '') : 'none'}
                  options={
                    models.length
                      ? [
                          { value: '', label: 'Provider default' },
                          ...models.map((item) => ({ value: item.id, label: item.label })),
                        ]
                      : [{ value: 'none', label: 'Not reported' }]
                  }
                  {...(models.length
                    ? { onChange: (value) => saveDefault('model', value || undefined) }
                    : {})}
                />
              </Row>
              {efforts.length > 0 && (
                <Row title="Effort" sub={`Levels ${model?.label ?? 'this model'} reports.`}>
                  <Segmented
                    label="Effort"
                    value={defaults.effort ?? ''}
                    options={[
                      { value: '', label: 'Default' },
                      ...efforts.map((effort) => ({
                        value: effort,
                        label: effortLabel(effort),
                      })),
                    ]}
                    onChange={(value) => saveDefault('effort', value || undefined)}
                  />
                </Row>
              )}
              {(provider.options ?? []).map((option) => (
                <Row key={option.id} title={option.label} sub={option.description}>
                  <Select
                    label={option.label}
                    value={defaults[option.id] ?? option.default}
                    options={option.values.map((value) => ({
                      value: value.value,
                      label: value.label,
                    }))}
                    onChange={(value) =>
                      saveDefault(option.id, value === option.default ? undefined : value)
                    }
                  />
                </Row>
              ))}
            </>
          ) : (
            <Row title="Model">
              <span className="sv-value">Demo model · no model is called</span>
            </Row>
          )}
        </div>
      </div>

      <div className="sv-detail-group">
        <h3>Capabilities</h3>
        <div className="sv-capabilities">
          {PROVIDER_CAPABILITIES.map((capability: ProviderCapability) => {
            const support = provider.capabilities[capability];
            const status = support?.status ?? 'unknown';
            return (
              <span
                key={capability}
                className={`sv-capability ${status}`}
                title={support?.reason ?? CAPABILITY_STATUS[status]}
              >
                <span className="sv-capability-name">{CAPABILITY_LABELS[capability]}</span>
                <span className="sv-capability-status">{CAPABILITY_STATUS[status]}</span>
              </span>
            );
          })}
        </div>
      </div>

      {live && (
        <div className="sv-detail-group">
          <h3>Runtime</h3>
          <div className="sv-detail-card">
            <Row
              title="Executable"
              sub={
                provider.executableSource === 'override'
                  ? 'Set here. Clear it to find the CLI automatically.'
                  : 'Found automatically unless set.'
              }
            >
              <input
                className="sv-input sv-field mono"
                aria-label={`${provider.name} executable`}
                value={executable}
                placeholder={
                  provider.executable ? `auto · ${provider.executable}` : 'auto · not found'
                }
                spellCheck={false}
                onChange={(event) => setExecutable(event.target.value)}
                onBlur={saveExecutable}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveExecutable();
                }}
              />
            </Row>
            <Row
              title={
                <>
                  Config directory
                  <Planned />
                </>
              }
              disabled
            >
              <span className="sv-field">the CLI’s own default</span>
            </Row>
            <Row
              title={
                <>
                  Launch arguments
                  <Planned />
                </>
              }
              disabled
            >
              <span className="sv-field placeholder">none</span>
            </Row>
          </div>
        </div>
      )}
    </section>
  );
}
