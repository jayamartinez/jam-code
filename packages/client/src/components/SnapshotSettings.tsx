import { useEffect, useState, type ReactNode } from 'react';
import type { JamTransport, Resource, SnapshotSettings as Settings } from '@jam/protocol';
import type { SnapshotHost, SnapshotShortcutStatus } from '../desktop';
import { useSnapshots } from '../state/snapshots';
import { SnapshotCard } from './SnapshotToast';

function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <div className="snapshot-setting-row">
      <div>
        <strong>{title}</strong>
        {detail && <p>{detail}</p>}
      </div>
      {children}
    </div>
  );
}
function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <button
      type="button"
      className={`snapshot-toggle ${checked ? 'on' : ''}`}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
export function SnapshotSettings({
  transport,
  host,
}: {
  transport: JamTransport;
  host?: SnapshotHost;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [status, setStatus] = useState<SnapshotShortcutStatus>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [conversations, setConversations] = useState<Resource[]>([]);
  const { snapshots, refresh, error, report } = useSnapshots(transport, host);
  useEffect(() => {
    if (!host) return;
    let disposed = false;
    void Promise.all([
      transport.request('snapshot.settings.get', {}),
      host.action('status'),
      transport.request('workspace.get', {}),
    ])
      .then(([s, h, w]) => {
        if (!disposed) {
          setSettings(s);
          setStatus(h);
          setConversations(w.resources.filter((r) => r.kind === 'conversation' && r.sessionId));
        }
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
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(report);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [host, report]);
  async function update(patch: Partial<Settings>) {
    if (!settings || !host) return;
    setBusy(true);
    try {
      const next = await transport.request('snapshot.settings.update', { ...settings, ...patch });
      setSettings(next);
      setStatus(await host.action('retry'));
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  async function hostAction(action: 'retry' | 'permissions') {
    if (host)
      try {
        setStatus(await host.action(action));
      } catch (cause) {
        report(cause);
      }
  }
  if (!host)
    return (
      <div className="settings-content-scroll">
        <div className="snapshot-settings">
          <h2>Snapshots</h2>
          <p>
            Active window capture is available in the macOS desktop app. Browser preview cannot
            capture other applications.
          </p>
        </div>
      </div>
    );
  if (!settings) return <p role="status">{error || 'Loading Snapshot settings…'}</p>;
  const selectedSnapshot = snapshots.find((s) => s.id === selected);
  return (
    <div className="settings-content-scroll">
      <div className="snapshot-settings">
        <header>
          <div>
            <h2>Snapshots</h2>
            <p>
              Capture whatever you’re looking at without leaving it, and hand it to an agent as
              context.
            </p>
          </div>
          <span className="snapshot-enabled">
            Enabled{' '}
            <Toggle
              label="Enable Snapshots"
              checked={settings.enabled}
              disabled={busy}
              onChange={(enabled) => void update({ enabled })}
            />
          </span>
        </header>
        {error && (
          <p className="snapshot-error" role="alert">
            {error}
          </p>
        )}
        <section>
          <h3>Capture</h3>
          <div className="snapshot-settings-card">
            <Row
              title="Shortcut"
              detail="Works in the background. macOS needs Input Monitoring for double-tap detection and Screen Recording for capture."
            >
              <span className="snapshot-keycaps">
                <kbd>⇧ Shift</kbd>
                <kbd>⇧ Shift</kbd>
                <small>double-tap</small>
              </span>
            </Row>
            <p
              className={`snapshot-shortcut-status ${status?.state === 'unavailable' ? 'snapshot-error' : ''}`}
              role="status"
            >
              {status?.message}
            </p>
            <div className="snapshot-permissions">
              <button className="button" onClick={() => void hostAction('permissions')}>
                Allow macOS permissions
              </button>
              <button className="button" onClick={() => void hostAction('retry')}>
                Retry shortcut
              </button>
            </div>
            <Row
              title="What to capture"
              detail="Two deliberate taps, without other keys or typing."
            >
              <div className="snapshot-modes">
                <span className="selected">
                  <i className="snapshot-mode-icon">
                    <i />
                  </i>
                  <small>Active window</small>
                </span>
                <span aria-disabled="true">
                  <i className="snapshot-mode-icon region">
                    <i />
                  </i>
                  <small>Region · Planned</small>
                </span>
                <span aria-disabled="true">
                  <i className="snapshot-mode-icon" />
                  <small>Full screen · Planned</small>
                </span>
              </div>
            </Row>
          </div>
        </section>
        <section>
          <h3>
            After capture <small>You can switch destination from the capture toast</small>
          </h3>
          <div className="snapshot-settings-card snapshot-actions">
            {(
              [
                ['save', 'Save only'],
                ['clipboard', 'Copy to clipboard'],
                ['stage', 'Stage in the last-focused chat'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={settings.afterCapture === value ? 'selected' : ''}>
                <input
                  type="radio"
                  name="after-capture"
                  checked={settings.afterCapture === value}
                  disabled={busy}
                  onChange={() => void update({ afterCapture: value })}
                />
                <span>
                  {label}
                  {value === 'stage' && (
                    <small>Added to its composer as context. Never sent automatically.</small>
                  )}
                </span>
              </label>
            ))}
            <Row title="Also copy to clipboard">
              <Toggle
                label="Also copy to clipboard"
                checked={settings.copyToClipboard}
                disabled={busy}
                onChange={(copyToClipboard) => void update({ copyToClipboard })}
              />
            </Row>
          </div>
        </section>
        <section>
          <h3>
            Feedback <small>How you know a capture happened</small>
          </h3>
          <div className="snapshot-settings-card">
            <Row
              title="Flash the captured window"
              detail="A quick white blink over what was captured."
            >
              <Toggle
                label="Flash the captured window"
                checked={settings.flash}
                disabled={busy}
                onChange={(flash) => void update({ flash })}
              />
            </Row>
            <Row
              title="Show a toast"
              detail="Says where the snapshot went, with Remove and Change destination."
            >
              <Toggle
                label="Show snapshot toast"
                checked={settings.toast}
                disabled={busy}
                onChange={(toast) => void update({ toast })}
              />
            </Row>
            <Row title="Play a sound" detail="A quiet macOS tick.">
              <Toggle
                label="Play capture sound"
                checked={settings.sound}
                disabled={busy}
                onChange={(sound) => void update({ sound })}
              />
            </Row>
          </div>
        </section>
        <section>
          <h3>Storage</h3>
          <div className="snapshot-settings-card">
            <Row
              title="Keep snapshots"
              detail={`JAM app data · ${snapshots.length} temporary captures`}
            >
              <select
                aria-label="Snapshot retention"
                disabled={busy}
                value={settings.retentionDays}
                onChange={(e) =>
                  void update({ retentionDays: Number(e.target.value) as 1 | 7 | 30 })
                }
              >
                {[1, 7, 30].map((days) => (
                  <option key={days} value={days}>
                    {days} days, unless sent in a chat
                  </option>
                ))}
              </select>
              <button
                className="button"
                disabled={busy || !snapshots.length}
                onClick={() =>
                  void transport
                    .request('snapshot.cleanup', { all: true })
                    .then(refresh)
                    .catch(report)
                }
              >
                Clear temporary
              </button>
            </Row>
          </div>
        </section>
        <section>
          <h3>
            Snapshot inbox <small>Saved locally; nothing is sent</small>
          </h3>
          {!snapshots.length && <p>No temporary snapshots.</p>}
          <div className="snapshot-inbox">
            {snapshots.slice(0, 50).map((s) => (
              <button key={s.id} onClick={() => setSelected(s.id)}>
                <span>{s.context.label}</span>
                <small>
                  {s.resourceId
                    ? (conversations.find((r) => r.id === s.resourceId)?.title ?? 'Conversation')
                    : 'Unassigned'}{' '}
                  · {new Date(s.capturedAt).toLocaleString()}
                </small>
              </button>
            ))}
          </div>
          {snapshots.length > 50 && <p>Showing the latest 50 captures.</p>}
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
        </section>
      </div>
    </div>
  );
}
