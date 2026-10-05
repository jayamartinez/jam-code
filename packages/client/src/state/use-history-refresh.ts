import { useEffect, useRef } from 'react';
import type { JamTransport } from '@jam/protocol';

/** The least time between two refreshes of one conversation. */
const GAP_MS = 10_000;

/**
 * Keeps past chats synced from an agent's own history current: each
 * conversation on screen is refreshed when it appears and when the window
 * regains focus, so one the reader kept using in Claude Code or Codex
 * catches up. The runtime reads it again only when the provider's record
 * changed, and leaves anything else alone; nothing refreshes on a timer.
 */
export function useHistoryRefresh(transport: JamTransport, resourceIds: readonly string[]) {
  const key = resourceIds.join('\n');
  const last = useRef(new Map<string, number>());
  useEffect(() => {
    const ids = key ? key.split('\n') : [];
    const refresh = () => {
      const now = Date.now();
      for (const resourceId of ids) {
        if (now - (last.current.get(resourceId) ?? 0) < GAP_MS) continue;
        last.current.set(resourceId, now);
        // A chat that cannot be refreshed keeps the copy JAM Code has.
        transport.request('providerHistory.refresh', { resourceId }).catch(() => undefined);
      }
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [transport, key]);
}
