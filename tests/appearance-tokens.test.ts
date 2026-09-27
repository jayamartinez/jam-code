import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from '../packages/protocol/src/appearance';
import { appearanceTokens } from '../packages/client/src/appearance/resolve';

/** `--name: value;` pairs from tokens.css, whitespace-normalised. */
function stylesheetTokens(): Map<string, string> {
  const css = readFileSync(
    new URL('../packages/client/src/styles/tokens.css', import.meta.url),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    tokens.set(
      match[1]!,
      match[2]!.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim(),
    );
  return tokens;
}

/**
 * tokens.css is the Paper Nightglass palette and the first paint before any
 * appearance is applied. The theme resolver must reproduce it exactly, so the
 * default theme cannot drift from the design or from itself.
 */
describe('default theme', () => {
  it('reproduce tokens.css — the Paper Nightglass values — exactly for the defaults', () => {
    const css = stylesheetTokens();
    const { tokens } = appearanceTokens(DEFAULT_APPEARANCE, false);
    for (const [name, value] of Object.entries(tokens)) {
      expect(css.has(name), `${name} is missing from tokens.css`).toBe(true);
      expect(css.get(name), name).toBe(value.replace(/\s+/g, ' '));
    }
  });
});
