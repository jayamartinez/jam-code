import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE, type JamTransport } from '@jam/protocol';
import { BrowserPreviewTransport } from '@jam/protocol/preview';
import { AppearanceStore } from './store';

afterEach(() => vi.useRealTimers());

describe('AppearanceStore', () => {
  it('applies changes at once and writes only the last of a burst to the runtime', async () => {
    vi.useFakeTimers();
    const transport = new BrowserPreviewTransport();
    const request = vi.spyOn(transport, 'request');
    const store = new AppearanceStore(transport);
    await store.load();
    expect(store.getSnapshot().loaded).toBe(true);

    for (const size of [13, 14, 15, 16, 18]) store.update({ codeFontSize: size });
    expect(store.getSnapshot().appearance.codeFontSize).toBe(18);
    expect(request.mock.calls.filter(([method]) => method === 'appearance.update')).toHaveLength(0);

    await vi.runAllTimersAsync();
    const writes = request.mock.calls.filter(([method]) => method === 'appearance.update');
    expect(writes).toHaveLength(1);
    const { appearance } = await transport.request('appearance.get', {});
    expect(appearance?.codeFontSize).toBe(18);
  });

  it('restores the stored record on the next start and clamps what it cannot accept', async () => {
    vi.useFakeTimers();
    const transport = new BrowserPreviewTransport();
    const first = new AppearanceStore(transport);
    await first.load();
    first.update({ theme: 'linen', accent: 'emerald', paneOpacity: 90 });
    first.flush();
    await vi.runAllTimersAsync();

    const second = new AppearanceStore(transport);
    await second.load();
    expect(second.getSnapshot().appearance).toMatchObject({
      theme: 'linen',
      accent: 'emerald',
      paneOpacity: 90,
    });

    second.update({ paneOpacity: undefined, uiFontSize: 400 });
    expect(second.getSnapshot().appearance.paneOpacity).toBeUndefined();
    expect(second.getSnapshot().appearance.uiFontSize).toBe(15);
  });

  it('keeps the reader’s change when the runtime answers late, and reports failed saves', async () => {
    vi.useFakeTimers();
    let answer: (value: unknown) => void = () => {};
    const transport = {
      request: vi.fn((method: string) =>
        method === 'appearance.get'
          ? new Promise((resolve) => (answer = resolve))
          : Promise.reject(new Error('disk full')),
      ),
    } as unknown as JamTransport;
    const store = new AppearanceStore(transport);
    const loading = store.load();
    store.update({ theme: 'oled' });
    answer({ appearance: { ...DEFAULT_APPEARANCE, theme: 'frost' } });
    await loading;
    expect(store.getSnapshot().appearance.theme).toBe('oled');
    await vi.runAllTimersAsync();
    expect(store.getSnapshot().error).toBe('disk full');
  });
});
