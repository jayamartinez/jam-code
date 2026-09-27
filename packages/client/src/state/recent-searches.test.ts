import { describe, expect, it } from 'vitest';
import { RECENT_SEARCH_LIMIT, rememberSearch } from './recent-searches';

describe('recent searches', () => {
  it('keeps the newest first, drops case-insensitive repeats and blanks, and stays bounded', () => {
    let list: string[] = [];
    for (const query of ['pty', 'resize', '  PTY  ', '', 'a', 'b', 'c', 'd', 'e'])
      list = rememberSearch(list, query);
    expect(list).toEqual(['e', 'd', 'c', 'b', 'a', 'PTY']);
    expect(list).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(list).not.toContain('resize');
  });
});
