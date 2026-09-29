import { describe, expect, it } from 'vitest';
import { firstEmoji } from './EmojiButton';

describe('firstEmoji', () => {
  it('keeps a whole emoji, including sequences, and ignores other text', () => {
    expect(firstEmoji('✅')).toBe('✅');
    expect(firstEmoji('a👩🏽‍💻b')).toBe('👩🏽‍💻');
    expect(firstEmoji('🇯🇵')).toBe('🇯🇵');
    expect(firstEmoji('hello')).toBeNull();
  });
});
