import { describe, expect, it } from 'vitest';
import { compose, noise, settleTimes } from './scramble';

describe('scrambled text', () => {
  it('keeps the length and uses none of the hidden characters', () => {
    const scrambled = noise(18);
    expect(scrambled).toMatch(/^[a-z]{18}$/);
    expect(scrambled).not.toContain('@');
    expect(noise(0)).toBe('');
  });

  it('shows only the characters that have settled', () => {
    const zero = () => 0;
    const text = 'reader@example.com';
    expect(compose(text, [], zero)).toBe('a'.repeat(18));
    expect(compose(text, Array(6).fill(true), zero)).toBe('reader' + 'a'.repeat(12));
    expect(compose(text, Array(18).fill(true), zero)).toBe(text);
  });

  it('settles in reading order to reveal and in reverse to hide', () => {
    const half = () => 0.5;
    const reveal = settleTimes(4, true, 400, half);
    const hide = settleTimes(4, false, 400, half);
    expect(reveal).toEqual([...reveal].sort((a, b) => a - b));
    expect(hide).toEqual([...hide].sort((a, b) => b - a));
    // Everything settles within the duration.
    for (const time of [...reveal, ...hide]) expect(time).toBeLessThanOrEqual(400);
  });
});
