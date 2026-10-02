// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JamError, type ContextItem } from '@jam/protocol';
import { AttachmentPreview } from './AttachmentPreview';

let root: Root;
const revoked: string[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The frame is only inspected here; nothing should try to load it.
  (
    window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
  ).happyDOM.settings.disableIframePageLoading = true;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:jam/pdf-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  revoked.length = 0;
  vi.restoreAllMocks();
});

const attachment = (name: string, mediaType: string, kind: 'file' | 'image'): ContextItem => ({
  id: 'attachment-1',
  kind: 'attachment',
  label: name,
  source: {},
  assetId: 'attachment-1',
  attachment: { name, mediaType, kind, bytes: 105_472 },
});
const notShown = () => Promise.reject(new JamError('invalid_request', 'Not shown this way.'));

/** Opens the preview over a runtime that answers each request as given. */
async function open(
  item: ContextItem,
  answers: { asset?: () => Promise<unknown>; text?: () => Promise<unknown> },
  staged = false,
) {
  const request = vi.fn((method: string) =>
    method === 'attachment.asset' ? (answers.asset ?? notShown)() : (answers.text ?? notShown)(),
  );
  const handlers = { onReveal: vi.fn(), onRemove: vi.fn(), onClose: vi.fn() };
  await act(async () => {
    root.render(
      createElement(AttachmentPreview, {
        item,
        sent: !staged,
        transport: { request } as never,
        revealLabel: 'Show in Explorer',
        onReveal: handlers.onReveal,
        ...(staged ? { onRemove: handlers.onRemove } : {}),
        onClose: handlers.onClose,
      }),
    );
  });
  const dialog = document.querySelector('dialog')!;
  const button = (label: string) =>
    dialog.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { dialog, button, request, ...handlers };
}

describe('attachment preview', () => {
  it('shows an image as a lightbox with its name beneath', async () => {
    const dataUrl = 'data:image/png;base64,AAAA';
    const { dialog, button, onClose } = await open(attachment('wall.png', 'image/png', 'image'), {
      asset: () => Promise.resolve({ dataUrl }),
    });
    expect(dialog.className).toContain('attachment-lightbox');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(dataUrl);
    expect(dialog.querySelector('figcaption')?.textContent).toBe('wall.png');
    // A lightbox has no file actions, only a way out.
    expect(button('Show in Explorer')).toBeNull();
    act(() => button('Close')!.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows a PDF in a frame from an object URL, and releases it', async () => {
    const { dialog, button, onReveal } = await open(
      attachment('Resume.pdf', 'application/pdf', 'file'),
      { asset: () => Promise.resolve({ dataUrl: 'data:application/pdf;base64,JVBERi0=' }) },
    );
    expect(dialog.className).toContain('attachment-viewer document');
    const frame = dialog.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe('blob:jam/pdf-1#toolbar=0');
    expect(frame.getAttribute('title')).toBe('Resume.pdf');
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBe(5);
    expect(dialog.querySelector('.attachment-viewer-bar')?.textContent).toContain(
      'AttachmentResume.pdf103 KB',
    );
    // Sent: it can be shown in its folder, never removed.
    expect(button('Remove from draft')).toBeNull();
    act(() => button('Show in Explorer')!.click());
    expect(onReveal).toHaveBeenCalledOnce();
    act(() => root.render(null));
    expect(revoked).toEqual(['blob:jam/pdf-1']);
  });

  it('shows text as text, never as markup, and says when it is cut short', async () => {
    const text = '<script>alert(1)</script>\nline two';
    const { dialog, button, request, onRemove } = await open(
      attachment('page.html', 'text/html', 'file'),
      { text: () => Promise.resolve({ text, truncated: true }) },
      true,
    );
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'attachment.asset',
      'attachment.text',
    ]);
    expect(dialog.querySelector('pre')?.textContent).toBe(text);
    expect(dialog.querySelector('script, iframe')).toBeNull();
    expect(dialog.querySelector('.attachment-viewer-notice')?.textContent).toContain('256 KB');
    expect(dialog.querySelector('.attachment-viewer-origin')?.textContent).toBe('Draft');
    expect(button('Copy what is shown')).not.toBeNull();
    act(() => button('Remove from draft')!.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('says so when a type has no preview, and when the copy is gone', async () => {
    const zip = attachment('archive.zip', 'application/zip', 'file');
    const none = await open(zip, {});
    expect(none.dialog.textContent).toContain('No preview for this file');
    expect(none.dialog.textContent).toContain('Show in Explorer to open it in another app.');
    const gone = await open(zip, {
      asset: () => Promise.reject(new JamError('not_found', 'Attachment not found.')),
    });
    expect(gone.dialog.textContent).toContain('This file is no longer available');
    // A missing copy is not asked for again as text.
    expect(gone.request).toHaveBeenCalledTimes(1);
  });
});
