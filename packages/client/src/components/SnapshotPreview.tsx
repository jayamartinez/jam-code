import type { ContextItem, JamTransport, Snapshot } from '@jam/protocol';
import { SnapshotImage } from './SnapshotImage';

const time = (capturedAt: number) =>
  new Date(capturedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/**
 * A staged snapshot, previewed from its composer chip: the whole capture at its
 * own aspect ratio, where it came from, and a reminder that nothing is sent.
 */
export function SnapshotPreview({
  item,
  snapshot,
  transport,
  onClose,
}: {
  item: ContextItem;
  snapshot?: Snapshot;
  transport: Pick<JamTransport, 'request'>;
  onClose(): void;
}) {
  const meta = snapshot
    ? [
        snapshot.windowTitle || snapshot.application,
        `${snapshot.width}×${snapshot.height}`,
        time(snapshot.capturedAt),
      ]
    : [];
  const note = snapshot?.note || item.source.selection;
  return (
    <div className="snapshot-preview">
      <header>
        <h2>{item.label}</h2>
        {!!meta.length && (
          <span className="snapshot-preview-meta truncate">{meta.join(' · ')}</span>
        )}
      </header>
      {item.assetId && (
        <figure
          className="snapshot-preview-frame"
          style={snapshot ? { aspectRatio: `${snapshot.width} / ${snapshot.height}` } : undefined}
        >
          <SnapshotImage id={item.assetId} transport={transport} thumbnail={false} />
        </figure>
      )}
      {note && <p className="snapshot-preview-note">{note}</p>}
      <footer>
        <p>Local snapshot. Included only when you explicitly Send to the mock conversation.</p>
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </footer>
    </div>
  );
}
