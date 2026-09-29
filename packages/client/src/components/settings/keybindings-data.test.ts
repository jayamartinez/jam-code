import { describe, expect, it } from 'vitest';
import {
  BINDING_GROUPS,
  chordFromEvent,
  chordProblem,
  filterBindings,
  keyLabels,
  usesCommand,
} from './keybindings-data';

describe('keybindings table', () => {
  const all = BINDING_GROUPS.flatMap((group) => group.bindings);

  it('has unique ids and keys for both platforms', () => {
    expect(new Set(all.map((binding) => binding.id)).size).toBe(all.length);
    // Only a rebindable command may start without keys.
    for (const binding of all.filter((item) => !item.editable)) {
      expect(binding.keys.mac.length).toBeGreaterThan(0);
      expect(binding.keys.other.length).toBeGreaterThan(0);
    }
  });

  it('draws the platform modifier the way JAM handles it', () => {
    const search = all.find((binding) => binding.id === 'search')!;
    expect(keyLabels(search, true)).toEqual(['⌘', 'K']);
    expect(keyLabels(search, false)).toEqual(['Ctrl', 'K']);
    const find = all.find((binding) => binding.id === 'terminal-find')!;
    expect(keyLabels(find, false)).toEqual(['Ctrl', 'Shift', 'F']);
  });

  it('sends on Enter and adds a line with Shift+Enter', () => {
    const send = all.find((binding) => binding.id === 'send')!;
    const newLine = all.find((binding) => binding.id === 'new-line')!;
    expect(keyLabels(send, false)).toEqual(['Enter']);
    expect(keyLabels(newLine, false)).toEqual(['Shift', 'Enter']);
    expect(keyLabels(newLine, true)).toEqual(['⇧', '↵']);
  });

  it('follows the OS rather than the host', () => {
    expect(usesCommand('macos', '')).toBe(true);
    expect(usesCommand('windows', 'MacIntel')).toBe(false);
    expect(usesCommand('web', 'MacIntel')).toBe(true);
    expect(usesCommand('web', 'Win32')).toBe(false);
  });

  it('filters by words in the command, context or keys and drops empty groups', () => {
    expect(filterBindings(BINDING_GROUPS, '  ', true)).toBe(BINDING_GROUPS);
    const terminal = filterBindings(BINDING_GROUPS, 'terminal find', true);
    expect(terminal.flatMap((group) => group.bindings.map((binding) => binding.id))).toContain(
      'terminal-find',
    );
    expect(terminal.every((group) => group.bindings.length > 0)).toBe(true);
    const byKeys = filterBindings(BINDING_GROUPS, '⌘K', true);
    expect(byKeys.flatMap((group) => group.bindings).map((binding) => binding.id)).toEqual([
      'search',
    ]);
    expect(filterBindings(BINDING_GROUPS, 'no such command', false)).toEqual([]);
  });

  it('records a key press as a chord by key position, with the platform modifier', () => {
    const press = (code: string, key: string, held: Partial<KeyboardEvent> = {}) => ({
      code,
      key,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      ...held,
    });
    expect(chordFromEvent(press('KeyK', 'k', { ctrlKey: true }), false)).toBe('mod+k');
    expect(chordFromEvent(press('KeyK', 'k', { metaKey: true, ctrlKey: true }), true)).toBe(
      'mod+ctrl+k',
    );
    // Shift turns "," into "<", but the chord keeps the key.
    expect(chordFromEvent(press('Comma', '<', { ctrlKey: true, shiftKey: true }), false)).toBe(
      'mod+shift+,',
    );
    expect(chordFromEvent(press('ControlLeft', 'Control', { ctrlKey: true }), false)).toBeNull();
  });

  it('refuses chords without a modifier and those text editing needs', () => {
    expect(chordProblem('shift+k')).not.toBeNull();
    expect(chordProblem('mod+c')).not.toBeNull();
    expect(chordProblem('f5')).toBeNull();
    expect(chordProblem('mod+shift+c')).toBeNull();
  });
});
