import { useEffect, useState } from 'react';
import type { ContextItem, JamTransport } from '@jam/protocol';
import { attachmentDetail, formatBytes } from './attachment-model';

/**
 * An attachment opened from its chip, staged or sent: an image is shown from
 * the runtime's own copy, addressed by ID; any other file shows what it is.
 * Nothing here knows where the file came from.
 */
export function AttachmentPreview({
  item,
  sent,
  transport,
  onClose,
}: {
  item: ContextItem;
  /** It is part of a message already, rather than waiting for Send. */
  sent: boolean;
  transport: Pick<JamTransport, 'request'>;
  onClose(): void;
}) {
  const info = item.attachment;
  const image = info?.kind === 'image' && item.assetId ? item.assetId : null;
  const [loaded, setLoaded] = useState<{ id: string; url?: string; error?: string }>();
  useEffect(() => {
    if (!image) return;
    let disposed = false;
    void transport.request('attachment.asset', { id: image }).then(
      ({ dataUrl }) => {
        if (!disposed) setLoaded({ id: image, url: dataUrl });
      },
      () => {
        if (!disposed) setLoaded({ id: image, error: 'This image is no longer available.' });
      },
    );
    return () => {
      disposed = true;
    };
  }, [image, transport]);
  const current = loaded?.id === image ? loaded : undefined;
  return (
    <div className="snapshot-preview">
      <header>
        <h2>{item.label}</h2>
        {info && (
          <span className="snapshot-preview-meta truncate">
            {[
              info.kind === 'image' ? attachmentDetail(item) : info.mediaType,
              formatBytes(info.bytes),
            ].join(' · ')}
          </span>
        )}
      </header>
      {image && (
        <figure className="snapshot-preview-frame attachment-preview-frame">
          {current?.url ? (
            <img className="snapshot-image" src={current.url} alt={item.label} />
          ) : (
            <span className="snapshot-image-placeholder">{current?.error ?? 'Loading image…'}</span>
          )}
        </figure>
      )}
      <footer>
        <p>
          {sent
            ? 'Sent with this message. JAM Code keeps its own copy with the conversation.'
            : info?.kind === 'image'
              ? 'A copy kept by JAM Code. It is sent as an image when you press Send.'
              : 'A copy kept by JAM Code. When you press Send, the agent is told where the copy is and opens it itself.'}
        </p>
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
      </footer>
    </div>
  );
}
