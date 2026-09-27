import type {
  BrowserAction,
  BrowserBounds,
  BrowserHost,
  BrowserHostEvent,
  BrowserPageState,
} from '@jam/client';
import { Channel, invoke } from '@tauri-apps/api/core';

type WireState = Omit<BrowserPageState, 'canGoBack' | 'canGoForward' | 'blocked'> & {
  canGoBack?: boolean | null;
  canGoForward?: boolean | null;
  blocked?: string | null;
};
type WireEvent =
  | { type: 'state'; state: WireState }
  | { type: 'annotated'; annotation: unknown }
  | { type: 'annotateEnded' };

const normalize = (state: WireState): BrowserPageState => ({
  url: state.url,
  title: state.title,
  loading: state.loading,
  canGoBack: state.canGoBack ?? null,
  canGoForward: state.canGoForward ?? null,
  blocked: state.blocked ?? null,
});

/** Whole pixels: fractional edges make the native view shimmer while resizing. */
const round = (bounds: BrowserBounds | null) =>
  bounds && {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };

/** The host rejects with a plain message; surface it rather than a generic one. */
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw cause instanceof Error ? cause : new Error(String(cause));
  }
}

/** Native child webviews, owned by the desktop host's `browser` module. */
export function createBrowserHost(): BrowserHost {
  return {
    async attach(resourceId, bounds, listener) {
      const channel = new Channel<WireEvent>();
      channel.onmessage = (event) => {
        if (event.type === 'state') listener({ type: 'state', state: normalize(event.state) });
        else listener(event as BrowserHostEvent);
      };
      const state = await call<WireState>('browser_attach', {
        resourceId,
        bounds: round(bounds),
        onEvent: channel,
      });
      return normalize(state);
    },
    setBounds: (resourceId, bounds) =>
      call('browser_bounds', { resourceId, bounds: round(bounds) }),
    navigate: (resourceId, url) => call('browser_navigate', { resourceId, url }),
    action: (resourceId, action: BrowserAction) => call('browser_action', { resourceId, action }),
    close: (resourceId) => call('browser_close', { resourceId }),
  };
}
