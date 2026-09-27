import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BINDING_GROUPS } from '../packages/client/src/components/settings/keybindings-data';

/** Settings → Keybindings may only list shortcuts JAM's handlers implement. */
describe('Settings keybindings', () => {
  it('names a handler that contains each listed shortcut', () => {
    for (const binding of BINDING_GROUPS.flatMap((group) => group.bindings)) {
      const text = readFileSync(
        new URL(`../packages/client/src/${binding.source}`, import.meta.url),
        'utf8',
      );
      expect(text, `${binding.id} in ${binding.source}`).toContain(binding.evidence);
    }
  });
});
