// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JamTransport } from '@jam/protocol';
import { useHistoryRefresh } from './use-history-refresh';

let root: Root;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  request = vi.fn(() => Promise.resolve({ refreshed: false }));
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

function Probe({ resourceIds }: { resourceIds: string[] }) {
  useHistoryRefresh({ request } as unknown as JamTransport, resourceIds);
  return null;
}

/** Shows these conversations, re-rendering the same component. */
function show(resourceIds: string[]) {
  act(() => root.render(createElement(Probe, { resourceIds })));
}

const refreshed = () =>
  request.mock.calls.map(
    ([method, params]) => `${method} ${(params as { resourceId: string }).resourceId}`,
  );

describe('refreshing past chats on screen', () => {
  it('refreshes each conversation when it appears, and again on focus after a pause', () => {
    show(['conversation-a', 'conversation-b']);
    expect(refreshed()).toEqual([
      'providerHistory.refresh conversation-a',
      'providerHistory.refresh conversation-b',
    ]);
    // Focus right away asks nothing again.
    window.dispatchEvent(new Event('focus'));
    expect(request).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(11_000);
    window.dispatchEvent(new Event('focus'));
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('refreshes a conversation once as panes change around it, and never on a timer', () => {
    show(['conversation-a']);
    show(['conversation-a', 'conversation-b']);
    expect(refreshed()).toEqual([
      'providerHistory.refresh conversation-a',
      'providerHistory.refresh conversation-b',
    ]);
    vi.advanceTimersByTime(10 * 60_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps going when a refresh fails', async () => {
    request.mockImplementation(() => Promise.reject(new Error('unavailable')));
    show(['conversation-a']);
    await act(async () => undefined);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
