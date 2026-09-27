import { useMemo } from 'react';
import type { ProviderDescriptor } from '@jam/protocol';
import { ProviderIcon } from '../../icons';
import { Card, PageHeader, Planned, Section, Segmented } from '../controls';
import { PROVIDER_COLOR, UsageAreaChart } from '../usage-chart';
import {
  EMPTY_USAGE,
  dailySeries,
  dayRange,
  formatResetsIn,
  formatTokens,
  percentLeft,
  usageSources,
  windowTitle,
  type LiveProviderId,
  type Measure,
  type UsageSummary,
  type UsageWindow,
} from '../usage-model';
import type { SettingsPageProps } from '../types';

const RANGE_DAYS = 30;

/**
 * Usage and limits as each connected agent reports them for the whole
 * account. No provider adapter reports usage yet, so every section renders
 * its designed frame from an empty summary and says so; nothing here is
 * counted by JAM.
 */
export default function UsagePage({ providers, onNavigate }: SettingsPageProps) {
  // Replaced by the adapters' reports when they exist.
  const usage: UsageSummary = EMPTY_USAGE;
  const measure: Measure = 'tokens';
  const { connected, disconnected } = usageSources(providers);
  const dates = useMemo(() => dayRange(new Date(), RANGE_DAYS), []);
  const series = useMemo(() => dailySeries(usage.daily, dates, measure), [usage, dates, measure]);
  const now = new Date();

  return (
    <div className="sv-page">
      <PageHeader
        title="Usage"
        description="Usage and limits reported by your connected agents. Costs are API-price estimates, not bills."
        aside={
          <>
            <Segmented
              label="Measure"
              value={measure}
              options={[
                { value: 'tokens', label: 'Tokens' },
                { value: 'cost', label: 'Cost' },
              ]}
              disabled
            />
            <Segmented
              label="Range"
              value="30"
              options={[
                { value: '1', label: 'Today' },
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
              ]}
              disabled
            />
          </>
        }
      />

      <Section
        label={
          <>
            Limits <Planned />
          </>
        }
      >
        <Card className="usage-limits">
          {connected.map((provider) => (
            <LimitGroup
              key={provider.id}
              provider={provider}
              windows={usage.windows.filter((window) => window.providerId === provider.id)}
              now={now}
            />
          ))}
          {disconnected.map((provider) => (
            <div key={provider.id} className="usage-connect">
              <span className="usage-source-glyph">
                <ProviderIcon providerId={provider.id} density="dense" />
              </span>
              <p>Connect {provider.name} to see its usage.</p>
              <button
                type="button"
                className="sv-button quiet"
                onClick={() => onNavigate('Providers')}
              >
                Providers ›
              </button>
            </div>
          ))}
          {connected.length + disconnected.length === 0 && (
            <p className="usage-empty">The runtime reports no agents that could share usage.</p>
          )}
        </Card>
      </Section>

      <Section
        label={
          <>
            Activity <Planned />
          </>
        }
      >
        <Card className="usage-activity">
          <div className="usage-activity-body">
            <div className="usage-total">
              <strong>—</strong>
              <span>no usage reported · {RANGE_DAYS} days</span>
              <ul>
                {connected.map((provider) => (
                  <li key={provider.id}>
                    <i style={{ background: PROVIDER_COLOR[provider.id as LiveProviderId] }} />
                    <ProviderIcon providerId={provider.id} density="dense" />
                    <span>{provider.name}</span>
                    <b>—</b>
                  </li>
                ))}
              </ul>
            </div>
            <UsageAreaChart
              series={series}
              dates={dates}
              measure={measure}
              formatValue={formatTokens}
              empty="No usage reported yet"
            />
          </div>
          <dl className="usage-totals">
            {['Cached input', 'Uncached input', 'Output', 'Est. cost'].map((label) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>—</dd>
              </div>
            ))}
          </dl>
        </Card>
      </Section>

      <Section
        label="Breakdown"
        hint={
          <Segmented
            label="Breakdown"
            value="model"
            options={[
              { value: 'model', label: 'By model' },
              { value: 'day', label: 'By day' },
            ]}
            disabled
          />
        }
      >
        <Card className="usage-breakdown">
          <div className="usage-breakdown-head" aria-hidden="true">
            <span>Model</span>
            <span>Share of tokens</span>
            <span>Tokens</span>
            <span>Est. cost</span>
          </div>
          <p className="usage-empty">Models appear here once an agent reports usage.</p>
        </Card>
        <div>
          <span className="sv-chip">Estimates use public API prices</span>
        </div>
      </Section>
    </div>
  );
}

function LimitGroup({
  provider,
  windows,
  now,
}: {
  provider: ProviderDescriptor;
  windows: UsageWindow[];
  now: Date;
}) {
  return (
    <div className="usage-limit-group">
      <div className="usage-source">
        <span className="usage-source-glyph">
          <ProviderIcon providerId={provider.id} density="dense" />
        </span>
        Reported by {provider.name}
      </div>
      {windows.length === 0 ? (
        <div className="usage-limit">
          <div className="usage-limit-figure">
            <strong>Not reported yet</strong>
          </div>
          <div className="usage-meter" aria-hidden="true" />
        </div>
      ) : (
        windows.map((window) => <LimitRow key={windowTitle(window)} window={window} now={now} />)
      )}
    </div>
  );
}

function LimitRow({ window, now }: { window: UsageWindow; now: Date }) {
  const left = percentLeft(window);
  return (
    <div className="usage-limit">
      <div className="usage-limit-figure">
        <span>{windowTitle(window)}</span>
        <strong>
          {left}% <small>left</small>
        </strong>
      </div>
      <div className="usage-limit-meter">
        <div
          className="usage-meter"
          role="meter"
          aria-label={`${windowTitle(window)} used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={100 - left}
        >
          <div style={{ width: `${100 - left}%` }} />
        </div>
        <div className="usage-limit-meta">
          <span>{100 - left}% used</span>
          <span className="sv-mono">resets in {formatResetsIn(window.resetsAt, now)}</span>
        </div>
      </div>
    </div>
  );
}
