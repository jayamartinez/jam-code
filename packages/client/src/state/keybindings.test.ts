import { describe, expect, it } from 'vitest';
import { assignChord, commandFor } from './keybindings';

describe('keybindings', () => {
  it('runs a command by its default chord until it is rebound', () => {
    expect(commandFor('mod+k', {}, false)).toBe('search');
    const rebound = assignChord({}, 'search', 'mod+p', false);
    expect(commandFor('mod+p', rebound, false)).toBe('search');
    expect(commandFor('mod+k', rebound, false)).toBeNull();
  });

  it('takes a chord from the command that had it', () => {
    const taken = assignChord({}, 'close-pane', 'mod+w', false);
    expect(commandFor('mod+w', taken, false)).toBe('close-pane');
    expect(taken['close-tab']).toBeNull();
  });

  it('stores nothing for a command put back on its default', () => {
    const moved = assignChord({}, 'search', 'mod+p', false);
    expect(assignChord(moved, 'search', 'mod+k', false)).toEqual({});
  });
});
