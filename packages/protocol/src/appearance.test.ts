import { describe, expect, it } from 'vitest';
import languageCases from '../fixtures/languages.json';
import { APPEARANCE, DEFAULT_APPEARANCE, type AppearanceSettings } from './appearance';
import { previewLanguage } from './preview-files';
import { BrowserPreviewTransport } from './preview';
import { validateRequest, validateResponse } from './validation';

const update = (appearance: unknown) =>
  validateRequest({ protocolVersion: 1, method: 'appearance.update', params: { appearance } });

describe('appearance contract', () => {
  it('accepts the shared defaults and every listed theme and accent', () => {
    expect(() => update(DEFAULT_APPEARANCE)).not.toThrow();
    for (const theme of APPEARANCE.themes)
      expect(() => update({ ...DEFAULT_APPEARANCE, theme })).not.toThrow();
    for (const accent of APPEARANCE.accents)
      expect(() => update({ ...DEFAULT_APPEARANCE, accent })).not.toThrow();
    expect(() => update({ ...DEFAULT_APPEARANCE, paneOpacity: 90 })).not.toThrow();
  });

  it('rejects unknown names, malformed colours, unsafe font names and out-of-range values', () => {
    const bad: Partial<Record<keyof AppearanceSettings, unknown>>[] = [
      { theme: 'neon' },
      { accent: 'chartreuse' },
      { background: 'video' },
      { customAccent: '#FFF' },
      { gradientFrom: 'red' },
      { codeFont: "x'; } body { color: red" },
      { uiFont: 'a'.repeat(65) },
      { uiFontSize: 40 },
      { codeLineHeight: 9 },
      { paneOpacity: 5 },
      { paneOpacity: null },
      { backgroundBlur: 1.5 },
    ];
    for (const change of bad) expect(() => update({ ...DEFAULT_APPEARANCE, ...change })).toThrow();
    expect(() => update({ ...DEFAULT_APPEARANCE, surprise: true })).toThrow();
    const partial: Partial<AppearanceSettings> = { ...DEFAULT_APPEARANCE };
    delete partial.theme;
    expect(() => update(partial)).toThrow();
  });

  it('accepts only bounded inline JPEG, PNG or WebP wallpapers', () => {
    const set = (wallpaper: unknown) =>
      validateRequest({
        protocolVersion: 1,
        method: 'appearance.setWallpaper',
        params: { wallpaper },
      });
    const valid = {
      dataUrl: 'data:image/webp;base64,UklGRg==',
      name: 'dunes.webp',
      width: 10,
      height: 10,
    };
    expect(() => set(valid)).not.toThrow();
    expect(() =>
      validateRequest({ protocolVersion: 1, method: 'appearance.setWallpaper', params: {} }),
    ).not.toThrow();
    expect(() => set({ ...valid, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow();
    expect(() => set({ ...valid, dataUrl: 'https://example.com/a.jpg' })).toThrow();
    expect(() => set({ ...valid, dataUrl: 'data:image/png;base64,<script>' })).toThrow();
    expect(() => set({ ...valid, width: APPEARANCE.limits.wallpaperPixels + 1 })).toThrow();
    expect(() => set(null)).toThrow();
  });

  it('round-trips through the preview transport without claiming persistence', async () => {
    const transport = new BrowserPreviewTransport();
    expect(await transport.request('appearance.get', {})).toEqual({});
    const appearance = { ...DEFAULT_APPEARANCE, theme: 'linen' as const };
    await transport.request('appearance.update', { appearance });
    expect((await transport.request('appearance.get', {})).appearance).toEqual(appearance);
    expect(() => validateResponse('appearance.get', { appearance: { theme: 'linen' } })).toThrow();
  });
});

describe('language detection', () => {
  it('agrees with the runtime on every shared case', () => {
    for (const [path, language] of languageCases.cases as [string, string][])
      expect(previewLanguage(path!), path).toBe(language);
  });
});
