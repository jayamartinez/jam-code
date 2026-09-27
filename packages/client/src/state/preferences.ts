import { useCallback, useEffect, useState } from 'react';

/**
 * Client-owned reader preferences that describe behaviour in this browser
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
