import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/provider-history.json';
import { BrowserPreviewTransport } from './preview';
import { validateRequest, validateResponse } from './validation';

const request = (method: string, params: unknown) =>
  validateRequest({ protocolVersion: 1, method, params });

describe('Provider history contract', () => {
  it('validates the entries the runtime sends, shared with its tests', () => {
    expect(validateResponse('providerHistory.list', fixture)).toEqual(fixture);
    expect(
      validateResponse('providerHistory.list', { ...fixture, cursor: '2026-09-01T10:00:00Z|h' }),
    ).toBeTruthy();
    const [synced] = fixture.entries;
    expect(validateResponse('providerHistory.ignore', { entry: synced })).toEqual({
      entry: synced,
    });
    for (const bad of [
      { ...synced, origin: 'imported' },
      { ...synced, providerId: 'other' },
      { ...synced, title: 'x'.repeat(257) },
      { ...synced, discoveredAt: 'yesterday' },
      // The provider's own ID is never part of an entry.
      { ...synced, nativeId: 'thread-1' },
    ]) {
      expect(() => validateResponse('providerHistory.list', { entries: [bad] })).toThrow();
    }
    expect(() =>
      validateResponse('providerHistory.list', {
        entries: Array.from({ length: 201 }, () => synced),
      }),
    ).toThrow();
  });

  it('addresses entries by JAM ID and bounds list pages', () => {
    expect(request('providerHistory.scan', { providerId: 'codex' })).toBeTruthy();
    expect(request('providerHistory.list', {})).toBeTruthy();
    expect(
      request('providerHistory.list', { providerId: 'claude', ignored: true, limit: 200 }),
    ).toBeTruthy();
    expect(request('providerHistory.sync', { historyId: 'history-1' })).toBeTruthy();
    expect(request('providerHistory.refresh', { resourceId: 'conversation-1' })).toBeTruthy();
    expect(() => request('providerHistory.refresh', { historyId: 'history-1' })).toThrow();
    expect(validateResponse('providerHistory.refresh', { refreshed: true })).toBeTruthy();
    expect(request('providerHistory.sync', { historyId: 'history-1', archive: true })).toBeTruthy();
    expect(() => request('providerHistory.sync', { historyId: 'history-1', archive: 1 })).toThrow();
    expect(
      request('providerHistory.associate', { historyId: 'history-1', projectId: 'project-jam' }),
    ).toBeTruthy();
    for (const [method, params] of [
      ['providerHistory.scan', { providerId: 'gemini' }],
      ['providerHistory.list', { limit: 0 }],
      ['providerHistory.list', { limit: 201 }],
      ['providerHistory.sync', { nativeId: 'thread-1' }],
      // A folder is never how an entry is linked; a trusted project is.
      ['providerHistory.associate', { historyId: 'history-1', path: '/work/jam' }],
      ['providerHistory.ignore', {}],
    ] as const) {
      expect(() => request(method, params)).toThrow();
    }
  });

  it('finds past chats for the folders a project is being made from', () => {
    expect(request('providerHistory.findInFolders', { paths: ['/work/jam'] })).toBeTruthy();
    for (const params of [
      { paths: [] },
      { paths: ['relative/jam'] },
      { paths: Array.from({ length: 17 }, (_, i) => `/work/${i}`) },
      { folder: '/work/jam' },
    ]) {
      expect(() => request('providerHistory.findInFolders', params)).toThrow();
    }
    expect(
      validateResponse('providerHistory.findInFolders', {
        entries: [fixture.entries[0]],
        total: 14,
      }),
    ).toBeTruthy();
    expect(() => validateResponse('providerHistory.findInFolders', { entries: [] })).toThrow();
  });

  it('is unavailable in the browser preview', async () => {
    const preview = new BrowserPreviewTransport();
    await expect(preview.request('providerHistory.scan', { providerId: 'codex' })).rejects.toThrow(
      'Provider history requires the desktop app.',
    );
  });
});
