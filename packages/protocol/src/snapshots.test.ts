import { describe, expect, it } from 'vitest';
import { validateRequest, validateResponse } from './validation';
import { BrowserPreviewTransport } from './preview';
const settings = {
  enabled: true,
  shortcut: { kind: 'doubleShift' },
  captureMode: 'activeWindow',
  afterCapture: 'stage',
  flash: true,
  sound: true,
  toast: true,
  copyToClipboard: false,
  retentionDays: 7,
};
const request = (method: string, params: unknown) =>
  validateRequest({ protocolVersion: 1, method, params });
describe('snapshot boundary', () => {
  it('accepts explicit inbox staging and bounded settings', () => {
    expect(request('snapshot.stage', { id: 'snapshot-1', resourceId: null, note: '' }).method).toBe(
      'snapshot.stage',
    );
    expect(validateResponse('snapshot.settings.get', settings)).toEqual(settings);
    expect(() => request('snapshot.settings.update', { ...settings, retentionDays: 0 })).toThrow();
    expect(() =>
      request('snapshot.stage', { id: 's', resourceId: null, note: 'x'.repeat(2001) }),
    ).toThrow();
  });
  it('rejects asset paths, unexpected fields and non-image responses', () => {
    expect(() =>
      request('snapshot.asset', { id: 's', path: '/private/file', thumbnail: true }),
    ).toThrow();
    expect(() => validateResponse('snapshot.asset', { dataUrl: 'file:///private/file' })).toThrow();
  });
  it('browser preview honestly rejects native capture storage', async () => {
    const transport = new BrowserPreviewTransport();
    await expect(transport.request('snapshot.list', {})).rejects.toThrow('desktop');
  });
});
