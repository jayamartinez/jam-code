import { useState } from 'react';
import type { ProviderCapability, ProviderDescriptor } from '@jam/protocol';
import { ProviderIcon } from '../../icons';
import { Planned, Row, Segmented, Select, Toggle } from '../controls';
import { ComingSoonGlyph } from '../provider-glyphs';
import {
  CAPABILITY_LABELS,
  CAPABILITY_STATUS,
  COMING_SOON,
  initialProviderId,
  providerDescription,
  providerSummary,
  statusCells,
} from '../providers-model';
import type { SettingsPageProps } from '../types';

/**
 * Providers as a list and a detail, from the Settings v2 frame. Everything
 * shown is the runtime's own descriptor; JAM has no request to enable,
 * disable or configure a provider yet, so those controls stay disabled and
 * are marked Planned rather than pretending to save.
 */
export default function ProvidersPage({ providers }: SettingsPageProps) {
  const [selectedId, setSelectedId] = useState(() => initialProviderId(providers));
  const selected =
    providers.find((provider) => provider.id === selectedId) ??
    providers.find((provider) => provider.id === initialProviderId(providers));

  return (
    <div className="sv-page wide">
      <p className="sv-providers-intro">Agents JAM can run in your projects.</p>
      <div className="sv-split">
        <nav className="sv-split-list" aria-label="Providers">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={`sv-provider-row ${provider.id === selected?.id ? 'selected' : ''}`}
              aria-current={provider.id === selected?.id ? 'true' : undefined}
              onClick={() => setSelectedId(provider.id)}
            >
              <span className="sv-provider-glyph">
                <ProviderIcon providerId={provider.id} density="pane" />
              </span>
              <span className="sv-provider-name">
                <strong>{provider.name}</strong>
                <small>{providerSummary(provider)}</small>
              </span>
              <span
                className={`sv-toggle ${provider.enabled ? 'on' : ''} readonly`}
                role="img"
                aria-label={provider.enabled ? 'Enabled' : 'Unavailable'}
              />
            </button>
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
          <ProviderDetail provider={selected} />
        ) : (
          <div className="sv-split-detail empty">The runtime reported no providers.</div>
        )}
      </div>
    </div>
  );
}

function ProviderDetail({ provider }: { provider: ProviderDescriptor }) {
  const live = provider.id !== 'mock';
  return (
    <section className="sv-split-detail" aria-label={provider.name}>
      <header className="sv-detail-header">
        <span className="sv-detail-glyph">
          <ProviderIcon providerId={provider.id} density="pane" />
        </span>
        <div>
          <h2>{provider.name}</h2>
          <p>{providerDescription(provider)}</p>
        </div>
      </header>

      <div className="sv-status-strip">
        {statusCells(provider).map((cell) => (
          <div key={cell.label + cell.detail} className="sv-status-cell">
            <strong>
              <span className={`sv-dot ${cell.tone}`} />
              {cell.label}
            </strong>
            <small>{cell.detail}</small>
          </div>
        ))}
      </div>

      <div className="sv-detail-group">
        <h3>Agent defaults</h3>
        <div className="sv-detail-card">
          <Row
            title="Default for new chats"
            sub={
              provider.isDefault ? 'New chats use this agent.' : 'Chosen by the runtime for now.'
            }
          >
            <Toggle label="Default for new chats" on={provider.isDefault} disabled />
          </Row>
          <Row
            title={
              <>
                Model
                {live && <Planned />}
              </>
            }
            disabled={live}
          >
            {live ? (
              <Select
                label="Model"
                value="none"
                options={[{ value: 'none', label: 'Not available' }]}
                disabled
              />
            ) : (
              <span className="sv-value">Demo model</span>
            )}
          </Row>
          <Row
            title={
              <>
                Effort
                <Planned />
              </>
            }
            disabled
          >
            <Segmented
              label="Effort"
              value={'none' as string}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'max', label: 'Max' },
              ]}
              disabled
            />
          </Row>
          <Row
            title={
              <>
                Permissions
                <Planned />
              </>
            }
            sub="What the agent may do without asking."
            disabled
          >
            <Select
              label="Permissions"
              value="none"
              options={[{ value: 'none', label: live ? 'Not available' : 'Not applicable' }]}
              disabled
            />
          </Row>
        </div>
      </div>

      <div className="sv-detail-group">
        <h3>Capabilities</h3>
        <div className="sv-capabilities">
          {(Object.keys(CAPABILITY_LABELS) as ProviderCapability[]).map((capability) => {
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
          <h3>
            Runtime
            <Planned />
          </h3>
          <div className="sv-detail-card">
            <Row title="Executable" disabled>
              <span className="sv-field">auto</span>
            </Row>
            <Row title="Config directory" disabled>
              <span className="sv-field">default</span>
            </Row>
            <Row title="Launch arguments" disabled>
              <span className="sv-field placeholder">none</span>
            </Row>
          </div>
        </div>
      )}
    </section>
  );
}
