import {
  APPEARANCE,
  customThemeProblem,
  type CustomTheme,
  type CustomThemeColors,
  type CustomThemeRole,
} from '@jam/protocol';
import { luminance, mix } from './color';
import { colorsFromDefinition } from './custom';
import { THEMES, type Scheme } from './themes';

/**
 * Theme files in and out.
 *
 * JAM's own format is the custom theme record with a version marker. A VS
 * Code color theme is mapped onto JAM's anchor roles: workbench colors for
 * surfaces, text and status, `tokenColors` scopes for syntax, the terminal
 * palette for ANSI. Roles the file does not give are taken from JAM's own
 * theme of the same brightness and reported as derived. Parsing is pure and
 * bounded; the file arrives as text, never as a path.
 */

export const THEME_FILE_BYTES = 512 * 1024;
const FORMAT_VERSION = 1;

export interface ImportedTheme {
  theme: Omit<CustomTheme, 'id'>;
  format: 'jam' | 'vscode';
  /** Roles the file gave, and roles JAM filled in, across every variant. */
  mapped: number;
  derived: number;
  derivedRoles: CustomThemeRole[];
}

/** JSON with the comments and trailing commas VS Code theme files often carry. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      out += char;
      if (char === '\\') out += text[++i] ?? '';
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as opaque `#rrggbb`, blending alpha over the ground. */
export function normalizeColor(value: unknown, ground = '#000000'): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex))
    return `#${[...hex.slice(1)].map((digit) => digit + digit).join('')}`;
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{8}$/.test(hex)) {
    const opacity = parseInt(hex.slice(7), 16) / 255;
    return mix(ground, hex.slice(0, 7), opacity);
  }
  return undefined;
}

const WORKBENCH: Partial<Record<CustomThemeRole, string[]>> = {
  canvas: ['editor.background'],
  sidebar: ['sideBar.background', 'activityBar.background', 'panel.background'],
  raised: ['editorWidget.background', 'dropdown.background', 'input.background'],
  text: ['editor.foreground', 'foreground'],
  muted: ['descriptionForeground', 'disabledForeground', 'editorLineNumber.activeForeground'],
  accent: [
    'focusBorder',
    'button.background',
    'textLink.foreground',
    'activityBarBadge.background',
  ],
  success: ['terminal.ansiGreen', 'gitDecoration.addedResourceForeground'],
  warning: ['editorWarning.foreground', 'terminal.ansiYellow'],
  danger: ['editorError.foreground', 'errorForeground', 'terminal.ansiRed'],
  red: ['terminal.ansiRed'],
  green: ['terminal.ansiGreen'],
  yellow: ['terminal.ansiYellow'],
  blue: ['terminal.ansiBlue'],
  magenta: ['terminal.ansiMagenta'],
  cyan: ['terminal.ansiCyan'],
};

/** For each syntax role, the token scopes to look up, most specific intent first. */
const SCOPES: Partial<Record<CustomThemeRole, string[]>> = {
  keyword: ['keyword.control', 'keyword', 'storage.type', 'storage.modifier', 'storage'],
  string: ['string.quoted', 'string'],
  number: ['constant.numeric', 'constant.language', 'constant'],
  function: ['entity.name.function', 'support.function', 'meta.function-call'],
  type: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
  property: [
    'variable.other.property',
    'variable.other.object.property',
    'support.type.property-name',
    'meta.object-literal.key',
  ],
  operator: ['keyword.operator'],
  comment: ['comment'],
};

interface TokenRule {
  scopes: string[];
  foreground: string;
}

function tokenRules(value: unknown, ground: string): TokenRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rule: unknown) => {
    if (!rule || typeof rule !== 'object') return [];
    const { scope, settings } = rule as { scope?: unknown; settings?: { foreground?: unknown } };
    const foreground = normalizeColor(settings?.foreground, ground);
    const list = typeof scope === 'string' ? scope.split(',') : Array.isArray(scope) ? scope : [];
    const scopes = list
      .filter((item): item is string => typeof item === 'string')
      // A descendant selector ("meta.class entity.name") is matched by its last scope.
      .map((item) => item.trim().split(/\s+/).pop() ?? '')
      .filter(Boolean);
    return foreground && scopes.length ? [{ scopes, foreground }] : [];
  });
}

/** The color a token of `target` scope gets: the rule whose scope is its longest prefix. */
function scopeColor(rules: TokenRule[], target: string): string | undefined {
  let best: { length: number; color: string } | undefined;
  for (const rule of rules)
    for (const scope of rule.scopes)
      if (
        (target === scope || target.startsWith(`${scope}.`)) &&
        scope.length >= (best?.length ?? 0)
      )
        best = { length: scope.length, color: rule.foreground };
  return best?.color;
}

function vscodeScheme(type: unknown, canvas: string): Scheme {
  if (type === 'light' || type === 'hcLight') return 'light';
  if (type === 'dark' || type === 'hc' || type === 'hcDark') return 'dark';
  return luminance(canvas) < 0.4 ? 'dark' : 'light';
}

const fallback = (scheme: Scheme) =>
  colorsFromDefinition(scheme === 'dark' ? THEMES.nightglass : THEMES.frost);

function fromVsCode(file: Record<string, unknown>, fileName: string): ImportedTheme {
  const workbench = (file.colors && typeof file.colors === 'object' ? file.colors : {}) as Record<
    string,
    unknown
  >;
  const canvas = normalizeColor(workbench['editor.background']);
  if (!canvas) throw new Error('This theme has no editor.background color.');
  const scheme = vscodeScheme(file.type, canvas);
  const rules = tokenRules(file.tokenColors, canvas);
  const base = fallback(scheme);
  const colors = {} as CustomThemeColors;
  const derivedRoles: CustomThemeRole[] = [];
  for (const role of APPEARANCE.customThemeRoles) {
    const fromWorkbench = WORKBENCH[role]
      ?.map((key) => normalizeColor(workbench[key], canvas))
      .find(Boolean);
    const fromScopes = SCOPES[role]?.map((scope) => scopeColor(rules, scope)).find(Boolean);
    const found = fromWorkbench ?? fromScopes;
    if (found) colors[role] = found;
    else {
      derivedRoles.push(role);
      colors[role] = base[role];
    }
  }
  // A sidebar the file leaves out sits a step from the canvas, as editors draw it.
  if (derivedRoles.includes('sidebar'))
    colors.sidebar = mix(canvas, scheme === 'dark' ? '#000000' : '#ffffff', 0.18);
  if (derivedRoles.includes('raised'))
    colors.raised = mix(canvas, scheme === 'dark' ? '#ffffff' : '#000000', 0.05);
  const name =
    (typeof file.name === 'string' && file.name.trim()) ||
    fileName.replace(/(-color-theme)?\.jsonc?$/i, '') ||
    'Imported theme';
  return {
    theme: { name: name.slice(0, APPEARANCE.limits.customThemeNameUtf16), [scheme]: colors },
    format: 'vscode',
    mapped: APPEARANCE.customThemeRoles.length - derivedRoles.length,
    derived: derivedRoles.length,
    derivedRoles,
  };
}

function fromJam(file: Record<string, unknown>): ImportedTheme {
  const theme = { id: 'import', name: file.name, dark: file.dark, light: file.light };
  const problem = customThemeProblem(
    Object.fromEntries(Object.entries(theme).filter(([, value]) => value !== undefined)),
  );
  if (problem) throw new Error(problem);
  const variants = (file.dark ? 1 : 0) + (file.light ? 1 : 0);
  return {
    theme: {
      name: file.name as string,
      ...(file.dark ? { dark: file.dark as CustomThemeColors } : {}),
      ...(file.light ? { light: file.light as CustomThemeColors } : {}),
    },
    format: 'jam',
    mapped: variants * APPEARANCE.customThemeRoles.length,
    derived: 0,
    derivedRoles: [],
  };
}

/** Reads a JAM theme file or a VS Code color theme. Throws with a readable reason. */
export function importTheme(text: string, fileName = ''): ImportedTheme {
  if (text.length > THEME_FILE_BYTES) throw new Error('Theme files are limited to 512 KB.');
  let file: unknown;
  try {
    file = parseJsonc(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!file || typeof file !== 'object' || Array.isArray(file))
    throw new Error('This file is not a theme.');
  const record = file as Record<string, unknown>;
  if (record.jamTheme === FORMAT_VERSION) return fromJam(record);
  if (record.colors || record.tokenColors) return fromVsCode(record, fileName);
  throw new Error('This is neither a JAM theme nor a VS Code color theme.');
}

/** The file Export writes: the theme without its local id. */
export function exportTheme(theme: CustomTheme): string {
  const { name, dark, light } = theme;
  return `${JSON.stringify(
    { jamTheme: FORMAT_VERSION, name, ...(dark ? { dark } : {}), ...(light ? { light } : {}) },
    null,
    2,
  )}\n`;
}
