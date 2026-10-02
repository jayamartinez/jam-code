import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  validateRequest,
  validateResponse,
  type ContextItem,
  type ProviderDescriptor,
} from '@jam/protocol';
import {
  attachmentDetail,
  formatBytes,
  imagesRefused,
  refusalMessage,
  sendsImage,
} from './attachment-model';

const attachment = (kind: 'file' | 'image', mediaType: string, bytes = 18_432): ContextItem => ({
  id: 'attachment-1',
  kind: 'attachment',
  label: 'failure.png',
  source: {},
  assetId: 'attachment-1',
  attachment: { name: 'failure.png', mediaType, kind, bytes },
});
const text = attachment('file', 'text/plain');
const image = attachment('image', 'image/png');
const snapshot: ContextItem = { id: 's', kind: 'snapshot', label: 'Snapshot', source: {} };
const file: ContextItem = { id: 'f', kind: 'file', label: 'registry.ts', source: {} };

const provider = (
  images: 'supported' | 'unsupported' | 'unknown',
  capability: 'supported' | 'unsupported' | 'conditional' = 'conditional',
): ProviderDescriptor =>
  ({
    id: 'codex',
    name: 'Codex',
    capabilities: { images: { status: capability } },
    models: [
      { id: 'default', label: 'Default', isDefault: true, images },
      { id: 'vision', label: 'Vision', images: 'supported' },
      { id: 'text-only', label: 'Text only', images: 'unsupported' },
    ],
  }) as unknown as ProviderDescriptor;

describe('attachment display', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(18_432)).toBe('18 KB');
    expect(formatBytes(1_468_006)).toBe('1.4 MB');
    expect(formatBytes(12 * 1024 * 1024)).toBe('12 MB');
  });

  it('describes a sent attachment by type or size', () => {
    expect(attachmentDetail(image)).toBe('PNG');
    expect(attachmentDetail(attachment('image', 'image/webp'))).toBe('WebP');
    expect(attachmentDetail(text)).toBe('18 KB');
    expect(attachmentDetail(file)).toBe('');
  });

  it('names each file the chooser would not attach, with its reason', () => {
    expect(
      refusalMessage([
        { name: 'notes', reason: 'Folders can’t be attached.' },
        { name: 'huge.png', reason: 'The file is too large.' },
      ]),
    ).toBe(
      'notes was not attached: Folders can’t be attached. huge.png was not attached: The file is too large.',
    );
  });
});

describe('image capability gating', () => {
  it('knows which context reaches the agent as an image', () => {
    expect([image, snapshot, text, file].map(sendsImage)).toEqual([true, true, false, false]);
  });

  it('refuses staged images only when the agent or the chosen model cannot take them', () => {
    expect(imagesRefused(provider('unsupported'), {}, [image])).toMatch(
      /Codex does not accept images with this model/,
    );
    expect(imagesRefused(provider('supported'), { model: 'text-only' }, [snapshot])).not.toBeNull();
    expect(imagesRefused(provider('supported', 'unsupported'), {}, [image])).not.toBeNull();
    // A model that takes images, or one that does not say, is not refused.
    expect(imagesRefused(provider('unsupported'), { model: 'vision' }, [image])).toBeNull();
    expect(imagesRefused(provider('unknown'), {}, [image])).toBeNull();
    expect(imagesRefused(provider('supported'), {}, [image, text])).toBeNull();
  });

  it('never refuses text, the demo provider or an agent that has not been checked', () => {
    // A PDF or a log is opened by the agent itself, whatever the model sees.
    expect(imagesRefused(provider('unsupported'), {}, [text, file])).toBeNull();
    expect(imagesRefused(undefined, {}, [image])).toBeNull();
    expect(imagesRefused({ ...provider('unsupported'), id: 'mock' }, {}, [image])).toBeNull();
  });
});

describe('the attachment contract', () => {
  it('shares its limits with the runtime through one fixture', () => {
    expect(ATTACHMENT_LIMITS).toEqual({
      filesPerPick: 16,
      imageBytes: 5 * 1024 * 1024,
      fileBytes: 25 * 1024 * 1024,
      turnImageBytes: 12 * 1024 * 1024,
      turnBytes: 100 * 1024 * 1024,
      nameUtf16: 120,
      unsentFiles: 64,
      unsentHours: 24,
    });
  });

  it('accepts attachment context in a Send and rejects malformed metadata', () => {
    const send = (context: unknown[]) =>
      validateRequest({
        protocolVersion: 1,
        method: 'turn.start',
        params: { resourceId: 'conv', text: '', context, requestId: 'r' },
      });
    expect(() => send([text, image])).not.toThrow();
    for (const bad of [
      { ...text, attachment: { ...text.attachment, kind: 'binary' } },
      { ...text, attachment: { ...text.attachment, bytes: -1 } },
      { ...text, attachment: { ...text.attachment, path: 'C:\\Users\\someone\\secret.txt' } },
      { ...text, attachment: { name: 'x' } },
      { ...text, path: '/etc/passwd' },
    ])
      expect(() => send([bad])).toThrow();
  });

  it('addresses attachment assets by ID and accepts only raster image previews', () => {
    for (const method of ['attachment.remove', 'attachment.asset'] as const) {
      expect(() =>
        validateRequest({ protocolVersion: 1, method, params: { id: 'attachment-1' } }),
      ).not.toThrow();
      expect(() =>
        validateRequest({
          protocolVersion: 1,
          method,
          params: { id: 'attachment-1', path: '/etc/passwd' },
        }),
      ).toThrow();
    }
    const asset = (dataUrl: string) => validateResponse('attachment.asset', { dataUrl });
    expect(() => asset('data:image/png;base64,AAAA')).not.toThrow();
    expect(() => asset('data:image/webp;base64,AAAA')).not.toThrow();
    for (const hostile of [
      'data:image/svg+xml;base64,AAAA',
      'data:text/html;base64,AAAA',
      'https://example.com/a.png',
      'file:///C:/Users/someone/secret.png',
    ])
      expect(() => asset(hostile)).toThrow();
  });
});
