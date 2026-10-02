import { useEffect, useState } from 'react';
import { JamError, type ContextItem, type JamTransport } from '@jam/protocol';
import { attachmentDetail, formatBytes } from './attachment-model';

interface Loaded {
  id: string;
  url?: string;
  text?: string;
  truncated?: boolean;
  /** Why nothing is shown, when that is worth saying. */
  note?: string;
}

/**
 * An attachment opened from its chip, from a sent message or from its name
 * in a reply: an image or the start of a text file is shown from the
 * runtime's own copy, addressed by ID; any other file says what it is and
 * can be shown in the file manager. Nothing here knows where the file came from.
 */
export function AttachmentPreview({
  item,
  sent,
  transport,
  revealLabel,
  onReveal,
  onClose,
}: {
  item: ContextItem;
  /** It is part of a message already, rather than waiting for Send. */
  sent: boolean;
  transport: Pick<JamTransport, 'request'>;
  /** The platform's name for showing a file in its folder. */
  revealLabel?: string;
  onReveal?(item: ContextItem): void;
  onClose(): void;
}) {
  const info = item.attachment;
  const id = info && item.assetId ? item.assetId : null;
  const image = info?.kind === 'image';
  const [loaded, setLoaded] = useState<Loaded>();
  useEffect(() => {
    if (!id) return;
    let disposed = false;
    const show = (next: Omit<Loaded, 'id'>) => {
      if (!disposed) setLoaded({ id, ...next });
    };
    if (image)
      void transport.request('attachment.asset', { id }).then(
        ({ dataUrl }) => show({ url: dataUrl }),
        () => show({ note: 'This image is no longer available.' }),
      );
    else
      void transport.request('attachment.text', { id }).then(
        ({ text, truncated }) => show({ text, truncated }),
        (error: unknown) =>
          show({
            note:
              error instanceof JamError && error.code === 'invalid_request'
                ? 'JAM Code previews images and text. This file can be opened from its folder.'
                : 'This file is no longer available.',
          }),
      );
    return () => {
      disposed = true;
    };
  }, [id, image, transport]);
  const current = loaded?.id === id ? loaded : undefined;
  return (
    <div className="snapshot-preview">
      <header>
        <h2>{item.label}</h2>
        {info && (
          <span className="snapshot-preview-meta truncate">
            {[image ? attachmentDetail(item) : info.mediaType, formatBytes(info.bytes)].join(' · ')}
          </span>
        )}
      </header>
      {image ? (
        <figure className="snapshot-preview-frame attachment-preview-frame">
          {current?.url ? (
            <img className="snapshot-image" src={current.url} alt={item.label} />
          ) : (
            <span className="snapshot-image-placeholder">{current?.note ?? 'Loading image…'}</span>
          )}
        </figure>
      ) : current?.text !== undefined ? (
        <>
          {/* Text only: repository and attached content is never rendered as HTML. */}
          <pre className="attachment-preview-text" tabIndex={0}>
            {current.text}
          </pre>
          {current.truncated && (
            <p className="snapshot-preview-note">Showing the start of this file.</p>
          )}
        </>
      ) : (
        current?.note && <p className="snapshot-preview-note">{current.note}</p>
      )}
      <footer>
        <p>
          {sent
            ? 'Sent with this message. JAM Code keeps its own copy with the conversation.'
            : image
              ? 'A copy kept by JAM Code. It is sent as an image when you press Send.'
              : 'A copy kept by JAM Code. When you press Send, the agent is told where the copy is and opens it itself.'}
        </p>
        <div className="attachment-preview-actions">
          {onReveal && revealLabel && (
            <button type="button" className="button quiet" onClick={() => onReveal(item)}>
              {revealLabel}
            </button>
          )}
          <button type="button" className="button" onClick={onClose}>
            Done
          </button>
        </div>
      </footer>
    </div>
  );
}
