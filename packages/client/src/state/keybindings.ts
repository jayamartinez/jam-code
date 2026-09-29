import { useCallback, useSyncExternalStore } from 'react';
import {
  ALL_BINDINGS,
  chordTokens,
  defaultChord,
  tokenLabels,
  type Binding,
} from '../components/settings/keybindings-data';

/**
 * Your shortcuts for JAM's own commands: the defaults from
 * `keybindings-data`, with what you changed in Settings → Keybindings laid
 * over them. A client preference in this profile, like Stream replies,
 * shared by every reader so a change applies at once. An override of null
 * means the command has no shortcut.
 */
export type Overrides = Readonly<Record<string, string | null>>;

const KEY = 'jam.keybindings';
const EDITABLE = new Set(ALL_BINDINGS.filter((binding) => binding.editable).map((b) => b.id));
const listeners = new Set<() => void>();
let current: Overrides | null = null;

function read(): Overrides {
  if (current) return current;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    current = Object.fromEntries(
      Object.entries(stored && typeof stored === 'object' ? stored : {}).filter(
        ([id, chord]) =>
          EDITABLE.has(id) && (chord === null || (typeof chord === 'string' && chord.length < 64)),
      ),
    ) as Overrides;
  } catch {
    current = {};
  }
  return current;
}

function write(next: Overrides) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Losing the change only restores the defaults.
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A command's chord: your override, else its default. */
export function chordFor(binding: Binding, overrides: Overrides, mac: boolean): string | null {
  return binding.id in overrides ? (overrides[binding.id] ?? null) : defaultChord(binding, mac);
}

/** The editable command a chord runs, if any. */
export function commandFor(chord: string, overrides: Overrides, mac: boolean): string | null {
  return (
    ALL_BINDINGS.find((binding) => binding.editable && chordFor(binding, overrides, mac) === chord)
      ?.id ?? null
  );
}

/**
 * Overrides with `id` bound to `chord` (null for none). Any other command
 * that had the chord loses it, and a chord equal to the default is stored
 * as no override at all.
 */
export function assignChord(
  overrides: Overrides,
  id: string,
  chord: string | null,
  mac: boolean,
): Overrides {
  const next: Record<string, string | null> = { ...overrides };
  if (chord)
    for (const binding of ALL_BINDINGS)
      if (binding.editable && binding.id !== id && chordFor(binding, next, mac) === chord)
        next[binding.id] = null;
  const binding = ALL_BINDINGS.find((item) => item.id === id);
  if (binding && defaultChord(binding, mac) === chord) delete next[id];
  else next[id] = chord;
  return next;
}

export function useKeybindings(mac: boolean) {
  const overrides = useSyncExternalStore(subscribe, read, () => ({}) as Overrides);
  const assign = useCallback(
    (id: string, chord: string | null) => write(assignChord(read(), id, chord, mac)),
    [mac],
  );
  const reset = useCallback((id: string) => {
    const next = { ...read() };
    delete next[id];
    write(next);
  }, []);
  const resetAll = useCallback(() => write({}), []);
  return { overrides, assign, reset, resetAll };
}

/** A command's keys as a hint, "Ctrl K" or "⌘ K"; empty when it has none. */
export function useShortcutHint(id: string, mac: boolean): string {
  const overrides = useSyncExternalStore(subscribe, read, () => ({}) as Overrides);
  const binding = ALL_BINDINGS.find((item) => item.id === id);
  const chord = binding ? chordFor(binding, overrides, mac) : null;
  return chord ? tokenLabels(chordTokens(chord), mac).join(' ') : '';
}
