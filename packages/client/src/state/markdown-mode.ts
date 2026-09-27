import { useCallback, useSyncExternalStore } from 'react';

/**
 * Preview or Source, per Markdown file resource, for this session.
 *
 * Presentation state, so it belongs to the client, and it lives outside any
 * pane: reshaping the layout remounts panes, and a reader who chose Source
 * should still see Source afterwards. Preview is the default because agents
 * write reports and plans to be read.
 */
export type MarkdownMode = 'preview' | 'source';

const modes = new Map<string, MarkdownMode>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useMarkdownMode(resourceId: string): [MarkdownMode, (mode: MarkdownMode) => void] {
  const mode = useSyncExternalStore(
    subscribe,
    () => modes.get(resourceId) ?? 'preview',
    () => 'preview' as const,
  );
  const set = useCallback(
    (next: MarkdownMode) => {
      modes.set(resourceId, next);
      listeners.forEach((listener) => listener());
    },
    [resourceId],
  );
  return [mode, set];
}
