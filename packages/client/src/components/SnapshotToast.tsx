import { useEffect, useState } from 'react';
import { Camera, X } from 'lucide-react';
import type { JamTransport, Resource, Snapshot } from '@jam/protocol';
import type { SnapshotHost } from '../desktop';
import { useSnapshots } from '../state/snapshots';
import { SnapshotImage } from './SnapshotImage';

type Transport = Pick<JamTransport, 'request'>;
export function SnapshotToast({ transport, host }: { transport: Transport; host: SnapshotHost }) {
  const { snapshots, refresh, error, report } = useSnapshots(transport, host);
  const [latestId, setLatestId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Resource[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const interacting = latestId !== null && (hoveredId === latestId || focusedId === latestId);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const update = () => {
      void host
        .action('status')
        .then((s) => {
          if (!disposed) setLatestId(s.latestId);
        })
        .catch(report);
      void transport
        .request('workspace.get', {})
        .then((w) => {
          if (!disposed)
            setConversations(w.resources.filter((r) => r.kind === 'conversation' && r.sessionId));
        })
        .catch(report);
    };
    void host
      .subscribe(update)
      .then((fn) => {
        if (disposed) fn();
        else {
          unlisten = fn;
          update();
        }
      })
      .catch(report);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [host, transport, report]);
  useEffect(() => {
    if (!latestId || interacting) return;
    const timer = window.setTimeout(() => void host.action('dismiss').catch(report), 3000);
    return () => window.clearTimeout(timer);
  }, [latestId, interacting, host, report]);
  const snapshot = snapshots.find((s) => s.id === latestId);
  return (
    <div
      onPointerEnter={() => setHoveredId(latestId)}
      onPointerLeave={() => setHoveredId(null)}
      onFocus={() => setFocusedId(latestId)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
      }}
    >
      {snapshot ? (
        <SnapshotCard
          key={snapshot.id}
          snapshot={snapshot}
          conversations={conversations}
          transport={transport}
          onOpen={() => void host.action('open', snapshot.id).catch(report)}
          onDismiss={() => void host.action('dismiss').catch(report)}
          onChanged={refresh}
          report={report}
        />
      ) : (
        <div className="snapshot-toast">
          {error || 'Snapshot is no longer staged.'}
          <button className="button" onClick={() => void host.action('dismiss')}>
            Dismiss
          </button>
        </div>
      )}
      {error && (
        <p className="snapshot-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SnapshotCard({
  snapshot,
  conversations,
  transport,
  onOpen,
  onDismiss,
  onChanged,
  report,
}: {
  snapshot: Snapshot;
  conversations: Resource[];
  transport: Transport;
  onOpen(): void;
  onDismiss(): void;
  onChanged(): void;
  report(cause: unknown): void;
}) {
  const [note, setNote] = useState(snapshot.note);
  const [busy, setBusy] = useState(false);
  async function stage(resourceId: string | null) {
    setBusy(true);
    try {
      await transport.request('snapshot.stage', { id: snapshot.id, resourceId, note });
      onChanged();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await transport.request('snapshot.remove', { id: snapshot.id });
      onChanged();
      onDismiss();
    } catch (cause) {
      report(cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="snapshot-toast" aria-label="Captured snapshot">
      <header>
        <Camera size={13} className="snapshot-accent" />
        <strong>{snapshot.resourceId ? 'Snapshot staged' : 'Snapshot saved'}</strong>
        <span className="truncate" title={`${snapshot.application} · ${snapshot.windowTitle}`}>
          {snapshot.application} · {snapshot.windowTitle}
        </span>
        <button aria-label="Dismiss snapshot" onClick={onDismiss}>
          <X size={10} />
        </button>
      </header>
      <div className="snapshot-thumbnail">
        <SnapshotImage id={snapshot.id} transport={transport} />
      </div>
      <label className="snapshot-destination">
        Staged in
        <select
          aria-label="Snapshot destination"
          disabled={busy}
          value={snapshot.resourceId ?? ''}
          onChange={(e) => void stage(e.target.value || null)}
        >
          <option value="">Snapshot inbox</option>
          {conversations.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </select>
      </label>
      <input
        className="snapshot-note"
        aria-label="Snapshot note"
        placeholder="Add a note (optional)…"
        maxLength={2000}
        value={note}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== snapshot.note) void stage(snapshot.resourceId);
        }}
      />
      <footer>
        <button className="button primary" onClick={onOpen}>
          {snapshot.resourceId ? 'Open in chat' : 'Open JAM'}
        </button>
        <button className="button" disabled={busy} onClick={() => void remove()}>
          Remove
        </button>
        <button className="snapshot-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </footer>
    </section>
  );
}
