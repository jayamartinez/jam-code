import { describe, expect, it } from 'vitest';
import { APPEARANCE, customThemeProblem } from '@jam/protocol';
import { colorsFromDefinition } from './custom';
import { exportTheme, importTheme, normalizeColor, parseJsonc } from './import';
import { THEMES } from './themes';

const vscode = `{
  // A VS Code theme, with the comments and trailing commas such files carry.
  "name": "Harbour Night",
  "type": "dark",
  "colors": {
    "editor.background": "#0d1a1c",
    "editor.foreground": "#d2e4e3",
    "sideBar.background": "#0a1416",
    "focusBorder": "#4fb3b0",
    "terminal.ansiRed": "#e0827a",
    "terminal.ansiGreen": "#a9d59b",
    "editorWidget.background": "#13262880", /* translucent */
  },
  "tokenColors": [
    { "scope": ["keyword", "storage.type"], "settings": { "foreground": "#6cc4c0" } },
    { "scope": "keyword.operator", "settings": { "foreground": "#8aa3a2" } },
    { "scope": "string", "settings": { "foreground": "#A9D59B" } },
    { "scope": "constant.numeric", "settings": { "foreground": "#e3b37f" } },
    { "scope": "entity.name.function, support.function", "settings": { "foreground": "#9fc2ef" } },
    { "scope": "meta.class entity.name.type", "settings": { "foreground": "#c5a3e8" } },
    { "scope": "comment", "settings": { "fontStyle": "italic", "foreground": "#6a8583" } },
  ],
}`;

describe('theme import', () => {
  it('reads JSON with comments and trailing commas, leaving strings alone', () => {
    expect(parseJsonc('{ "a": "http://x/*y*/", // c\n "b": [1,2,], }')).toEqual({
      a: 'http://x/*y*/',
      b: [1, 2],
    });
  });

  it('normalizes short, long and translucent colors', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor('#112233')).toBe('#112233');
    expect(normalizeColor('#ffffff80', '#000000')).toBe('#808080');
    expect(normalizeColor('red')).toBeUndefined();
  });

  it('maps a VS Code theme onto JAM roles and reports what it derived', () => {
    const result = importTheme(vscode, 'harbour-color-theme.json');
    expect(result.format).toBe('vscode');
    expect(result.theme.name).toBe('Harbour Night');
    const dark = result.theme.dark!;
    expect(result.theme.light).toBeUndefined();
    expect(dark.canvas).toBe('#0d1a1c');
    expect(dark.accent).toBe('#4fb3b0');
    expect(dark.keyword).toBe('#6cc4c0');
    expect(dark.operator).toBe('#8aa3a2');
    expect(dark.string).toBe('#a9d59b');
    expect(dark.function).toBe('#9fc2ef');
    expect(dark.type).toBe('#c5a3e8');
    expect(dark.comment).toBe('#6a8583');
    expect(dark.success).toBe('#a9d59b');
    expect(dark.raised).toMatch(/^#[0-9a-f]{6}$/);
    expect(result.mapped + result.derived).toBe(APPEARANCE.customThemeRoles.length);
    expect(result.derivedRoles).toContain('blue');
    expect(result.derivedRoles).not.toContain('keyword');
    expect(customThemeProblem({ id: 'harbour', ...result.theme })).toBeNull();
  });

  it('decides brightness from the type, or from the canvas', () => {
    const light = importTheme('{ "colors": { "editor.background": "#fbfaf7" } }');
    expect(light.theme.light).toBeDefined();
    expect(light.derived).toBe(APPEARANCE.customThemeRoles.length - 1);
    expect(light.theme.name).toBe('Imported theme');
  });

  it('round-trips its own export', () => {
    const theme = {
      id: 'harbour',
      name: 'Harbour',
      dark: colorsFromDefinition(THEMES.tide),
      light: colorsFromDefinition(THEMES.linen),
    };
    const result = importTheme(exportTheme(theme));
    expect(result.format).toBe('jam');
    expect(result.theme).toEqual({ name: 'Harbour', dark: theme.dark, light: theme.light });
    expect(result.derived).toBe(0);
  });

  it('refuses what is not a theme, with a reason', () => {
    expect(() => importTheme('not json')).toThrow(/valid JSON/);
    expect(() => importTheme('[]')).toThrow(/not a theme/);
    expect(() => importTheme('{ "hello": 1 }')).toThrow(/neither/);
    expect(() => importTheme('{ "colors": {} }')).toThrow(/editor.background/);
    expect(() =>
      importTheme('{ "jamTheme": 1, "name": "X", "dark": { "canvas": "#000000" } }'),
    ).toThrow();
    expect(() => importTheme(' '.repeat(600 * 1024))).toThrow(/512 KB/);
  });
});
