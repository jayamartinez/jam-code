import { useState } from 'react';
import { Camera, File, X } from 'lucide-react';
import type { ContextItem, JamTransport } from '@jam/protocol';
import { SnapshotImage } from './SnapshotImage';

export function ContextChip({
  item,
  transport,
  onPreview,
  onRemove,
}: {
  item: ContextItem;
  transport?: Pick<JamTransport, 'request'>;
  onPreview(item: ContextItem): void;
  onRemove(id: string): void;
}) {
  const [hovered, setHovered] = useState(false);
  const snapshot = item.kind === 'snapshot';
  return (
    <span
      className={`context-chip ${snapshot || item.kind.startsWith('browser') ? 'accent' : ''}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => onPreview(item)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        {snapshot ? <Camera size={11} /> : <File size={11} />}
        <span className="truncate">{item.label}</span>
      </button>
      <button
        className="remove-context"
        type="button"
        aria-label={`Remove ${item.label}`}
        onClick={() => onRemove(item.id)}
      >
        <X size={10} />
      </button>
      {hovered && snapshot && item.assetId && transport && (
        <span className="snapshot-chip-thumbnail" role="tooltip">
          <SnapshotImage id={item.assetId} transport={transport} />
        </span>
      )}
    </span>
  );
}
