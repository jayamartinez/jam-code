import { useEffect, useState } from 'react';
import { Check, ChevronRight, Copy, FolderOpen, Trash2, X } from 'lucide-react';
import { JamError, type ContextItem, type JamTransport } from '@jam/protocol';
import { Dialog, IconButton } from './Controls';
import { formatBytes, isRasterImage } from './attachment-model';

type View =
  | { kind: 'loading' }
  | { kind: 'image'; url: string }
  | { kind: 'pdf'; url: string }
  | { kind: 'text'; text: string; truncated: boolean }
  /** A type JAM Code does not draw. */
  | { kind: 'none' }
  /** The copy could not be read. */
  | { kind: 'gone' };

/**
 * The built-in viewer without its own toolbar. It fits a page to the frame by
 * itself; asking for `view=FitH` makes Edge's viewer fit to the window instead.
 */
const PDF_VIEW = '#toolbar=0';

/** A PDF data URL as an object URL: a frame cannot be given megabytes of URL. */
function pdfObjectUrl(dataUrl: string): string {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

const refused = (error: unknown) => error instanceof JamError && error.code === 'invalid_request';

/**
 * What the runtime's copy can be shown as. It decides by content: an image
 * or a PDF comes back whole, text comes back as its start, and anything else
 * has no preview. Nothing here is told where the file came from.
 */
function useAttachmentView(id: string | null, transport: Pick<JamTransport, 'request'>): View {
  const [loaded, setLoaded] = useState<{ id: string; view: View }>();
  useEffect(() => {
    if (!id) return;
    let disposed = false;
    let objectUrl: string | undefined;
    const show = (view: View) => {
      if (!disposed) setLoaded({ id, view });
    };
    void (async () => {
      try {
        const { dataUrl } = await transport.request('attachment.asset', { id });
        if (disposed) return;
        if (dataUrl.startsWith('data:application/pdf;')) {
          objectUrl = pdfObjectUrl(dataUrl);
          show({ kind: 'pdf', url: objectUrl });
        } else show({ kind: 'image', url: dataUrl });
        return;
      } catch (error) {
        if (!refused(error)) return show({ kind: 'gone' });
      }
      try {
        const { text, truncated } = await transport.request('attachment.text', { id });
        show({ kind: 'text', text, truncated });
      } catch (error) {
        show({ kind: refused(error) ? 'none' : 'gone' });
      }
    })();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, transport]);
  return loaded?.id === id ? loaded.view : { kind: 'loading' };
}

/** Copies the shown text, and says so for a moment. */
function CopyAction({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => {})
      }
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </IconButton>
  );
}

/**
 * An attachment opened from its chip, from a sent message or from its name
 * in a reply (Paper, "24 · Attachment preview"). An image opens as a
 * lightbox: the picture over the scrim, its name beneath. Every other file
 * opens in a viewer with one header row (where it is, its name and size,
 * then icon actions) and the document filling the rest: a PDF in the
 * web view's own viewer, text as text.
 */
export function AttachmentPreview({
  item,
  sent,
  transport,
  revealLabel,
  onReveal,
  onRemove,
  onClose,
}: {
  item: ContextItem;
  /** It is part of a message already, rather than waiting for Send. */
  sent: boolean;
  transport: Pick<JamTransport, 'request'>;
  /** The platform's name for showing a file in its folder. */
  revealLabel: string;
  onReveal(item: ContextItem): void;
  /** Takes a staged attachment off the draft. */
  onRemove?(item: ContextItem): void;
  onClose(): void;
}) {
  const info = item.attachment;
  const view = useAttachmentView(info && item.assetId ? item.assetId : null, transport);
  // Known before anything loads, so the dialog does not change shape.
  const lightbox =
    view.kind === 'image' || (view.kind === 'loading' && isRasterImage(info?.mediaType));

  if (lightbox)
    return (
      <Dialog title={item.label} className="attachment-lightbox" onClose={onClose}>
        <figure>
          <IconButton label="Close" className="icon-button lightbox-close" onClick={onClose}>
            <X size={14} />
          </IconButton>
          {view.kind === 'image' ? (
            <img src={view.url} alt={item.label} />
          ) : (
            <span className="lightbox-loading">Loading…</span>
          )}
          <figcaption>{item.label}</figcaption>
        </figure>
      </Dialog>
    );

  return (
    <Dialog
      title={item.label}
      className={`attachment-viewer ${view.kind === 'pdf' ? 'document' : ''}`}
      onClose={onClose}
    >
      <header className="attachment-viewer-bar">
        <span className="attachment-viewer-origin">{sent ? 'Attachment' : 'Draft'}</span>
        <ChevronRight size={13} aria-hidden="true" />
        <strong className="truncate">{item.label}</strong>
        {info && <span className="attachment-viewer-size">{formatBytes(info.bytes)}</span>}
        <span className="attachment-viewer-actions">
          {view.kind === 'text' && (
            <CopyAction
              text={view.text}
              label={view.truncated ? 'Copy what is shown' : 'Copy contents'}
            />
          )}
          <IconButton label={revealLabel} onClick={() => onReveal(item)}>
            <FolderOpen size={14} />
          </IconButton>
          {onRemove && (
            <IconButton label="Remove from draft" onClick={() => onRemove(item)}>
              <Trash2 size={14} />
            </IconButton>
          )}
          <IconButton label="Close" autoFocus onClick={onClose}>
            <X size={14} />
          </IconButton>
        </span>
      </header>
      {view.kind === 'text' && view.truncated && (
        <p className="attachment-viewer-notice">
          Showing the first 256 KB. {revealLabel} to open the whole file.
        </p>
      )}
      {view.kind === 'pdf' ? (
        // The web view's own PDF viewer needs an unsandboxed frame. The frame
        // is only ever given a blob of bytes the runtime recognized as a PDF.
        <iframe
          className="attachment-viewer-frame"
          title={item.label}
          src={`${view.url}${PDF_VIEW}`}
        />
      ) : view.kind === 'text' ? (
        // Text only: attached content is never rendered as HTML.
        <pre className="attachment-viewer-text" tabIndex={0}>
          {view.text}
        </pre>
      ) : (
        <div className="attachment-viewer-empty">
          {view.kind === 'loading' ? (
            <p>Loading…</p>
          ) : view.kind === 'gone' ? (
            <strong>This file is no longer available</strong>
          ) : (
            <>
              <strong>No preview for this file</strong>
              <p>{revealLabel} to open it in another app.</p>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
