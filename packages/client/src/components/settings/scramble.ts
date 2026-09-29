import { useEffect, useRef, useState } from 'react';

/**
 * Scrambled text for hiding a personal value such as an email. A blur alone
 * can be undone, so while hidden the real characters are not rendered at
 * all: only random ones of the same length. Revealing settles them into the
 * real text left to right; hiding scrambles them back right to left.
 */

// Similar-width glyphs, so the text does not jitter while it changes.
const GLYPHS = 'abcdeghknopqsuvxyz';
const REVEAL_MS = 420;
const HIDE_MS = 360;
// Unsettled characters change at this interval, not every frame.
const TICK_MS = 45;

/** Random glyphs of the given length. */
export function noise(length: number, random: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += GLYPHS[Math.floor(random() * GLYPHS.length)];
  return out;
}

/** `text` where `settled[i]` is true, random glyphs elsewhere. */
export function compose(
  text: string,
  settled: readonly boolean[],
  random: () => number = Math.random,
): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) out += settled[i] ? text[i] : noise(1, random);
  return out;
}

/**
 * When each character settles, in milliseconds: in order (left to right to
 * reveal, right to left to hide) across most of the duration, with a little
 * randomness so it reads as decoding rather than a wipe.
 */
export function settleTimes(
  length: number,
  revealing: boolean,
  duration: number,
  random: () => number = Math.random,
): number[] {
  return Array.from({ length }, (_, i) => {
    const order = revealing ? i : length - 1 - i;
    return (order / Math.max(1, length)) * duration * 0.7 + random() * duration * 0.3;
  });
}

/**
 * `text` while revealed, scrambled while hidden, animating between them.
 * Starts hidden. Honors reduced motion by switching at once.
 */
export function useScrambled(text: string, revealed: boolean): string {
  const [display, setDisplay] = useState(() => noise(text.length));
  const settled = useRef<boolean[]>([]);
  useEffect(() => {
    if (settled.current.length !== text.length) settled.current = Array(text.length).fill(false);
    const state = settled.current;
    const duration = revealed ? REVEAL_MS : HIDE_MS;
    const at = settleTimes(text.length, revealed, duration);
    const instant =
      state.every((value) => value === revealed) ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let start: number | undefined;
    let last = -Infinity;
    let frame = 0;
    const step = (now: number) => {
      start ??= now;
      const elapsed = instant ? duration : now - start;
      if (now - last >= TICK_MS || elapsed >= duration) {
        last = now;
        at.forEach((time, i) => {
          if (elapsed >= time) state[i] = revealed;
        });
        setDisplay(compose(text, state));
      }
      if (elapsed < duration) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, revealed]);
  return display;
}
