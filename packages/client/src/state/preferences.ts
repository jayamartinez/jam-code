import { useCallback, useEffect, useState } from 'react';

/**
 * Client-owned appearance preferences.
 *
 * These are presentation only and live in this browser profile, not in the
 * runtime: they describe how JAM draws, never what it stores. They are applied
 * as custom properties on the document so every surface — including the
 * CodeMirror theme — reads them from one place.
 */

export interface EditorPreferences {
  /** A family name, or `''` for JAM's bundled default. */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontFamily: '',
  fontSize: 12,
  lineHeight: 20,
};

/**
 * Families offered in Settings. JAM bundles only Geist Mono; the rest are
 * used when the reader already has them installed, so nothing is downloaded
 * and the list degrades to the next family in the stack.
 */
export const EDITOR_FONTS: { label: string; value: string; note?: string }[] = [
  { label: 'Geist Mono', value: '', note: 'Bundled with JAM' },
  { label: 'JetBrains Mono', value: 'JetBrains Mono', note: 'If installed' },
  { label: 'JetBrains Mono Nerd Font', value: 'JetBrainsMono Nerd Font', note: 'If installed' },
  { label: 'Fira Code', value: 'Fira Code', note: 'If installed' },
  { label: 'IBM Plex Mono', value: 'IBM Plex Mono', note: 'If installed' },
  { label: 'Cascadia Code', value: 'Cascadia Code', note: 'If installed' },
  { label: 'SF Mono', value: 'SF Mono', note: 'macOS' },
  { label: 'Menlo', value: 'Menlo', note: 'macOS' },
  { label: 'Consolas', value: 'Consolas', note: 'Windows' },
  { label: 'System monospace', value: 'ui-monospace', note: 'Whatever the OS picks' },
];

export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 15, 16];

const STORAGE_KEY = 'jam.editorPreferences';
/** JAM's own stack, always the tail so an unavailable choice still renders. */
const FALLBACK = `'Geist Mono Variable', var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace`;

function apply(preferences: EditorPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const family = preferences.fontFamily ? `'${preferences.fontFamily}', ${FALLBACK}` : FALLBACK;
  root.style.setProperty('--editor-font-family', family);
  root.style.setProperty('--editor-font-size', `${preferences.fontSize}px`);
  root.style.setProperty('--editor-line-height', `${preferences.lineHeight}px`);
}

function read(): EditorPreferences {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_EDITOR_PREFERENCES;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_EDITOR_PREFERENCES;
    const value = parsed as Partial<EditorPreferences>;
    return {
      fontFamily:
        typeof value.fontFamily === 'string' && value.fontFamily.length <= 64
          ? value.fontFamily
          : DEFAULT_EDITOR_PREFERENCES.fontFamily,
      fontSize:
        typeof value.fontSize === 'number' && value.fontSize >= 9 && value.fontSize <= 24
          ? value.fontSize
          : DEFAULT_EDITOR_PREFERENCES.fontSize,
      lineHeight:
        typeof value.lineHeight === 'number' && value.lineHeight >= 12 && value.lineHeight <= 40
          ? value.lineHeight
          : DEFAULT_EDITOR_PREFERENCES.lineHeight,
    };
  } catch {
    // Private windows and blocked storage simply keep the defaults.
    return DEFAULT_EDITOR_PREFERENCES;
  }
}

export function useEditorPreferences(): [EditorPreferences, (next: EditorPreferences) => void] {
  const [preferences, setPreferences] = useState(DEFAULT_EDITOR_PREFERENCES);

  useEffect(() => {
    const stored = read();
    setPreferences(stored);
    apply(stored);
  }, []);

  const update = useCallback((next: EditorPreferences) => {
    setPreferences(next);
    apply(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Losing the preference is acceptable; the editor still renders.
    }
  }, []);

  return [preferences, update];
}

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
