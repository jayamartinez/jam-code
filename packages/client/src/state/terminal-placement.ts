import { useCallback, useSyncExternalStore } from 'react';

/**
 * Where Open terminal puts a new terminal: a pane beside the one you're in,
 * on the side you choose, or a tab of its own. A client preference, shared
 * by every reader.
 */
export type TerminalPlacement = 'below' | 'above' | 'right' | 'left' | 'tab';

export const TERMINAL_PLACEMENTS: { value: TerminalPlacement; label: string }[] = [
  { value: 'below', label: 'Below' },
  { value: 'above', label: 'Above' },
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
  { value: 'tab', label: 'New tab' },
];

const KEY = 'jam.terminalPlacement';
const listeners = new Set<() => void>();
let current: TerminalPlacement | null = null;

function read(): TerminalPlacement {
  if (current) return current;
  try {
    const stored = localStorage.getItem(KEY);
    current = TERMINAL_PLACEMENTS.some((item) => item.value === stored)
      ? (stored as TerminalPlacement)
      : 'below';
  } catch {
    current = 'below';
  }
  return current;
}

export function useTerminalPlacement(): [TerminalPlacement, (next: TerminalPlacement) => void] {
  const placement = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => 'below' as const,
  );
  const update = useCallback((next: TerminalPlacement) => {
    current = next;
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Losing the choice only restores Below.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [placement, update];
}

/** The split that places a terminal, or null for a tab of its own. */
export function terminalSplit(placement: TerminalPlacement) {
  switch (placement) {
    case 'below':
      return { direction: 'column' as const, before: false, ratio: 0.68 };
    case 'above':
      return { direction: 'column' as const, before: true, ratio: 0.32 };
    case 'right':
      return { direction: 'row' as const, before: false, ratio: 0.6 };
    case 'left':
      return { direction: 'row' as const, before: true, ratio: 0.4 };
    case 'tab':
      return null;
  }
}
