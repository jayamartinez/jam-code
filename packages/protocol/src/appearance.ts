import appearanceJson from '../fixtures/appearance.json';

/**
 * Appearance contract.
 *
 * Appearance is a persistent product setting, so the runtime stores it with
 * the rest of JAM's records rather than each client keeping its own copy. It
 * describes how JAM draws — theme, accent, typography, background — and never
 * what JAM does. The theme and accent names, defaults and bounds live in one
 * fixture shared with the Rust runtime, so the two can never accept different
 * values.
 */

export type ThemeId =
  | 'nightglass'
  | 'tide'
  | 'graphite'
  | 'oled'
  | 'frost'
  | 'linen'
  | 'claude-dark'
  | 'claude-light'
  | 'github-dark'
  | 'github-dark-dimmed'
  | 'github-light'
  | 'pierre-dark'
  | 'pierre-light'
  | 'one-dark-pro'
  | 'one-light'
  | 'vercel-dark'
  | 'vercel-light'
  | 'vscode-plus-dark'
  | 'vscode-plus-light'
  | 'xcode-dark'
  | 'xcode-light'
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'linear-dark'
  | 'linear-light'
  | 'notion-dark'
  | 'notion-light'
  | 'proof-dark'
  | 'proof-light'
  | 'raycast-dark'
  | 'raycast-light';
/**
 * One of the reader's own themes, in one of its variants:
 * `custom:<id>:dark` or `custom:<id>:light`.
 */
export type CustomThemeRef = `custom:${string}:${'dark' | 'light'}`;
/** The active theme: a built-in, or a variant of one of `customThemes`. */
export type ThemeRef = ThemeId | CustomThemeRef;

/**
 * The anchor colors a custom theme is written in. They are the same anchors
 * JAM's editor-style themes are built from, so every other role (text steps,
 * borders, fills, diff and terminal colors) is derived the same way and the
 * same contrast floors apply.
 */
export type CustomThemeRole =
  | 'canvas'
  | 'sidebar'
  | 'raised'
  | 'text'
  | 'muted'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'keyword'
  | 'string'
  | 'number'
  | 'function'
  | 'type'
  | 'property'
  | 'operator'
  | 'comment'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan';
export type CustomThemeColors = Record<CustomThemeRole, string>;

/** A theme the reader made or imported. It has a dark variant, a light one, or both. */
export interface CustomTheme {
  /** Lowercase letters, digits and hyphens; unique among the reader's themes. */
  id: string;
  name: string;
  dark?: CustomThemeColors;
  light?: CustomThemeColors;
}

export type AccentId =
  'theme' | 'blue' | 'cobalt' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'custom';
export type BackgroundMode = 'theme' | 'solid' | 'gradient' | 'image';
/** A static overlay drawn over the background, under every pane. */
export type BackgroundPattern = 'none' | 'halftone' | 'scanlines' | 'grid' | 'grain';

export interface AppearanceSettings {
  theme: ThemeRef;
  /** `theme` uses the theme's own accent; `custom` uses `customAccent`. */
  accent: AccentId;
  /** `#rrggbb`. Kept while another accent is chosen, so switching back restores it. */
  customAccent: string;
  /** Font family names. `''` means JAM's bundled default (Geist / Geist Mono). */
  uiFont: string;
  uiFontSize: number;
  codeFont: string;
  codeFontSize: number;
  codeLineHeight: number;
  /** `''` follows the code font. */
  terminalFont: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  background: BackgroundMode;
  backgroundColor: string;
  gradientFrom: string;
  gradientTo: string;
  gradientAngle: number;
  /** Percentages applied to the wallpaper layer only, never to panes or text. */
  backgroundBrightness: number;
  backgroundSaturation: number;
  /** Pixels of blur on the wallpaper layer. */
  backgroundBlur: number;
  backgroundPattern: BackgroundPattern;
  /** Pattern opacity in percent and cell size in pixels. */
  patternStrength: number;
  patternSize: number;
  /** Percent darkening (or lightening, on light themes) towards the bottom edge. */
  backgroundFade: number;
  /** Percent darkening towards the corners. */
  backgroundVignette: number;
  /** Main pane opacity in percent. Omitted keeps the theme's own. */
  paneOpacity?: number;
  /** Backdrop blur behind panes; used over an image or a pattern. */
  paneBlur: number;
  /** Sidebar opacity in percent. Omitted keeps the theme's own. */
  sidebarOpacity?: number;
  sidebarBlur: number;
  /** Take the accent and a surface tint from the wallpaper image. */
  autoColors: boolean;
  /** The reader's own themes, at most `limits.customThemes`. */
  customThemes: CustomTheme[];
}

/**
 * A wallpaper JAM keeps its own copy of. The client downsizes the chosen
 * image before sending it, so JAM never depends on the original file still
 * being where it was, and never stores a full-resolution photograph.
 */
export interface Wallpaper {
  /** `data:image/jpeg|png|webp;base64,…` */
  dataUrl: string;
  /** The original file's name, for display only. Never a path. */
  name: string;
  width: number;
  height: number;
}

type Range = [number, number];

export const APPEARANCE = appearanceJson as unknown as {
  themes: ThemeId[];
  accents: AccentId[];
  backgrounds: BackgroundMode[];
  patterns: BackgroundPattern[];
  customThemeRoles: CustomThemeRole[];
  defaults: AppearanceSettings;
  limits: {
    fontUtf16: number;
    uiFontSize: Range;
    codeFontSize: Range;
    codeLineHeight: Range;
    terminalFontSize: Range;
    terminalLineHeight: Range;
    gradientAngle: Range;
    backgroundBrightness: Range;
    backgroundSaturation: Range;
    backgroundBlur: Range;
    paneOpacity: Range;
    paneBlur: Range;
    sidebarOpacity: Range;
    sidebarBlur: Range;
    patternStrength: Range;
    patternSize: Range;
    backgroundFade: Range;
    backgroundVignette: Range;
    wallpaperUtf16: number;
    wallpaperNameUtf16: number;
    wallpaperPixels: number;
    customThemes: number;
    customThemeNameUtf16: number;
  };
};

export const DEFAULT_APPEARANCE: AppearanceSettings = APPEARANCE.defaults;

/** Numeric settings and their bounds, in one list so clamping and validation agree. */
export const APPEARANCE_RANGES = {
  uiFontSize: APPEARANCE.limits.uiFontSize,
  codeFontSize: APPEARANCE.limits.codeFontSize,
  codeLineHeight: APPEARANCE.limits.codeLineHeight,
  terminalFontSize: APPEARANCE.limits.terminalFontSize,
  terminalLineHeight: APPEARANCE.limits.terminalLineHeight,
  gradientAngle: APPEARANCE.limits.gradientAngle,
  backgroundBrightness: APPEARANCE.limits.backgroundBrightness,
  backgroundSaturation: APPEARANCE.limits.backgroundSaturation,
  backgroundBlur: APPEARANCE.limits.backgroundBlur,
  paneBlur: APPEARANCE.limits.paneBlur,
  sidebarBlur: APPEARANCE.limits.sidebarBlur,
  patternStrength: APPEARANCE.limits.patternStrength,
  patternSize: APPEARANCE.limits.patternSize,
  backgroundFade: APPEARANCE.limits.backgroundFade,
  backgroundVignette: APPEARANCE.limits.backgroundVignette,
} as const satisfies Partial<Record<keyof AppearanceSettings, Range>>;

export const HEX_COLOR = /^#[0-9a-f]{6}$/;
/**
 * A family name as CSS would quote it. Letters, digits, spaces and a little
 * punctuation: enough for every real font, and never enough to escape the
 * quoted string it is placed in.
 */
export const FONT_FAMILY = /^[\p{Alphabetic}\p{N} ._-]*$/u;
export const CUSTOM_THEME_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const CUSTOM_THEME_REF = /^custom:([a-z0-9][a-z0-9-]{0,31}):(dark|light)$/;
/** Control characters would let a name break a line or a layout. */
const hasControl = (value: string) =>
  [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

/** The `custom:<id>:<scheme>` reference for one variant of a custom theme. */
export function customThemeRef(id: string, scheme: 'dark' | 'light'): CustomThemeRef {
  return `custom:${id}:${scheme}`;
}

/** The theme and variant a reference names, or undefined for a built-in or a malformed one. */
export function parseCustomThemeRef(
  ref: string,
): { id: string; scheme: 'dark' | 'light' } | undefined {
  const match = CUSTOM_THEME_REF.exec(ref);
  return match ? { id: match[1]!, scheme: match[2] as 'dark' | 'light' } : undefined;
}

function isColors(value: unknown): value is CustomThemeColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === APPEARANCE.customThemeRoles.length &&
    APPEARANCE.customThemeRoles.every((role) => {
      const color = (value as Record<string, unknown>)[role];
      return typeof color === 'string' && HEX_COLOR.test(color);
    })
  );
}

/**
 * Why a custom theme is invalid, or null when it is valid. Shared by request
 * validation and by the client's reading of a stored record, so the two
 * cannot disagree; the Rust runtime applies the same rules.
 */
export function customThemeProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return 'A custom theme must be an object.';
  const theme = value as Record<string, unknown>;
  for (const key of Object.keys(theme))
    if (!['id', 'name', 'dark', 'light'].includes(key)) return `Unexpected field: ${key}.`;
  if (typeof theme.id !== 'string' || !CUSTOM_THEME_ID.test(theme.id))
    return 'A custom theme id must be lowercase letters, digits and hyphens.';
  if (
    typeof theme.name !== 'string' ||
    !theme.name.trim() ||
    theme.name.length > APPEARANCE.limits.customThemeNameUtf16 ||
    hasControl(theme.name)
  )
    return 'A custom theme needs a short name.';
  if (theme.dark === undefined && theme.light === undefined)
    return 'A custom theme needs a dark or a light variant.';
  for (const variant of ['dark', 'light'] as const)
    if (theme[variant] !== undefined && !isColors(theme[variant]))
      return 'A custom theme variant must give every role as #rrggbb.';
  return null;
}

/**
 * Checks the reader's themes as a list and the active theme against them:
 * at most the limit, unique ids, and a `custom:` theme that exists.
 */
export function appearanceThemeProblem(theme: unknown, customThemes: unknown): string | null {
  if (!Array.isArray(customThemes) || customThemes.length > APPEARANCE.limits.customThemes)
    return `At most ${APPEARANCE.limits.customThemes} custom themes.`;
  for (const item of customThemes) {
    const problem = customThemeProblem(item);
    if (problem) return problem;
  }
  const ids = customThemes.map((item: CustomTheme) => item.id);
  if (new Set(ids).size !== ids.length) return 'Custom theme ids must be unique.';
  if (typeof theme !== 'string') return 'Unknown theme.';
  if (APPEARANCE.themes.includes(theme as ThemeId)) return null;
  const ref = parseCustomThemeRef(theme);
  const target = ref && (customThemes as CustomTheme[]).find((item) => item.id === ref.id);
  return target && target[ref.scheme] ? null : 'Unknown theme.';
}

export const WALLPAPER_PREFIX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export interface AppearanceRequestMap {
  /** Each is omitted until something has been saved. */
  'appearance.get': {
    params: Record<string, never>;
    result: { appearance?: AppearanceSettings; wallpaper?: Wallpaper };
  };
  /** Replaces the whole record; there are no partial updates to merge. */
  'appearance.update': {
    params: { appearance: AppearanceSettings };
    result: { appearance: AppearanceSettings };
  };
  /** Omitting the wallpaper forgets the stored one. */
  'appearance.setWallpaper': {
    params: { wallpaper?: Wallpaper };
    result: { updatedAt: string };
  };
}
