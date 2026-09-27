import { describe, expect, it } from 'vitest';
import { SNAPSHOT_KEY_COMBINATIONS } from '@jam/protocol';
import {
  SHORTCUT_OPTIONS,
  shortcutFromValue,
  shortcutOption,
  shortcutValue,
} from './snapshots-model';

describe('snapshot shortcuts', () => {
  it('defaults to both Shift keys and offers every runtime key combination', () => {
    expect(SHORTCUT_OPTIONS[0]?.value).toBe('bothShift');
    for (const accelerator of SNAPSHOT_KEY_COMBINATIONS)
      expect(SHORTCUT_OPTIONS.some((option) => option.value === accelerator)).toBe(true);
    expect(SHORTCUT_OPTIONS).toHaveLength(SNAPSHOT_KEY_COMBINATIONS.length + 1);
  });

  it('round-trips each choice', () => {
    for (const option of SHORTCUT_OPTIONS) {
      const shortcut = shortcutFromValue(option.value);
      expect(shortcutValue(shortcut)).toBe(option.value);
      expect(shortcutOption(shortcut)).toBe(option);
    }
  });

  it('never offers anything that needs Input Monitoring', () => {
    expect(SHORTCUT_OPTIONS.map((option) => option.label).join(' ')).not.toMatch(
      /double|input monitoring/i,
    );
  });
});
