import { useState } from 'react';
import { Camera, File, FileText, Image, TriangleAlert, X } from 'lucide-react';
import type { ContextItem, JamTransport } from '@jam/protocol';
import { SnapshotImage } from './SnapshotImage';
import { formatBytes, sendsImage } from './attachment-model';

/** The mark for a piece of context: what kind of thing it is. */
export function ContextIcon({ item, size = 11 }: { item: ContextItem; size?: number }) {
  if (item.kind === 'snapshot') return <Camera size={size} />;
  if (item.attachment?.kind === 'image') return <Image size={size} />;
  if (item.kind === 'attachment') return <FileText size={size} />;
  return <File size={size} />;
}

export function ContextChip({
  item,
  transport,
  refused,
  onPreview,
  onRemove,
}: {
  item: ContextItem;
  transport?: Pick<JamTransport, 'request'>;
  /** Why this item cannot be sent as things stand; it is drawn as a warning. */
  refused?: string | null;
  onPreview(item: ContextItem): void;
  onRemove(id: string): void;
}) {
  const [hovered, setHovered] = useState(false);
  const snapshot = item.kind === 'snapshot';
  const blocked = !!refused && sendsImage(item);
  const tone = blocked ? 'refused' : snapshot || item.kind.startsWith('browser') ? 'accent' : '';
  return (
    <span
      className={`context-chip ${tone}`}
      title={blocked ? refused : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => onPreview(item)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        {blocked ? <TriangleAlert size={11} /> : <ContextIcon item={item} />}
        <span className="truncate">{item.label}</span>
        {item.attachment && (
          <span className="context-chip-detail">
            {blocked ? 'can’t be sent' : formatBytes(item.attachment.bytes)}
          </span>
        )}
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
