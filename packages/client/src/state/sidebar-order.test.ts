import { describe, expect, it } from 'vitest';
import { moved, movedAmongShown } from './sidebar-order';

describe('arranging the sidebar', () => {
  it('moves one item within a list and ignores a move that leaves it', () => {
    expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moved(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moved(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(moved(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moved(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
  });

  it('keeps a hidden section’s place while the shown ones are rearranged', () => {
    const all = ['projects', 'pinned', 'history'];
    // Nothing is pinned, so only two sections are on screen.
    expect(movedAmongShown(all, ['projects', 'history'], 1, 0)).toEqual([
      'history',
      'pinned',
      'projects',
    ]);
    expect(movedAmongShown(all, all, 2, 0)).toEqual(['history', 'projects', 'pinned']);
    expect(movedAmongShown(all, ['projects', 'history'], 0, 0)).toEqual(all);
  });
});
