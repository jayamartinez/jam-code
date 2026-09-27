import type { SnapshotKeyCombination, SnapshotShortcut } from '@jam/protocol';

type ShortcutValue = 'bothShift' | SnapshotKeyCombination;

type ShortcutOption = {
  value: ShortcutValue;
  label: string;
  keys: readonly string[];
  hint: string;
};

/** The default, as in T3 Code. Needs no keyboard permission. */
const BOTH_SHIFT: ShortcutOption = {
  value: 'bothShift',
  label: 'Both Shift keys',
  keys: ['⇧ Shift', '⇧ Shift'],
  hint: 'Press left and right Shift together.',
};

/** Every option needs only Screen Recording; none listens to key events. */
export const SHORTCUT_OPTIONS: readonly ShortcutOption[] = [
  BOTH_SHIFT,
  {
    value: 'Command+Shift+2',
    label: '⌘ ⇧ 2',
    keys: ['⌘', '⇧', '2'],
    hint: 'A regular shortcut, like ⌘⇧4 for screenshots.',
  },
  {
    value: 'Control+Shift+2',
    label: '⌃ ⇧ 2',
    keys: ['⌃', '⇧', '2'],
    hint: 'A regular shortcut.',
  },
  {
    value: 'Option+Shift+2',
    label: '⌥ ⇧ 2',
    keys: ['⌥', '⇧', '2'],
    hint: 'A regular shortcut.',
  },
];

export function shortcutValue(shortcut: SnapshotShortcut): ShortcutValue {
  return shortcut.kind === 'keyCombination' ? shortcut.accelerator : shortcut.kind;
}

export function shortcutFromValue(value: ShortcutValue): SnapshotShortcut {
  return value === 'bothShift' ? { kind: value } : { kind: 'keyCombination', accelerator: value };
}

export function shortcutOption(shortcut: SnapshotShortcut) {
  const value = shortcutValue(shortcut);
  return SHORTCUT_OPTIONS.find((option) => option.value === value) ?? BOTH_SHIFT;
}
