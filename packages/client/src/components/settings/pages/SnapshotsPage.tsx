import { useEffect, useState } from 'react';
import { Check, Play, Volume2 } from 'lucide-react';
import type { Resource, SnapshotSettings } from '@jam/protocol';
import type { SnapshotHostAction, SnapshotShortcutStatus } from '../../../desktop';
import { useSnapshots } from '../../../state/snapshots';
import { SnapshotCard } from '../../SnapshotToast';
import { Card, Keys, PageHeader, Planned, Row, Section, Select, Toggle } from '../controls';
import {
  SHORTCUT_OPTIONS,
  shortcutFromValue,
  shortcutOption,
  shortcutValue,
} from '../snapshots-model';
import { SNAPSHOT_SOUNDS } from '../tools-model';
import type { SettingsPageProps } from '../types';

const CAPTURE_MODES = [
  { id: 'window', label: 'Active window', planned: false },
  { id: 'region', label: 'Region', planned: true },
  { id: 'screen', label: 'Full screen', planned: true },
] as const;

const DESTINATIONS = [
  { id: 'save', label: 'Save only' },
  { id: 'clipboard', label: 'Copy to clipboard' },
  {
    id: 'stage',
    label: 'Stage in the last-focused chat',
    sub: 'Added to its composer as context. Never sent automatically.',
  },
] as const;

const RETENTION = [
  { value: '1', label: '1 day, unless sent in a chat' },
  { value: '7', label: '7 days, unless sent in a chat' },
  { value: '30', label: '30 days, unless sent in a chat' },
] as const;

const DESCRIPTION =
  "Capture whatever you're looking at without leaving it, and hand it to an agent as context.";

/**
 * Snapshot preferences are runtime settings; the shortcut and capture belong to
 * the desktop host. Choices the host cannot honour yet stay visible but planned.
 */
export default function SnapshotsPage({ transport, snapshots: host }: SettingsPageProps) {
  const [settings, setSettings] = useState<SnapshotSettings>();
  const [status, setStatus] = useState<SnapshotShortcutStatus>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [conversations, setConversations] = useState<Resource[]>([]);
  /** The user asked to turn Snapshots on; setup stays open until it is. */
  const [setup, setSetup] = useState(false);
  const { snapshots, refresh, error, report } = useSnapshots(transport, host);

  // Coming back from System Settings: re-read the permissions once. No polling.
  useEffect(() => {
    if (!host) return;
    const onFocus = () => void host.action('status').then(setStatus).catch(report);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [host, report]);

  useEffect(() => {
    if (!host) return;
    let disposed = false;
    void Promise.all([
      transport.request('snapshot.settings.get', {}),
      host.action('status'),
      transport.request('workspace.get', {}),
    ])
      .then(([next, shortcut, workspace]) => {
        if (disposed) return;
        setSettings(next);
        setStatus(shortcut);
        setConversations(
          workspace.resources.filter((item) => item.kind === 'conversation' && item.sessionId),
        );
      })
      .catch(report);
    return () => {
      disposed = true;
    };
  }, [host, transport, report]);

  useEffect(() => {
    if (!host) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refreshStatus = () =>
      void host
        .action('status')
        .then((next) => {
          if (!disposed) setStatus(next);
        })
        .catch(report);
    void host
      .subscribe(refreshStatus)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(report);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [host, report]);

  async function update(patch: Partial<SnapshotSettings>) {
    if (!settings || !host) return;
    setBusy(true);
    try {
      setSettings(await transport.request('snapshot.settings.update', { ...settings, ...patch }));
      setStatus(await host.action('retry'));
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }

  async function hostAction(action: SnapshotHostAction) {
    if (!host) return;
    try {
      setStatus(await host.action(action));
    } catch (cause) {
      report(cause);
    }
  }

  if (!host)
    return (
      <div className="sv-page">
        <PageHeader
          title="Snapshots"
          description={DESCRIPTION}
          aside={<Planned>Desktop app</Planned>}
        />
        <p className="tools-snapshot-status">
          Active window capture is available in the macOS desktop app. Browser preview cannot
          capture other applications.
        </p>
      </div>
    );

  if (!settings)
    return (
      <div className="sv-page">
        <PageHeader title="Snapshots" description={DESCRIPTION} />
        <p className="tools-snapshot-status" role="status">
          {error || 'Loading Snapshot settings…'}
        </p>
      </div>
    );

  /** Screen Recording is the only permission Snapshots needs. */
  const ready = !!status?.screenRecording;
  /** On only when turned on and everything it needs is allowed. */
  const on = settings.enabled && ready;
  const paused = settings.enabled && !!status && !ready;
  const showSetup = !on && (setup || paused);
  const option = shortcutOption(settings.shortcut);
  // Setup explains missing permissions; only other problems need words here.
  const problem =
    status?.state === 'unavailable' || (status?.state === 'registered' && status.message)
      ? status.message
      : '';
  const turnOn = () => {
    if (ready) void update({ enabled: true }).then(() => setSetup(false));
    else setSetup(true);
  };
  const turnOff = () => {
    setSetup(false);
    if (settings.enabled) void update({ enabled: false });
  };
  const inbox = snapshots.filter((item) => !item.resourceId);
  const selectedSnapshot = snapshots.find((item) => item.id === selected);
  return (
    <div className="sv-page">
      <PageHeader
        title="Snapshots"
        description={DESCRIPTION}
        aside={
          <>
            <span className="tools-inline-label">Enabled</span>
            <Toggle
              label="Snapshots enabled"
              on={on}
              disabled={busy}
              onChange={(next) => (next ? turnOn() : turnOff())}
            />
          </>
        }
      />
      {(error || problem) && (
        <p className="tools-snapshot-status error" role="alert">
          {error || problem}
        </p>
      )}

      {showSetup && status && (
        <section className="tools-snapshot-setup" aria-label="Set up Snapshots">
          <header>
            <strong>{paused ? 'Snapshots are paused' : 'Turn on Snapshots'}</strong>
            <p>
              {paused
                ? 'Screen Recording was turned off for JAM. Allow it again to resume.'
                : 'macOS asks you to allow Screen Recording first. JAM captures only when you press the shortcut.'}
            </p>
          </header>
          <div className={`tools-snapshot-permission ${ready ? 'granted' : ''}`}>
            <span className="tools-snapshot-step" aria-hidden="true">
              {ready ? <Check size={12} /> : 1}
            </span>
            <div>
              <strong>Screen Recording</strong>
              <p>
                Lets JAM capture the window you’re looking at, only when you press the shortcut. JAM
                never watches your keyboard.
              </p>
            </div>
            {ready ? (
              <span className="tools-snapshot-allowed">Allowed</span>
            ) : (
              <span className="tools-snapshot-actions">
                <button
                  type="button"
                  className="sv-button quiet"
                  onClick={() => void hostAction('openScreenRecordingSettings')}
                >
                  Open System Settings
                </button>
                <button
                  type="button"
                  className="sv-button primary"
                  onClick={() => void hostAction('requestScreenRecording')}
                >
                  Allow
                </button>
              </span>
            )}
          </div>
          <footer>
            <p>
              {ready
                ? 'Screen Recording is allowed.'
                : 'Turn on JAM in the list System Settings opens. macOS may then ask to quit and reopen JAM.'}
            </p>
            {!settings.enabled && (
              <span className="tools-snapshot-actions">
                <button type="button" className="sv-button quiet" onClick={() => setSetup(false)}>
                  Not now
                </button>
                <button
                  type="button"
                  className="sv-button primary"
                  disabled={!ready || busy}
                  onClick={turnOn}
                >
                  Turn on Snapshots
                </button>
              </span>
            )}
          </footer>
        </section>
      )}

      <Section label="Capture">
        <Card>
          <Row
            title="Shortcut"
            sub={`${option.hint} Works while JAM is in the background, without taking focus.`}
          >
            <Keys keys={option.keys} />
            <Select
              label="Snapshot shortcut"
              value={shortcutValue(settings.shortcut)}
              options={SHORTCUT_OPTIONS.map(({ value, label }) => ({ value, label }))}
              disabled={busy}
              onChange={(value) => void update({ shortcut: shortcutFromValue(value) })}
            />
          </Row>
          <div className="sv-row tools-capture">
            <div className="sv-row-text">
              <strong>What to capture</strong>
              <p>The window in front when you press the shortcut.</p>
            </div>
            <div className="tools-capture-tiles" role="radiogroup" aria-label="What to capture">
              {CAPTURE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={mode.id === 'window'}
                  className={`tools-capture-tile ${mode.id} ${mode.id === 'window' ? 'active' : ''}`}
                  disabled
                >
                  <span className="tools-capture-picture" />
                  {mode.label}
                  {mode.planned && <Planned />}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </Section>

      <Section label="After capture" hint="You can switch destination from the capture toast">
        <Card className="tools-destinations">
          <div role="radiogroup" aria-label="After capture">
            {DESTINATIONS.map((destination) => (
              <label
                key={destination.id}
                className={`tools-radio ${settings.afterCapture === destination.id ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="snapshot-destination"
                  checked={settings.afterCapture === destination.id}
                  disabled={busy}
                  onChange={() => void update({ afterCapture: destination.id })}
                />
                <span>
                  <strong>{destination.label}</strong>
                  {'sub' in destination && <small>{destination.sub}</small>}
                </span>
              </label>
            ))}
          </div>
          <Row title="Also copy to clipboard">
            <Toggle
              label="Also copy to clipboard"
              on={settings.copyToClipboard}
              disabled={busy}
              onChange={(copyToClipboard) => void update({ copyToClipboard })}
            />
          </Row>
          <Row title="Also bring JAM to the front" disabled>
            <Planned />
            <Toggle label="Also bring JAM to the front" on={false} disabled />
          </Row>
        </Card>
      </Section>

      <Section label="Feedback" hint="How you know a capture happened">
        <Card>
          <Row title="Flash the captured window" sub="A quick white blink over what was captured.">
            <Toggle
              label="Flash the captured window"
              on={settings.flash}
              disabled={busy}
              onChange={(flash) => void update({ flash })}
            />
          </Row>
          <Row
            title="Show a toast"
            sub="Says where the snapshot went, with Remove and Change destination."
          >
            <Toggle
              label="Show a toast"
              on={settings.toast}
              disabled={busy}
              onChange={(toast) => void update({ toast })}
            />
          </Row>
          <Row title="Play a sound" sub="A quiet macOS tick. Choosing another sound is planned.">
            <span className="tools-sound">
              <Volume2 size={13} aria-hidden="true" />
              <Select label="Snapshot sound" value="tick" options={SNAPSHOT_SOUNDS} disabled />
            </span>
            <button
              type="button"
              className="sv-button tools-icon-button"
              aria-label="Play sound"
              disabled
            >
              <Play size={11} />
            </button>
            <Toggle
              label="Play a sound"
              on={settings.sound}
              disabled={busy}
              onChange={(sound) => void update({ sound })}
            />
          </Row>
        </Card>
      </Section>

      <Section label="Storage">
        <Card>
          <Row
            title="Keep snapshots"
            sub={`JAM app data · ${snapshots.length} unsent ${snapshots.length === 1 ? 'capture' : 'captures'}`}
          >
            <Select
              label="Keep snapshots"
              value={String(settings.retentionDays) as '1' | '7' | '30'}
              options={RETENTION}
              disabled={busy}
              onChange={(days) => void update({ retentionDays: Number(days) as 1 | 7 | 30 })}
            />
            <button
              type="button"
              className="sv-button"
              disabled={busy || !snapshots.length}
              onClick={() =>
                void transport
                  .request('snapshot.cleanup', { all: true })
                  .then(refresh)
                  .catch(report)
              }
            >
              Clear now
            </button>
          </Row>
        </Card>
      </Section>

      {!!inbox.length && (
        <Section label="Inbox" hint="Captures with no chat yet. Nothing is sent.">
          <Card className="tools-snapshot-inbox">
            {inbox.slice(0, 50).map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === selected ? 'active' : ''}
                onClick={() => setSelected(item.id === selected ? undefined : item.id)}
              >
                <span className="truncate">{item.context.label}</span>
                <small>{new Date(item.capturedAt).toLocaleString()}</small>
              </button>
            ))}
          </Card>
          {selectedSnapshot && (
            <SnapshotCard
              key={selectedSnapshot.id}
              snapshot={selectedSnapshot}
              conversations={conversations}
              transport={transport}
              onChanged={refresh}
              report={report}
              onDismiss={() => setSelected(undefined)}
              onOpen={() => void host.action('open', selectedSnapshot.id).catch(report)}
            />
          )}
        </Section>
      )}
    </div>
  );
}
