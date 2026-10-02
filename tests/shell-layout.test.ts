import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const style = (name: string) => readFile(resolve('packages/client/src/styles', name), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(css: string, selector: string): Record<string, string> {
  const body = css.match(
    new RegExp(`(?:^|\\n)${selector.replaceAll('.', '\\.')} \\{\\n([^}]*)\\}`),
  )?.[1];
  if (body === undefined) throw new Error(`No rule for ${selector}`);
  return Object.fromEntries(
    body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const at = declaration.indexOf(':');
        return [declaration.slice(0, at).trim(), declaration.slice(at + 1).trim()];
      }),
  );
}

describe('the shell’s surfaces', () => {
  it('separates the sidebar from the workspace by the tile gutter', async () => {
    const shell = await style('shell.css');
    const tokens = await style('tokens.css');
    expect(tokens).toMatch(/--spacing-gutter: 6px;/);
    // One gutter, on the workspace: expanded sidebar and collapsed rail alike,
    // in Single and in Tiles. The sidebar itself carries no margin.
    const workspace = rule(shell, '.workspace');
    expect(workspace.padding).toBe('0 8px 8px var(--spacing-gutter)');
    expect(workspace.gap).toBe('var(--spacing-gutter)');
    expect(rule(shell, '.sidebar')).not.toHaveProperty('margin-right');
    expect(rule(shell, '.sidebar.rail')).not.toHaveProperty('margin-right');
    expect(rule(shell, '.main-shell')).not.toHaveProperty('padding-left');
    // Focus mode has no sidebar; it keeps the window's own outer padding.
    expect(rule(shell, '.focus-mode .workspace')['padding-left']).toBe('8px');
  });

  it('draws menus in an overlay host that no pane or sidebar contains', async () => {
    const shell = await style('shell.css');
    const host = rule(shell, '.overlay-host');
    expect(host.position).toBe('fixed');
    expect(host.inset).toBe('0');
    // The host passes presses through; only a menu in it takes them.
    expect(host['pointer-events']).toBe('none');
    expect(rule(shell, '.overlay-host > \\*')['pointer-events']).toBe('auto');
    // A menu is positioned against the host, never `fixed` inside a surface
    // whose backdrop filter would become its containing block.
    const conversation = await style('conversation.css');
    expect(rule(conversation, '.choice-menu').position).toBe('absolute');
    expect(rule(shell, '.help-menu').position).toBe('absolute');
    expect(conversation).not.toMatch(/\.(choice|menu-select-root)[^,{]* \.choice-menu/);
  });

  it('never gives a sidebar control the Settings switch’s class', async () => {
    // `.toggle` is the switch in Settings; a thread group header that used it
    // was drawn as a 32px switch with a stray knob.
    const sidebar = await readFile(resolve('packages/client/src/components/Sidebar.tsx'), 'utf8');
    expect(sidebar).not.toMatch(/className="[^"]*\btoggle\b/);
  });
});
