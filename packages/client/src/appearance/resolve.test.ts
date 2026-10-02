import { describe, expect, it } from 'vitest';
import {
  APPEARANCE,
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
  type CustomThemeColors,
  customThemeRef,
} from '@jam/protocol';
import { contrast, luminance, mix, toHex, toHsl } from './color';
import { colorsFromDefinition } from './custom';
import { extractPalette } from './palette';
import {
  backgroundTokens,
  effectTokens,
  colorTokens,
  drawnSurfaces,
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
      const ratio = (color: string) => contrast(color, ground);
      expect(ratio(theme.text.body), `${theme.id} body`).toBeGreaterThanOrEqual(7);
      expect(ratio(theme.text.secondary), `${theme.id} secondary`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme.text.muted), `${theme.id} muted`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme.text.subtle), `${theme.id} subtle`).toBeGreaterThanOrEqual(3.5);
      // The accent marks controls (3:1); links use accent-strong, which must read as text.
      expect(ratio(theme.accent), `${theme.id} accent`).toBeGreaterThanOrEqual(3);
      const strong = colorTokens(settings({ theme: theme.id }))['--color-accent-strong']!;
      expect(ratio(strong), `${theme.id} accent-strong`).toBeGreaterThanOrEqual(4.5);
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

  it('let the accent change only accent roles, never status, code or terminal colors', () => {
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
    // A color that already reads is left alone.
    expect(legible('#6f9bff', THEMES.nightglass)).toBe('#6f9bff');
  });

  it('scale every surface with the reader’s pane opacity', () => {
    expect(colorTokens(settings({ paneOpacity: 78 }))['--color-surface-pane']).toBe(
      'rgb(12 13 19 / 78%)',
    );
    const lighter = colorTokens(settings({ paneOpacity: 39 }));
    expect(lighter['--color-surface-pane']).toBe('rgb(12 13 19 / 39%)');
    expect(lighter['--color-surface-pane-muted']).toBe('rgb(12 13 19 / 33%)');
    // The sidebar is set on its own: a clear pane beside a solid sidebar.
    expect(lighter['--color-surface-sidebar']).toBe('rgb(9 10 15 / 62%)');
    const clear = colorTokens(settings({ paneOpacity: 0, sidebarOpacity: 100 }));
    expect(clear['--color-surface-pane']).toBe('rgb(12 13 19 / 0%)');
    expect(clear['--color-surface-sidebar']).toBe('rgb(9 10 15 / 100%)');
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
    const withImage = backgroundTokens(
      settings({ background: 'image', paneBlur: 18, sidebarBlur: 6 }),
      true,
    );
    expect(withImage.mode).toBe('image');
    expect(withImage.tokens['--wallpaper-layer']).toBe('var(--wallpaper-image)');
    expect(withImage.tokens['--pane-backdrop']).toBe('blur(18px)');
    expect(withImage.tokens['--sidebar-backdrop']).toBe('blur(6px)');
    // An opaque surface or a zero blur composites nothing.
    const opaque = backgroundTokens(
      settings({ background: 'image', sidebarOpacity: 100, paneBlur: 0 }),
      true,
    );
    expect(opaque.tokens['--sidebar-backdrop']).toBe('none');
    expect(opaque.tokens['--pane-backdrop']).toBe('none');
    // A pattern is detail worth softening even without an image.
    expect(
      backgroundTokens(settings({ backgroundPattern: 'halftone' }), false).tokens[
        '--pane-backdrop'
      ],
    ).toBe('blur(24px)');
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
    expect(tokens['--pane-backdrop']).toBe('none');
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
      paneOpacity: -5,
      sidebarOpacity: 140,
      backgroundPattern: 'plasma',
      autoColors: 'yes',
      unknown: true,
    });
    expect(normalized.theme).toBe('nightglass');
    expect(normalized.accent).toBe('violet');
    expect(normalized.uiFontSize).toBe(APPEARANCE.limits.uiFontSize[1]);
    expect(normalized.codeLineHeight).toBe(APPEARANCE.limits.codeLineHeight[0]);
    expect(normalized.codeFont).toBe('');
    expect(normalized.gradientFrom).toBe(DEFAULT_APPEARANCE.gradientFrom);
    expect(normalized.paneOpacity).toBe(0);
    expect(normalized.sidebarOpacity).toBe(100);
    expect(normalized.backgroundPattern).toBe('none');
    expect(normalized.autoColors).toBe(false);
    expect('unknown' in normalized).toBe(false);
  });
});

describe('background effects', () => {
  it('are nothing at all by default', () => {
    expect(effectTokens(settings())).toEqual({
      '--wallpaper-effects': 'none',
      '--wallpaper-effects-size': 'auto',
    });
  });

  it('stack a vignette, a fade and a pattern as static layers with matching sizes', () => {
    const tokens = effectTokens(
      settings({
        backgroundPattern: 'halftone',
        patternSize: 5,
        patternStrength: 40,
        backgroundFade: 60,
        backgroundVignette: 30,
      }),
    );
    const layers = tokens['--wallpaper-effects']!;
    expect(layers.match(/gradient\(/g)).toHaveLength(3);
    expect(layers).toContain('var(--color-bg-base) 60%');
    expect(tokens['--wallpaper-effects-size']).toBe('auto, auto, 5px 5px');
    const grid = effectTokens(settings({ backgroundPattern: 'grid', patternSize: 4 }));
    expect(grid['--wallpaper-effects-size']).toBe('24px 24px, 24px 24px');
    const grain = effectTokens(settings({ backgroundPattern: 'grain' }));
    expect(grain['--wallpaper-effects']).toMatch(/^url\("data:image\/svg\+xml;utf8,<svg /);
    expect(effectTokens(settings({ backgroundPattern: 'scanlines', patternStrength: 0 }))).toEqual(
      effectTokens(settings()),
    );
  });
});

describe('match colors to image', () => {
  // A mostly dark-teal picture with a patch of vivid orange.
  const pixels: number[] = [];
  for (let index = 0; index < 400; index++)
    pixels.push(
      ...(index < 60
        ? [240, 120, 30, 255]
        : index < 300
          ? [10, 40, 45, 255]
          : [200, 225, 225, 255]),
    );
  const palette = extractPalette(pixels);

  it('finds the vivid hue the image uses and its own dark and light tones', () => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(palette.accentDark.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(g!);
    expect(g!).toBeGreaterThan(b!);
    expect(contrast(palette.groundDark, '#000000')).toBeLessThan(1.6);
    expect(contrast(palette.groundLight, '#ffffff')).toBeLessThan(1.2);
  });

  it('tints surfaces and sets the accent only while an image is shown with the option on', () => {
    const on = settings({ background: 'image', autoColors: true });
    const plain = colorTokens(on, { present: true });
    const matched = colorTokens(on, { present: true, palette });
    expect(matched['--color-surface-pane']).not.toBe(plain['--color-surface-pane']);
    expect(matched['--color-accent']).not.toBe(plain['--color-accent']);
    expect(matched['--color-text-body']).toBe(plain['--color-text-body']);
    expect(matched['--color-success']).toBe(plain['--color-success']);
    expect(colorTokens({ ...on, background: 'theme' }, { present: true, palette })).toEqual(
      colorTokens({ ...on, background: 'theme' }),
    );
    expect(colorTokens({ ...on, autoColors: false }, { present: true, palette })).toEqual(
      colorTokens({ ...on, autoColors: false }),
    );
  });
  it('gives every surface the image tone at its own lightness, a gray theme included', () => {
    const gray: CustomThemeColors = {
      ...colorsFromDefinition(THEMES.nightglass),
      canvas: '#424242',
      sidebar: '#090a0f',
      raised: '#4d5150',
    };
    const on = settings({
      background: 'image',
      autoColors: true,
      theme: customThemeRef('gray', 'dark'),
      customThemes: [{ id: 'gray', name: 'Gray', dark: gray }],
    });
    const plain = colorTokens({ ...on, autoColors: false }, { present: true, palette });
    const matched = colorTokens(on, { present: true, palette });
    const hex = (value: string) => {
      const [r, g, b] = value.match(/\d+/g)!.slice(0, 3).map(Number);
      return value.startsWith('#') ? value : toHex([r!, g!, b!]);
    };
    const [toneHue] = toHsl(palette.groundDark);
    for (const role of [
      '--color-surface-pane',
      '--color-surface-sidebar',
      '--color-surface-raised',
      '--color-surface-overlay',
      '--color-bg-base',
    ]) {
      const before = hex(plain[role]!);
      const after = hex(matched[role]!);
      const [hue, saturation] = toHsl(after);
      // Within rounding: a near-black surface has few 8-bit steps to hold a hue.
      expect(Math.abs(hue - toneHue), role).toBeLessThan(12);
      expect(saturation, role).toBeGreaterThan(0.15);
      // Same lightness to the eye, so text on it reads exactly as before.
      expect(Math.abs(luminance(after) - luminance(before)), role).toBeLessThan(0.004);
      expect(
        Math.abs(
          contrast(matched['--color-text-body']!, after) -
            contrast(plain['--color-text-body']!, before),
        ),
        role,
      ).toBeLessThan(0.25);
    }
  });
  it('leaves a surface the reader set by hand alone and still recolors the rest', () => {
    const on = settings({ background: 'image', autoColors: true });
    const context = { present: true, palette };
    const plain = colorTokens({ ...on, autoColors: false }, context);
    const all = colorTokens(on, context);
    const own = colorTokens({ ...on, ownSurfaces: ['canvas'] }, context);
    for (const role of [
      '--color-surface-pane',
      '--color-surface-pane-muted',
      '--color-surface-terminal',
    ])
      expect(own[role], role).toBe(plain[role]);
    for (const role of [
      '--color-surface-sidebar',
      '--color-surface-raised',
      '--color-surface-overlay',
    ]) {
      expect(own[role], role).toBe(all[role]);
      expect(own[role], role).not.toBe(plain[role]);
    }
    // The accent is the image's either way.
    expect(own['--color-accent']).toBe(all['--color-accent']);

    const shown = drawnSurfaces({ ...on, ownSurfaces: ['canvas'] }, context);
    expect(shown.canvas).toEqual({ color: THEMES.nightglass.surfaces.pane[0], fromImage: false });
    expect(shown.sidebar.fromImage).toBe(true);
    expect(shown.sidebar.color).not.toBe(THEMES.nightglass.surfaces.sidebar[0]);
    expect(shown.raised.color).toMatch(/^#[0-9a-f]{6}$/);
    // Not matching: every surface is the theme's own and none is the image's.
    expect(Object.values(drawnSurfaces(on)).some((item) => item.fromImage)).toBe(false);
  });
  it('keeps only known surfaces, once each, from a stored record', () => {
    expect(
      normalizeAppearance({ ownSurfaces: ['raised', 'text', 'canvas', 'raised', 4] }).ownSurfaces,
    ).toEqual(['canvas', 'raised']);
    expect(normalizeAppearance({ ownSurfaces: 'canvas' }).ownSurfaces).toEqual([]);
  });
  it('gives tabs their own surface only over a custom background', () => {
    const tab = (tokens: Record<string, string>) => [
      tokens['--color-tab-surface'],
      tokens['--color-tab-text'],
      tokens['--color-tab-quiet-text'],
      tokens['--color-tab-active-surface'],
      tokens['--tab-backdrop'],
    ];
    const plain = [
      'transparent',
      'var(--color-text-muted)',
      'var(--color-text-subtle)',
      'var(--color-fill-strong)',
      'none',
    ];
    const chip = [
      'var(--color-surface-sidebar)',
      'var(--color-text-secondary)',
      'var(--color-text-secondary)',
      'var(--color-surface-pane)',
      'var(--sidebar-backdrop)',
    ];
    expect(tab(backgroundTokens(settings(), false).tokens)).toEqual(plain);
    expect(backgroundTokens(settings(), false).tokens['--tab-strip-fade']).toContain('gradient');
    expect(backgroundTokens(settings(), false).tokens['--window-control-inset']).toBe('0px');
    expect(
      backgroundTokens(settings({ background: 'image' }), true).tokens['--window-control-inset'],
    ).toBe('8px');
    expect(
      backgroundTokens(settings({ background: 'image' }), true).tokens['--tab-strip-fade'],
    ).toBe('none');
    // An image setting with no stored image is the theme's own background.
    expect(tab(backgroundTokens(settings({ background: 'image' }), false).tokens)).toEqual(plain);
    expect(tab(backgroundTokens(settings({ background: 'image' }), true).tokens)).toEqual(chip);
    expect(tab(backgroundTokens(settings({ background: 'gradient' }), false).tokens)).toEqual(chip);
    expect(tab(backgroundTokens(settings({ background: 'solid' }), false).tokens)).toEqual(chip);
    expect(
      tab(backgroundTokens(settings({ backgroundPattern: 'halftone' }), false).tokens),
    ).toEqual(chip);
  });
});
