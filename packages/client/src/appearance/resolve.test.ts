import { describe, expect, it } from 'vitest';
import { APPEARANCE, DEFAULT_APPEARANCE, type AppearanceSettings } from '@jam/protocol';
import { contrast, mix } from './color';
import {
  backgroundTokens,
  colorTokens,
  fontStack,
  MONO_STACK,
  normalizeAppearance,
  typographyTokens,
} from './resolve';
import { ACCENTS, ANSI_ROLES, SYNTAX_ROLES, THEMES, legible } from './themes';

const settings = (changes: Partial<AppearanceSettings> = {}) => ({
  ...DEFAULT_APPEARANCE,
  ...changes,
});

describe('theme tokens', () => {
  it('give every theme the same complete set of roles', () => {
    const keys = Object.keys(colorTokens(settings())).sort();
    for (const theme of APPEARANCE.themes) {
      const tokens = colorTokens(settings({ theme }));
      expect(Object.keys(tokens).sort(), theme).toEqual(keys);
      for (const [name, value] of Object.entries(tokens))
        expect(value, `${theme} ${name}`).toBeTruthy();
    }
  });

  it('keep text, code and status readable on each theme’s panes', () => {
    for (const theme of Object.values(THEMES)) {
      const [pane, opacity] = theme.surfaces.pane;
      const ground = mix(theme.base, pane, opacity / 100);
      const ratio = (colour: string) => contrast(colour, ground);
      expect(ratio(theme.text.body), `${theme.id} body`).toBeGreaterThanOrEqual(7);
      expect(ratio(theme.text.secondary), `${theme.id} secondary`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme.text.muted), `${theme.id} muted`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme.text.subtle), `${theme.id} subtle`).toBeGreaterThanOrEqual(3.5);
      expect(ratio(theme.accent), `${theme.id} accent`).toBeGreaterThanOrEqual(4.5);
      for (const status of ['success', 'warning', 'danger'] as const)
        expect(ratio(theme.status[status]), `${theme.id} ${status}`).toBeGreaterThanOrEqual(4.5);
      for (const role of SYNTAX_ROLES) {
        const floor = role === 'comment' || role === 'punctuation' ? 3.5 : 4.5;
        expect(ratio(theme.syntax[role]), `${theme.id} ${role}`).toBeGreaterThanOrEqual(floor);
      }
      const [terminal, terminalOpacity] = theme.surfaces.terminal;
      const console = mix(theme.base, terminal, terminalOpacity / 100);
      expect(contrast(theme.terminal.foreground, console)).toBeGreaterThanOrEqual(4.5);
      for (const role of ANSI_ROLES.filter((role) => !/black|white/.test(role)))
        expect(contrast(theme.ansi[role], console), `${theme.id} ${role}`).toBeGreaterThanOrEqual(
          3,
        );
    }
  });

  it('let the accent change only accent roles, never status, code or terminal colours', () => {
    const base = colorTokens(settings());
    for (const accent of [...ACCENTS.map((item) => item.id), 'custom'] as const) {
      const tokens = colorTokens(settings({ accent, customAccent: '#ff3366' }));
      for (const [name, value] of Object.entries(tokens)) {
        if (name.startsWith('--color-accent') || name === '--color-on-accent') continue;
        expect(value, `${accent} changed ${name}`).toBe(base[name]);
      }
    }
    expect(colorTokens(settings({ accent: 'rose' }))['--color-accent']).toBe('#ef7f9f');
    expect(colorTokens(settings({ theme: 'frost', accent: 'rose' }))['--color-accent']).toBe(
      '#c03a64',
    );
  });

  it('move an illegible custom accent until it reads on the pane', () => {
    for (const theme of Object.values(THEMES)) {
      const hostile = theme.scheme === 'dark' ? '#0a0a0a' : '#fafafa';
      const adjusted = legible(hostile, theme);
      expect(contrast(adjusted, theme.surfaces.pane[0])).toBeGreaterThanOrEqual(3);
    }
    // A colour that already reads is left alone.
    expect(legible('#6f9bff', THEMES.nightglass)).toBe('#6f9bff');
  });

  it('scale every surface with the reader’s pane opacity', () => {
    expect(colorTokens(settings({ paneOpacity: 78 }))['--color-surface-pane']).toBe(
      'rgb(12 13 19 / 78%)',
    );
    const lighter = colorTokens(settings({ paneOpacity: 39 }));
    expect(lighter['--color-surface-pane']).toBe('rgb(12 13 19 / 39%)');
    expect(lighter['--color-surface-sidebar']).toBe('rgb(9 10 15 / 31%)');
    expect(colorTokens(settings({ theme: 'graphite' }))['--color-surface-pane']).toBe(
      'rgb(20 20 21 / 100%)',
    );
    expect(
      colorTokens(settings({ theme: 'graphite', paneOpacity: 60 }))['--color-surface-pane'],
    ).toBe('rgb(20 20 21 / 60%)');
  });
});

describe('typography tokens', () => {
  it('quote named families before JAM’s bundled stack and leave generic keywords bare', () => {
    expect(fontStack('', MONO_STACK)).toBe(MONO_STACK);
    expect(fontStack('JetBrains Mono', MONO_STACK)).toBe(`'JetBrains Mono', ${MONO_STACK}`);
    expect(fontStack('ui-monospace', MONO_STACK)).toBe(`ui-monospace, ${MONO_STACK}`);
    // A name that could close the quoted string is never emitted.
    expect(fontStack("x', red; --a: b", MONO_STACK)).toBe(MONO_STACK);
  });

  it('scale interface type from the design’s 13px and let the terminal follow the code font', () => {
    const tokens = typographyTokens(settings({ uiFontSize: 15, codeFont: 'Fira Code' }));
    expect(tokens['--ui-scale']).toBe('1.1538');
    expect(tokens['--terminal-font-family']).toBe(tokens['--editor-font-family']);
    expect(
      typographyTokens(settings({ terminalFont: 'Iosevka' }))['--terminal-font-family'],
    ).toMatch(/^'Iosevka'/);
  });
});

describe('background tokens', () => {
  it('fall back to the theme background when an image mode has no stored image', () => {
    expect(backgroundTokens(settings({ background: 'image' }), false).mode).toBe('theme');
    const withImage = backgroundTokens(settings({ background: 'image', paneBlur: 18 }), true);
    expect(withImage.mode).toBe('image');
    expect(withImage.tokens['--wallpaper-layer']).toBe('var(--wallpaper-image)');
    expect(withImage.tokens['--pane-blur']).toBe('18px');
  });

  it('filter only the wallpaper layer, and blur panes only over an image', () => {
    const tokens = backgroundTokens(
      settings({
        background: 'gradient',
        backgroundBrightness: 80,
        backgroundSaturation: 120,
        backgroundBlur: 10,
      }),
      false,
    ).tokens;
    expect(tokens['--wallpaper-filter']).toBe('brightness(80%) saturate(120%) blur(10px)');
    expect(tokens['--wallpaper-layer']).toBe('linear-gradient(160deg, #16213f, #07080c)');
    expect(tokens['--pane-blur']).toBe('0px');
    expect(backgroundTokens(settings(), false).tokens['--wallpaper-filter']).toBe('none');
  });
});

describe('normalizeAppearance', () => {
  it('turns anything stored into a complete, valid record', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    const normalized = normalizeAppearance({
      theme: 'neon',
      accent: 'violet',
      uiFontSize: 99,
      codeLineHeight: 3,
      codeFont: "x'; }",
      gradientFrom: 'blue',
      paneOpacity: 1,
      unknown: true,
    });
    expect(normalized.theme).toBe('nightglass');
    expect(normalized.accent).toBe('violet');
    expect(normalized.uiFontSize).toBe(APPEARANCE.limits.uiFontSize[1]);
    expect(normalized.codeLineHeight).toBe(APPEARANCE.limits.codeLineHeight[0]);
    expect(normalized.codeFont).toBe('');
    expect(normalized.gradientFrom).toBe(DEFAULT_APPEARANCE.gradientFrom);
    expect(normalized.paneOpacity).toBe(APPEARANCE.limits.paneOpacity[0]);
    expect('unknown' in normalized).toBe(false);
  });
});
