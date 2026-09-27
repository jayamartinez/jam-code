import {
  APPEARANCE,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  FONT_FAMILY,
  HEX_COLOR,
  type AppearanceSettings,
} from '@jam/protocol';
import { alpha } from './color';
import { ANSI_ROLES, SYNTAX_ROLES, THEMES, resolveAccent, type ThemeDefinition } from './themes';

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
  pick('theme', (item) => APPEARANCE.themes.includes(item as never));
  pick('accent', (item) => APPEARANCE.accents.includes(item as never));
  pick('background', (item) => APPEARANCE.backgrounds.includes(item as never));
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
  const opacity = input.paneOpacity;
  if (typeof opacity === 'number' && Number.isFinite(opacity)) {
    const [min, max] = APPEARANCE.limits.paneOpacity;
    result.paneOpacity = Math.round(Math.min(max, Math.max(min, opacity)));
  } else delete result.paneOpacity;
  return result;
}

export function themeOf(appearance: AppearanceSettings): ThemeDefinition {
  return THEMES[appearance.theme] ?? THEMES.nightglass;
}

/** Surface opacity: the theme's own, or every surface scaled by the reader's pane opacity. */
function surfaceAlpha(theme: ThemeDefinition, own: number, paneOpacity?: number) {
  if (paneOpacity === undefined) return own;
  return Math.min(100, (own * paneOpacity) / theme.surfaces.pane[1]);
}

export function colorTokens(appearance: AppearanceSettings): Record<string, string> {
  const theme = themeOf(appearance);
  const { surfaces, text, status, diff, provider } = theme;
  const surface = ([hex, own]: [string, number]) =>
    alpha(hex, surfaceAlpha(theme, own, appearance.paneOpacity));
  const tokens: Record<string, string> = {
    '--color-bg-base': theme.base,
    '--color-surface-sidebar': surface(surfaces.sidebar),
    '--color-surface-pane': surface(surfaces.pane),
    '--color-surface-pane-muted': surface(surfaces.paneMuted),
    '--color-surface-terminal': surface(surfaces.terminal),
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
    ...resolveAccent(theme, appearance.accent, appearance.customAccent),
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

/**
 * The wallpaper layer behind every pane. Brightness, saturation and blur apply
 * to this layer only; panes and text are never filtered. An image mode without
 * a stored image falls back to the theme's own background.
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
  return {
    mode,
    tokens: {
      '--wallpaper-color': mode === 'solid' ? appearance.backgroundColor : theme.base,
      '--wallpaper-layer': layer,
      '--wallpaper-filter': filters.length ? filters.join(' ') : 'none',
      // A blurred edge would fade to the window background; scale it past the edge.
      '--wallpaper-scale': String(1 + (appearance.backgroundBlur * 2) / 1000),
      '--pane-blur': mode === 'image' ? `${appearance.paneBlur}px` : '0px',
    },
  };
}

export function appearanceTokens(appearance: AppearanceSettings, hasWallpaper: boolean) {
  const background = backgroundTokens(appearance, hasWallpaper);
  return {
    scheme: themeOf(appearance).scheme,
    background: background.mode,
    tokens: {
      ...colorTokens(appearance),
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
