import type { SnapshotKeyCombination, SnapshotShortcut } from '@jam/protocol';
import type { SnapshotShortcutStatus } from '../../desktop';

export type SnapshotPermission = 'screenRecording' | 'inputMonitoring';

/** Screen Recording always; Input Monitoring only to hear double-tapped Shift. */
export function requiredPermissions(shortcut: SnapshotShortcut): SnapshotPermission[] {
  return shortcut.kind === 'doubleShift'
    ? ['screenRecording', 'inputMonitoring']
    : ['screenRecording'];
}

export function missingPermissions(
  shortcut: SnapshotShortcut,
  status: Pick<SnapshotShortcutStatus, 'screenRecording' | 'inputMonitoring'>,
): SnapshotPermission[] {
  return requiredPermissions(shortcut).filter((permission) => !status[permission]);
}

export const PERMISSION_COPY: Record<
  SnapshotPermission,
  { title: string; why: string; request: 'requestScreenRecording' | 'requestInputMonitoring' }
> = {
  screenRecording: {
    title: 'Screen Recording',
    why: 'Lets JAM capture the window you’re looking at. Nothing is recorded continuously.',
    request: 'requestScreenRecording',
  },
  inputMonitoring: {
    title: 'Input Monitoring',
    why: 'Only double-tap Shift needs it, to hear the two taps. Other shortcuts don’t.',
    request: 'requestInputMonitoring',
  },
};

export const SETTINGS_ACTION: Record<
  SnapshotPermission,
  'openScreenRecordingSettings' | 'openInputMonitoringSettings'
> = {
  screenRecording: 'openScreenRecordingSettings',
  inputMonitoring: 'openInputMonitoringSettings',
};

type ShortcutValue = 'bothShift' | 'doubleShift' | SnapshotKeyCombination;

type ShortcutOption = {
  value: ShortcutValue;
  label: string;
  keys: readonly string[];
  hint: string;
};

/** The default: T3-style, no keyboard permission. */
const BOTH_SHIFT: ShortcutOption = {
  value: 'bothShift',
  label: 'Both Shift keys',
  keys: ['⇧ Shift', '⇧ Shift'],
  hint: 'Press left and right Shift together.',
};

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
  {
    value: 'doubleShift',
    label: 'Double-tap Shift · needs Input Monitoring',
    keys: ['⇧ Shift', '⇧ Shift'],
    hint: 'Tap Shift twice. macOS asks for Input Monitoring to hear the taps.',
  },
];

export function shortcutValue(shortcut: SnapshotShortcut): ShortcutValue {
  return shortcut.kind === 'keyCombination' ? shortcut.accelerator : shortcut.kind;
}

export function shortcutFromValue(value: ShortcutValue): SnapshotShortcut {
  return value === 'bothShift' || value === 'doubleShift'
    ? { kind: value }
    : { kind: 'keyCombination', accelerator: value };
}

export function shortcutOption(shortcut: SnapshotShortcut) {
  const value = shortcutValue(shortcut);
  return SHORTCUT_OPTIONS.find((option) => option.value === value) ?? BOTH_SHIFT;
}
