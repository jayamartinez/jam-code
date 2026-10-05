import { useCallback, useEffect, useState } from 'react';

/**
 * Client-owned reader preferences that describe behavior in this browser
 * profile. Appearance is not here: it is a runtime setting (see `appearance/`).
 */

/** Days of inactivity before JAM asks whether to close a thread; null never asks. */
export const IDLE_THREAD_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'After 1 day', value: 1 },
  { label: 'After 3 days', value: 3 },
  { label: 'After 7 days', value: 7 },
  { label: 'After 14 days', value: 14 },
  { label: 'After 30 days', value: 30 },
  { label: 'Never', value: null },
];
const IDLE_THREAD_KEY = 'jam.idleThreadDays';
const DEFAULT_IDLE_THREAD_DAYS = 7;

function readIdleDays(): number | null {
  try {
    const stored = localStorage.getItem(IDLE_THREAD_KEY);
    if (stored === null) return DEFAULT_IDLE_THREAD_DAYS;
    const value: unknown = JSON.parse(stored);
    return IDLE_THREAD_OPTIONS.some((option) => option.value === value)
      ? (value as number | null)
      : DEFAULT_IDLE_THREAD_DAYS;
  } catch {
    return DEFAULT_IDLE_THREAD_DAYS;
  }
}

const STREAM_REPLIES_KEY = 'jam.streamReplies';

/** Whether agent replies are revealed as they stream (on by default). */
export function useStreamReplies(): [boolean, (next: boolean) => void] {
  const [stream, setStream] = useState(true);
  useEffect(() => {
    try {
      setStream(localStorage.getItem(STREAM_REPLIES_KEY) !== 'false');
    } catch {
      // Unreadable storage keeps the default.
    }
  }, []);
  const update = useCallback((next: boolean) => {
    setStream(next);
    try {
      localStorage.setItem(STREAM_REPLIES_KEY, String(next));
    } catch {
      // Losing the preference only restores the default.
    }
  }, []);
  return [stream, update];
}

/** How message times and dividers read; `system` follows the computer's locale. */
export type TimeFormat = 'system' | '12h' | '24h';
export const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: '12h', label: '12-hour' },
  { value: '24h', label: '24-hour' },
];
const TIME_FORMAT_KEY = 'jam.timeFormat';

export function readTimeFormat(stored: string | null): TimeFormat {
  return TIME_FORMAT_OPTIONS.find((option) => option.value === stored)?.value ?? 'system';
}

export function useTimeFormat(): [TimeFormat, (next: TimeFormat) => void] {
  const [format, setFormat] = useState<TimeFormat>('system');
  useEffect(() => {
    try {
      setFormat(readTimeFormat(localStorage.getItem(TIME_FORMAT_KEY)));
    } catch {
      // Unreadable storage keeps the default.
    }
  }, []);
  const update = useCallback((next: TimeFormat) => {
    setFormat(next);
    try {
      localStorage.setItem(TIME_FORMAT_KEY, next);
    } catch {
      // Losing the preference only restores the default.
    }
  }, []);
  return [format, update];
}

/**
 * What Send does while the agent works: queue the message for after the
 * current turn, or steer it into the running turn where the agent can take
 * one. The other action is one shortcut away (Settings → Keybindings).
 */
export type FollowUp = 'queue' | 'steer';
export const FOLLOW_UP_OPTIONS: { value: FollowUp; label: string; description: string }[] = [
  { value: 'queue', label: 'Queue', description: 'Send it when the current turn finishes.' },
  {
    value: 'steer',
    label: 'Steer',
    description: 'Send it into the running turn, where the agent can take one.',
  },
];
const FOLLOW_UP_KEY = 'jam.followUp';

export function readFollowUp(stored: string | null): FollowUp {
  return stored === 'steer' ? 'steer' : 'queue';
}

export function useFollowUp(): [FollowUp, (next: FollowUp) => void] {
  const [mode, setMode] = useState<FollowUp>('queue');
  useEffect(() => {
    try {
      setMode(readFollowUp(localStorage.getItem(FOLLOW_UP_KEY)));
    } catch {
      // Unreadable storage keeps the default.
    }
  }, []);
  const update = useCallback((next: FollowUp) => {
    setMode(next);
    try {
      localStorage.setItem(FOLLOW_UP_KEY, next);
    } catch {
      // Losing the preference only restores the default.
    }
  }, []);
  return [mode, update];
}

export function useIdleThreadDays(): [number | null, (next: number | null) => void] {
  const [days, setDays] = useState<number | null>(DEFAULT_IDLE_THREAD_DAYS);
  useEffect(() => setDays(readIdleDays()), []);
  const update = useCallback((next: number | null) => {
    setDays(next);
    try {
      localStorage.setItem(IDLE_THREAD_KEY, JSON.stringify(next));
    } catch {
      // Losing the preference only restores the default.
    }
  }, []);
  return [days, update];
}

/**
 * How tall the sidebar's History is: `auto` takes the height the other
 * sections leave, `all` grows to show every chat without scrolling inside,
 * and a number is the height in pixels the reader dragged it to. A pixel size
 * belongs to this window, so it is kept here rather than in the runtime.
 */
export type HistoryHeight = 'auto' | 'all' | number;
/** The least History can be dragged to: its heading, filters and a chat or two. */
export const HISTORY_MIN_HEIGHT = 160;
const HISTORY_HEIGHT_KEY = 'jam.historyHeight';

export function readHistoryHeight(stored: string | null): HistoryHeight {
  if (stored === 'all') return 'all';
  const pixels = Number(stored);
  return stored && Number.isFinite(pixels)
    ? Math.max(HISTORY_MIN_HEIGHT, Math.round(pixels))
    : 'auto';
}

export function useHistoryHeight(): [HistoryHeight, (next: HistoryHeight) => void] {
  const [height, setHeight] = useState<HistoryHeight>('auto');
  useEffect(() => {
    try {
      setHeight(readHistoryHeight(localStorage.getItem(HISTORY_HEIGHT_KEY)));
    } catch {
      // Unreadable storage keeps the default.
    }
  }, []);
  const update = useCallback((next: HistoryHeight) => {
    setHeight(next);
    try {
      localStorage.setItem(HISTORY_HEIGHT_KEY, String(next));
    } catch {
      // Losing the preference only restores the default.
    }
  }, []);
  return [height, update];
}

/**
 * Where a new chat starts: the current checkout, a new worktree, or neither
 * until the reader picks one ("Ask each time").
 */
export type NewThreadWorkspace = 'checkout' | 'worktree' | 'ask';
const NEW_THREAD_WORKSPACE_KEY = 'jam.newThreadWorkspace';

function readNewThreadWorkspace(): NewThreadWorkspace {
  try {
    const stored = localStorage.getItem(NEW_THREAD_WORKSPACE_KEY);
    return stored === 'worktree' || stored === 'ask' ? stored : 'checkout';
  } catch {
    return 'checkout';
  }
}

export function useNewThreadWorkspace(): [NewThreadWorkspace, (next: NewThreadWorkspace) => void] {
  const [choice, setChoice] = useState<NewThreadWorkspace>('checkout');
  useEffect(() => setChoice(readNewThreadWorkspace()), []);
  const update = useCallback((next: NewThreadWorkspace) => {
    setChoice(next);
    try {
      localStorage.setItem(NEW_THREAD_WORKSPACE_KEY, next);
    } catch {
      // Losing the preference only restores the default.
    }
  }, []);
  return [choice, update];
}
