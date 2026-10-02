import {
  APPEARANCE,
  customThemeRef,
  parseCustomThemeRef,
  type CustomTheme,
  type CustomThemeColors,
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
