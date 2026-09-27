import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TERMINAL_FACTS } from '../packages/client/src/components/settings/tools-model';

/** The Terminal settings page shows these values; they must be what the terminal does. */
describe('Terminal settings facts', () => {
  const source = readFileSync(
    new URL('../packages/client/src/components/TerminalView.tsx', import.meta.url),
    'utf8',
  );

  it('match what TerminalView configures', () => {
    expect(source).toContain(`const SCROLLBACK = ${TERMINAL_FACTS.scrollback};`);
    expect(source).toContain(`macOptionIsMeta: ${TERMINAL_FACTS.optionAsMeta},`);
    expect(source).toContain(`cursorBlink: ${TERMINAL_FACTS.cursorBlink},`);
    expect(TERMINAL_FACTS.scrollbackLabel).toBe(
      `${TERMINAL_FACTS.scrollback.toLocaleString('en-US')} lines`,
    );
  });
});
