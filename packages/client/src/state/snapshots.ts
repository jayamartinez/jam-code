import { useCallback, useEffect, useState } from 'react';
import type { JamTransport, Resource, Snapshot } from '@jam/protocol';
import type { SnapshotHost } from '../desktop';
import { activeResourceId, focusedPane, type LayoutState } from './layout';

/** A file/terminal pane never overwrites the last focused agent conversation. */
export function snapshotFocus(layout: LayoutState, resources: Resource[]): string | null {
  const id =
    layout.mode === 'tiles' && !layout.focus
      ? focusedPane(layout)?.resourceId
      : activeResourceId(layout);
  return resources.find((r) => r.id === id && r.kind === 'conversation' && r.sessionId)?.id ?? null;
}

export function useSnapshots(transport: Pick<JamTransport, 'request'>, host?: SnapshotHost) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [error, setError] = useState('');
  const report = useCallback(
    (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Snapshot operation failed.'),
    [],
  );
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!host) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void host
      .subscribe(refresh)
      .then((fn) => {
        if (disposed) fn();
        else {
          unlisten = fn;
          refresh(); // Close the initial-read/listener-registration race.
        }
      })
      .catch(report);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [host, refresh, report]);
  useEffect(() => {
    if (!host) return;
    let disposed = false;
    void transport
      .request('snapshot.list', {})
      .then((result) => {
        if (!disposed) {
          setSnapshots(result.snapshots);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) report(cause);
      });
    return () => {
      disposed = true;
    };
  }, [host, transport, revision, report]);
  return { snapshots, refresh, error, report };
}
