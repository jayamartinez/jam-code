import {
  APPEARANCE,
  customThemeRef,
  parseCustomThemeRef,
  type AppearanceSettings,
  type CustomTheme,
  type CustomThemeColors,
  type CustomThemeRole,
  type ThemeRef,
} from '@jam/protocol';
import { editorTheme } from './palettes';
import { THEMES, type Scheme, type ThemeDefinition } from './themes';

/**
 * The reader's own themes.
 *
 * A custom theme stores only anchor colors; it is drawn by the same builder
 * as JAM's editor-style themes, so every derived role and every contrast
 * floor is the same as for a built-in. A color that is too faint is raised
 * when the theme is drawn, never rewritten in the stored record.
 */

export function customThemeDefinition(
  theme: CustomTheme,
  scheme: Scheme,
): ThemeDefinition | undefined {
  const c = theme[scheme];
  if (!c) return undefined;
  return editorTheme({
    id: customThemeRef(theme.id, scheme),
    name: theme.name,
    family: theme.name,
    scheme,
    canvas: c.canvas,
    sidebar: c.sidebar,
    raised: c.raised,
    text: c.text,
    muted: c.muted,
    accent: c.accent,
    success: c.success,
    warning: c.warning,
    danger: c.danger,
    syntax: {
      keyword: c.keyword,
      string: c.string,
      number: c.number,
      function: c.function,
      type: c.type,
      property: c.property,
      operator: c.operator,
      comment: c.comment,
    },
    ansi: {
      red: c.red,
      green: c.green,
      yellow: c.yellow,
      blue: c.blue,
      magenta: c.magenta,
      cyan: c.cyan,
    },
  });
}

/** Any theme reference, built-in or custom; an unknown one draws Nightglass. */
export function themeFor(ref: ThemeRef, customThemes: readonly CustomTheme[]): ThemeDefinition {
  const custom = parseCustomThemeRef(ref);
  if (custom) {
    const theme = customThemes.find((item) => item.id === custom.id);
    return (theme && customThemeDefinition(theme, custom.scheme)) ?? THEMES.nightglass;
  }
  return THEMES[ref as keyof typeof THEMES] ?? THEMES.nightglass;
}

/** A theme's anchors, read back from its drawn roles: where a new theme starts. */
export function colorsFromDefinition(theme: ThemeDefinition): CustomThemeColors {
  return {
    canvas: theme.surfaces.pane[0],
    sidebar: theme.surfaces.sidebar[0],
    raised: theme.raised.startsWith('#') ? theme.raised : theme.surfaces.pane[0],
    text: theme.text.primary,
    muted: theme.text.muted,
    accent: theme.accent,
    success: theme.status.success,
    warning: theme.status.warning,
    danger: theme.status.danger,
    keyword: theme.syntax.keyword,
    string: theme.syntax.string,
    number: theme.syntax.number,
    function: theme.syntax.function,
    type: theme.syntax.type,
    property: theme.syntax.property,
    operator: theme.syntax.operator,
    comment: theme.syntax.comment,
    red: theme.ansi.red,
    green: theme.ansi.green,
    yellow: theme.ansi.yellow,
    blue: theme.ansi.blue,
    magenta: theme.ansi.magenta,
    cyan: theme.ansi.cyan,
  };
}

/** A lowercase id from the name, made unique among the reader's themes. */
export function newCustomThemeId(name: string, existing: readonly CustomTheme[]): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'theme';
  const taken = new Set(existing.map((theme) => theme.id));
  if (!taken.has(base)) return base;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Whether another custom theme may be added. */
export function canAddCustomTheme(existing: readonly CustomTheme[]): boolean {
  return existing.length < APPEARANCE.limits.customThemes;
}

/** The part of the appearance that choosing or changing a theme touches. */
type ThemeChoice = Pick<AppearanceSettings, 'theme' | 'customThemes'> &
  Partial<Pick<AppearanceSettings, 'paneOpacity' | 'sidebarOpacity'>>;

/** The name JAM gives the copy it saves when a built-in theme's color is changed. */
export const ownCopyName = (theme: ThemeDefinition) => `${theme.family} (custom)`;

/**
 * Sets one color of the theme in use, for the Appearance page, where nothing
 * is saved by pressing a button. One of the reader's themes is changed in
 * place. A built-in theme is never changed: its colors are saved as a theme
 * of the reader's own, reused if it is already there, and that becomes the
 * theme in use. A built-in may draw translucent surfaces and a theme of the
 * reader's own is opaque, so the copy comes with the built-in's opacities
 * unless the reader has set their own: changing one color changes nothing
 * else. Returns null when a copy is needed and there is no room.
 */
export function withThemeColor(
  appearance: ThemeChoice,
  role: CustomThemeRole,
  value: string,
): ThemeChoice | null {
  const { customThemes } = appearance;
  const active = parseCustomThemeRef(appearance.theme);
  const current = themeFor(appearance.theme, customThemes);
  const scheme = current.scheme;
  const write = (theme: CustomTheme): CustomTheme => ({
    ...theme,
    [scheme]: { ...(theme[scheme] ?? colorsFromDefinition(current)), [role]: value },
  });
  const mine = active && customThemes.find((item) => item.id === active.id);
  if (mine)
    return {
      theme: appearance.theme,
      customThemes: customThemes.map((item) => (item === mine ? write(item) : item)),
    };
  const opacities = {
    paneOpacity: appearance.paneOpacity ?? current.surfaces.pane[1],
    sidebarOpacity: appearance.sidebarOpacity ?? current.surfaces.sidebar[1],
  };
  const name = ownCopyName(current);
  const copy = customThemes.find((item) => item.name === name);
  if (copy)
    return {
      ...opacities,
      theme: customThemeRef(copy.id, scheme),
      customThemes: customThemes.map((item) => (item === copy ? write(item) : item)),
    };
  if (!canAddCustomTheme(customThemes)) return null;
  const id = newCustomThemeId(name, customThemes);
  return {
    ...opacities,
    theme: customThemeRef(id, scheme),
    customThemes: [...customThemes, write({ id, name })],
  };
}
