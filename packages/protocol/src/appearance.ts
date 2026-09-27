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
export type AccentId =
  'theme' | 'blue' | 'cobalt' | 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'custom';
export type BackgroundMode = 'theme' | 'solid' | 'gradient' | 'image';
/** A static overlay drawn over the background, under every pane. */
export type BackgroundPattern = 'none' | 'halftone' | 'scanlines' | 'grid' | 'grain';

export interface AppearanceSettings {
  theme: ThemeId;
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

export const APPEARANCE = appearanceJson as {
  themes: ThemeId[];
  accents: AccentId[];
  backgrounds: BackgroundMode[];
  patterns: BackgroundPattern[];
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
