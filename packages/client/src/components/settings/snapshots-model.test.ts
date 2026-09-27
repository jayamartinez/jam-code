import { describe, expect, it } from 'vitest';
import { SNAPSHOT_KEY_COMBINATIONS } from '@jam/protocol';
import {
  SHORTCUT_OPTIONS,
  missingPermissions,
  requiredPermissions,
  shortcutFromValue,
  shortcutOption,
  shortcutValue,
} from './snapshots-model';

describe('snapshot setup', () => {
  it('asks for Input Monitoring only for double-tap Shift', () => {
    expect(requiredPermissions({ kind: 'bothShift' })).toEqual(['screenRecording']);
    expect(requiredPermissions({ kind: 'keyCombination', accelerator: 'Command+Shift+2' })).toEqual(
      ['screenRecording'],
    );
    expect(requiredPermissions({ kind: 'doubleShift' })).toEqual([
      'screenRecording',
      'inputMonitoring',
    ]);
  });

  it('lists only what is still missing', () => {
    const none = { screenRecording: false, inputMonitoring: false };
    expect(missingPermissions({ kind: 'bothShift' }, none)).toEqual(['screenRecording']);
    expect(
      missingPermissions({ kind: 'bothShift' }, { screenRecording: true, inputMonitoring: false }),
    ).toEqual([]);
    expect(
      missingPermissions(
        { kind: 'doubleShift' },
        { screenRecording: true, inputMonitoring: false },
      ),
    ).toEqual(['inputMonitoring']);
  });

  it('offers every runtime key combination and round-trips each choice', () => {
    for (const accelerator of SNAPSHOT_KEY_COMBINATIONS)
      expect(SHORTCUT_OPTIONS.some((option) => option.value === accelerator)).toBe(true);
    for (const option of SHORTCUT_OPTIONS) {
      const shortcut = shortcutFromValue(option.value);
      expect(shortcutValue(shortcut)).toBe(option.value);
      expect(shortcutOption(shortcut)).toBe(option);
    }
    expect(SHORTCUT_OPTIONS[0]?.value).toBe('bothShift');
  });
});
