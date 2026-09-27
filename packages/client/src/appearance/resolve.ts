import {
  APPEARANCE,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  FONT_FAMILY,
  HEX_COLOR,
  appearanceThemeProblem,
  customThemeProblem,
  type AppearanceSettings,
  type CustomTheme,
} from '@jam/protocol';
import { themeFor } from './custom';
import { alpha, mix } from './color';
import type { WallpaperPalette } from './palette';
import {
  ANSI_ROLES,
  SYNTAX_ROLES,
  accentRoles,
  legible,
  resolveAccent,
  type ThemeDefinition,
} from './themes';

/**
 * Appearance settings → semantic tokens.
 *
 * Pure functions: given the settings, produce every custom property JAM's
 * surfaces read. Nothing here touches the DOM, so theme resolution is tested
 * without a browser and applied in one place (`apply.ts`).
 */

/** The design's UI size; `--ui-scale` is relative to it. */
export const DESIGN_UI_SIZE = 13;

/** JAM's bundled faces, always last in a stack so a missing choice still renders. */
export const SANS_STACK = `'Geist Variable', Geist, system-ui, sans-serif`;
export const MONO_STACK = `'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;

/** Generic families are keywords and must not be quoted. */
const GENERIC = new Set(['system-ui', 'ui-monospace', 'ui-sans-serif', 'monospace', 'sans-serif']);

export function fontStack(family: string, fallback: string): string {
  if (!family || !FONT_FAMILY.test(family)) return fallback;
  return `${GENERIC.has(family) ? family : `'${family}'`}, ${fallback}`;
}

/**
 * Anything stored by an older or newer JAM, or by hand, becomes a complete
 * valid record: unknown values fall back to defaults and numbers are clamped.
 */
export function normalizeAppearance(value: unknown): AppearanceSettings {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const result: AppearanceSettings = { ...DEFAULT_APPEARANCE };
  const pick = <K extends keyof AppearanceSettings>(key: K, valid: (item: unknown) => boolean) => {
    if (valid(input[key])) result[key] = input[key] as AppearanceSettings[K];
  };
  // The reader's themes first: the active theme may name one of them.
  if (Array.isArray(input.customThemes)) {
    const seen = new Set<string>();
    result.customThemes = (input.customThemes as unknown[])
      .filter((item): item is CustomTheme => {
        if (customThemeProblem(item)) return false;
        const { id } = item as CustomTheme;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, APPEARANCE.limits.customThemes);
  }
  pick('theme', (item) => !appearanceThemeProblem(item, result.customThemes));
  pick('accent', (item) => APPEARANCE.accents.includes(item as never));
  pick('background', (item) => APPEARANCE.backgrounds.includes(item as never));
  pick('backgroundPattern', (item) => APPEARANCE.patterns.includes(item as never));
  pick('autoColors', (item) => typeof item === 'boolean');
  for (const key of ['customAccent', 'backgroundColor', 'gradientFrom', 'gradientTo'] as const)
    pick(key, (item) => typeof item === 'string' && HEX_COLOR.test(item));
  for (const key of ['uiFont', 'codeFont', 'terminalFont'] as const)
    pick(
      key,
      (item) =>
        typeof item === 'string' &&
        item.length <= APPEARANCE.limits.fontUtf16 &&
        FONT_FAMILY.test(item),
    );
  for (const [key, [min, max]] of Object.entries(APPEARANCE_RANGES) as [
    keyof typeof APPEARANCE_RANGES,
    [number, number],
  ][]) {
    const item = input[key];
    if (typeof item === 'number' && Number.isFinite(item))
      result[key] = Math.round(Math.min(max, Math.max(min, item)));
  }
  for (const key of ['paneOpacity', 'sidebarOpacity'] as const) {
    const opacity = input[key];
    if (typeof opacity === 'number' && Number.isFinite(opacity)) {
      const [min, max] = APPEARANCE.limits[key];
      result[key] = Math.round(Math.min(max, Math.max(min, opacity)));
    } else delete result[key];
  }
  return result;
}

/** What the resolver knows about the stored wallpaper. */
export interface WallpaperContext {
  present: boolean;
  palette?: WallpaperPalette;
}

/** "Match colours to image" is in effect: an image is shown and its colours are known. */
function matchesImage(appearance: AppearanceSettings, wallpaper: WallpaperContext) {
  return (
    appearance.autoColors &&
    appearance.background === 'image' &&
    wallpaper.present &&
    !!wallpaper.palette
  );
}

/**
 * The theme with its grounds and surfaces pulled towards the wallpaper's own
 * dark (or light) tone. Text, code and status colours are untouched, so the
 * contrast floors still hold.
 */
function tintedTheme(theme: ThemeDefinition, palette: WallpaperPalette): ThemeDefinition {
  const ground = theme.scheme === 'dark' ? palette.groundDark : palette.groundLight;
  const tint = (hex: string, amount = 0.3) => mix(hex, ground, amount);
  const surface = ([hex, own]: [string, number]): [string, number] => [tint(hex), own];
  return {
    ...theme,
    base: tint(theme.base, 0.45),
    surfaces: {
      sidebar: surface(theme.surfaces.sidebar),
      pane: surface(theme.surfaces.pane),
      paneMuted: surface(theme.surfaces.paneMuted),
      terminal: surface(theme.surfaces.terminal),
    },
    raised: tint(theme.raised, 0.22),
    overlay: tint(theme.overlay, 0.22),
    badgeRing: tint(theme.badgeRing),
  };
}

export function themeOf(appearance: AppearanceSettings): ThemeDefinition {
  return themeFor(appearance.theme, appearance.customThemes);
}

/**
 * Surface opacity. The sidebar and the main pane are set independently; the
 * pane's muted and terminal variants follow the pane in proportion, so they
 * keep their relative weight.
 */
function paneAlpha(theme: ThemeDefinition, own: number, paneOpacity?: number) {
  if (paneOpacity === undefined) return own;
  return Math.min(100, (own * paneOpacity) / theme.surfaces.pane[1]);
}

export function colorTokens(
  appearance: AppearanceSettings,
  wallpaper: WallpaperContext = { present: false },
): Record<string, string> {
  const matched = matchesImage(appearance, wallpaper);
  const own = themeOf(appearance);
  const theme = matched ? tintedTheme(own, wallpaper.palette!) : own;
  const { surfaces, text, status, diff, provider } = theme;
  const pane = ([hex, alphaOwn]: [string, number]) =>
    alpha(hex, paneAlpha(theme, alphaOwn, appearance.paneOpacity));
  const [sidebarHex, sidebarOwn] = surfaces.sidebar;
  const accent = matched
    ? (() => {
        const palette = wallpaper.palette!;
        const main = legible(
          theme.scheme === 'dark' ? palette.accentDark : palette.accentLight,
          theme,
        );
        const secondary = mix(main, theme.scheme === 'dark' ? '#ffffff' : '#000000', 0.18);
        return accentRoles(main, secondary, theme.scheme, surfaces.pane[0]);
      })()
    : resolveAccent(theme, appearance.accent, appearance.customAccent);
  const tokens: Record<string, string> = {
    '--color-bg-base': theme.base,
    '--color-surface-sidebar': alpha(sidebarHex, appearance.sidebarOpacity ?? sidebarOwn),
    '--color-surface-pane': pane(surfaces.pane),
    '--color-surface-pane-muted': pane(surfaces.paneMuted),
    '--color-surface-terminal': pane(surfaces.terminal),
    '--color-surface-raised': theme.raised,
    '--color-surface-overlay': theme.overlay,
    '--color-scrim': theme.scrim,
    '--color-surface-browser-well': theme.browserWell,
    '--color-badge-ring': theme.badgeRing,
    '--color-fill-subtle': alpha(theme.tint, theme.fills[0]),
    '--color-fill': alpha(theme.tint, theme.fills[1]),
    '--color-fill-strong': alpha(theme.tint, theme.fills[2]),
    '--color-border-subtle': alpha(theme.tint, theme.borders[0]),
    '--color-border': alpha(theme.tint, theme.borders[1]),
    '--color-border-strong': alpha(theme.tint, theme.borders[2]),
    '--color-text-strong': text.strong,
    '--color-text-primary': text.primary,
    '--color-text-body': text.body,
    '--color-text-secondary': text.secondary,
    '--color-text-muted': text.muted,
    '--color-text-subtle': text.subtle,
    '--color-text-faint': text.faint,
    '--color-text-ghost': text.ghost,
    ...accent,
    '--color-success': status.success,
    '--color-success-soft': alpha(status.success, status.soft[0]),
    '--color-warning': status.warning,
    '--color-warning-soft': alpha(status.warning, status.soft[1]),
    '--color-danger': status.danger,
    '--color-danger-soft': alpha(status.danger, status.soft[2]),
    '--color-diff-add-text': diff.addText,
    '--color-diff-del-text': diff.delText,
    '--color-diff-add-gutter': diff.addGutter,
    '--color-diff-del-gutter': diff.delGutter,
    '--color-provider-claude': provider.claude,
    '--color-tone-violet': provider.violet,
    '--color-provider-codex': provider.codex,
    '--color-provider-codex-from': provider.codexStops[0],
    '--color-provider-codex-mid': provider.codexStops[1],
    '--color-provider-codex-to': provider.codexStops[2],
    '--color-terminal-foreground': theme.terminal.foreground,
    '--color-terminal-cursor': theme.terminal.cursor,
    '--background-glow': theme.glow,
  };
  for (const role of SYNTAX_ROLES) tokens[`--syntax-${role}`] = theme.syntax[role];
  for (const role of ANSI_ROLES) tokens[`--color-ansi-${role}`] = theme.ansi[role];
  return tokens;
}

export function typographyTokens(appearance: AppearanceSettings): Record<string, string> {
  const code = fontStack(appearance.codeFont, MONO_STACK);
  return {
    '--ui-scale': String(Math.round((appearance.uiFontSize / DESIGN_UI_SIZE) * 10_000) / 10_000),
    '--font-sans-stack': fontStack(appearance.uiFont, SANS_STACK),
    '--editor-font-family': code,
    '--editor-font-size': `${appearance.codeFontSize}px`,
    '--editor-line-height': `${appearance.codeLineHeight}px`,
    '--terminal-font-family': appearance.terminalFont
      ? fontStack(appearance.terminalFont, MONO_STACK)
      : code,
    '--terminal-font-size': `${appearance.terminalFontSize}px`,
    '--terminal-line-height': `${appearance.terminalLineHeight}px`,
  };
}

const shade = (percent: number) =>
  `color-mix(in srgb, var(--color-bg-base) ${percent}%, transparent)`;

/** Film grain: SVG turbulence, rasterised once as a small repeating tile. */
function grain(strength: number) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 ${((strength / 100) * 0.55).toFixed(3)} 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg}")`;
}

/**
 * Static overlays between the background and the panes: a pattern (halftone
 * dots, scanlines, a fine grid or film grain), a fade towards the bottom edge
 * and a vignette. All are CSS gradients or one tiny SVG tile, painted once and
 * composited; nothing animates and nothing is computed per frame. They darken
 * towards the theme's ground, so on a light theme they lighten instead.
 */
export function effectTokens(appearance: AppearanceSettings): Record<string, string> {
  const layers: [image: string, size: string][] = [];
  const { patternStrength: strength, patternSize: size } = appearance;
  if (appearance.backgroundVignette > 0)
    layers.push([
      `radial-gradient(ellipse at center, transparent 40%, ${shade(appearance.backgroundVignette)} 100%)`,
      'auto',
    ]);
  if (appearance.backgroundFade > 0)
    layers.push([
      `linear-gradient(to bottom, transparent 20%, ${shade(appearance.backgroundFade)} 100%)`,
      'auto',
    ]);
  if (strength > 0)
    switch (appearance.backgroundPattern) {
      case 'halftone':
        layers.push([
          `radial-gradient(circle at center, transparent 30%, ${shade(strength)} 64%)`,
          `${size}px ${size}px`,
        ]);
        break;
      case 'scanlines':
        layers.push([
          `repeating-linear-gradient(to bottom, ${shade(strength)} 0 1px, transparent 1px ${size}px)`,
          'auto',
        ]);
        break;
      case 'grid': {
        const line = `color-mix(in srgb, var(--color-text-strong) ${Math.round(strength / 4)}%, transparent)`;
        const cell = `${size * 6}px ${size * 6}px`;
        layers.push([`linear-gradient(to right, ${line} 1px, transparent 1px)`, cell]);
        layers.push([`linear-gradient(to bottom, ${line} 1px, transparent 1px)`, cell]);
        break;
      }
      case 'grain':
        layers.push([grain(strength), `${size * 40}px ${size * 40}px`]);
        break;
    }
  return {
    '--wallpaper-effects': layers.length ? layers.map(([image]) => image).join(', ') : 'none',
    '--wallpaper-effects-size': layers.length ? layers.map(([, size]) => size).join(', ') : 'auto',
  };
}

/**
 * The wallpaper layer behind every pane. Brightness, saturation and blur apply
 * to this layer only; panes and text are never filtered. An image mode without
 * a stored image falls back to the theme's own background. Backdrop blur runs
 * only where there is detail to soften — an image or a pattern — and only on a
 * surface that is not already opaque.
 */
export function backgroundTokens(
  appearance: AppearanceSettings,
  hasWallpaper: boolean,
): { mode: AppearanceSettings['background']; tokens: Record<string, string> } {
  const theme = themeOf(appearance);
  const mode = appearance.background === 'image' && !hasWallpaper ? 'theme' : appearance.background;
  const layer = {
    theme: 'var(--background-glow)',
    solid: 'none',
    gradient: `linear-gradient(${appearance.gradientAngle}deg, ${appearance.gradientFrom}, ${appearance.gradientTo})`,
    image: 'var(--wallpaper-image)',
  }[mode];
  const filters = [
    appearance.backgroundBrightness !== 100 && `brightness(${appearance.backgroundBrightness}%)`,
    appearance.backgroundSaturation !== 100 && `saturate(${appearance.backgroundSaturation}%)`,
    appearance.backgroundBlur > 0 && `blur(${appearance.backgroundBlur}px)`,
  ].filter(Boolean);
  const detailed =
    mode === 'image' || (appearance.backgroundPattern !== 'none' && appearance.patternStrength > 0);
  const paneOpaque = (appearance.paneOpacity ?? theme.surfaces.pane[1]) >= 100;
  const sidebarOpaque = (appearance.sidebarOpacity ?? theme.surfaces.sidebar[1]) >= 100;
  return {
    mode,
    tokens: {
      '--wallpaper-color': mode === 'solid' ? appearance.backgroundColor : theme.base,
      '--wallpaper-layer': layer,
      '--wallpaper-filter': filters.length ? filters.join(' ') : 'none',
      // A blurred edge would fade to the window background; scale it past the edge.
      '--wallpaper-scale': String(1 + (appearance.backgroundBlur * 2) / 1000),
      '--pane-backdrop':
        detailed && !paneOpaque && appearance.paneBlur > 0
          ? `blur(${appearance.paneBlur}px)`
          : 'none',
      '--sidebar-backdrop':
        detailed && !sidebarOpaque && appearance.sidebarBlur > 0
          ? `blur(${appearance.sidebarBlur}px)`
          : 'none',
      ...effectTokens(appearance),
    },
  };
}

export function appearanceTokens(
  appearance: AppearanceSettings,
  wallpaper: WallpaperContext = { present: false },
) {
  const background = backgroundTokens(appearance, wallpaper.present);
  return {
    scheme: themeOf(appearance).scheme,
    background: background.mode,
    tokens: {
      ...colorTokens(appearance, wallpaper),
      ...typographyTokens(appearance),
      ...background.tokens,
    },
  };
}

/** One rule, doubled `:root` so it outranks tokens.css whatever order styles load in. */
export function tokenStylesheet(tokens: Record<string, string>, scheme: 'dark' | 'light'): string {
  const declarations = Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `:root:root {\n  color-scheme: ${scheme};\n${declarations}\n}\n`;
}
