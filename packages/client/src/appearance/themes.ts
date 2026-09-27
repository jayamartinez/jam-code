import type { AccentId, ThemeId } from '@jam/protocol';
import { alpha, contrast, ensureContrast, luminance, mix } from './color';
import { EDITOR_THEMES } from './palettes';

/**
 * JAM's built-in themes.
 *
 * A theme is a set of values for the semantic roles in `styles/tokens.css`,
 * never a set of component colours. Components read roles such as
 * `--color-surface-pane` or `--syntax-keyword`; switching theme only remaps
 * them. Nightglass reproduces the Paper tokens exactly; Graphite and Tide
 * follow Paper's "Same components, remapped tokens" frame; OLED, Frost and
 * Linen extend the same roles conservatively.
 */

export type Scheme = 'dark' | 'light';

/** Highlight categories shared by CodeMirror, fenced code in Markdown and anything else that colours code. */
export const SYNTAX_ROLES = [
  'keyword',
  'string',
  'number',
  'function',
  'type',
  'property',
  'variable',
  'definition',
  'operator',
  'punctuation',
  'comment',
  'tag',
  'attribute',
  'meta',
  'heading',
  'link',
  'code',
  'quote',
  'marker',
] as const;
export type SyntaxRole = (typeof SYNTAX_ROLES)[number];

export const ANSI_ROLES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
] as const;
export type AnsiRole = (typeof ANSI_ROLES)[number];

interface Text {
  strong: string;
  primary: string;
  body: string;
  secondary: string;
  muted: string;
  subtle: string;
  faint: string;
  ghost: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  /** Themes that are light and dark versions of one another share a family. */
  family: string;
  /** One line for the picker, in Paper's "opaque · no wallpaper" register. */
  note: string;
  scheme: Scheme;
  base: string;
  /** Opaque colours of the translucent surfaces, with their default opacity in percent. */
  surfaces: {
    sidebar: [string, number];
    pane: [string, number];
    paneMuted: [string, number];
    terminal: [string, number];
  };
  raised: string;
  overlay: string;
  scrim: string;
  browserWell: string;
  badgeRing: string;
  /** Fills and borders are this tint at small opacities. */
  tint: string;
  fills: [number, number, number];
  borders: [number, number, number];
  text: Text;
  /** The theme's own accent, used when the reader keeps "Theme accent". */
  accent: string;
  accentSecondary: string;
  /** Exact accent roles where a design fixes them (Nightglass); otherwise derived. */
  accentRoles?: Partial<Record<'strong' | 'soft' | 'border' | 'glow' | 'on', string>>;
  status: { success: string; warning: string; danger: string; soft: [number, number, number] };
  diff: { addText: string; delText: string; addGutter: string; delGutter: string };
  provider: { claude: string; codex: string; violet: string; codexStops: [string, string, string] };
  /** Background-image layers for the "Theme" background, or `none`. */
  glow: string;
  syntax: Record<SyntaxRole, string>;
  ansi: Record<AnsiRole, string>;
  terminal: { foreground: string; cursor: string };
}

const codexStops: [string, string, string] = ['#b1a7ff', '#7a9dff', '#3941ff'];

const NIGHTGLASS_TEXT: Text = {
  strong: '#f1f3f9',
  primary: '#e3e6ee',
  body: '#d2d6e0',
  secondary: '#b1b6c3',
  muted: '#9095a3',
  subtle: '#6d7281',
  faint: '#575b68',
  ghost: '#444855',
};

/** The dark ANSI mapping JAM has always used: status roles and text steps. */
function darkAnsi(
  text: Text,
  colours: {
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    brightRed: string;
    brightGreen: string;
    brightBlue: string;
  },
): Record<AnsiRole, string> {
  return {
    black: text.ghost,
    red: colours.red,
    green: colours.green,
    yellow: colours.yellow,
    blue: colours.blue,
    magenta: colours.magenta,
    cyan: colours.cyan,
    white: text.secondary,
    // Dim text such as shell suggestions uses bright black, so it stays legible.
    'bright-black': text.subtle,
    'bright-red': colours.brightRed,
    'bright-green': colours.brightGreen,
    'bright-yellow': mix(colours.yellow, text.strong, 0.38),
    'bright-blue': colours.brightBlue,
    'bright-magenta': mix(colours.magenta, text.strong, 0.38),
    'bright-cyan': mix(colours.cyan, text.strong, 0.38),
    'bright-white': text.strong,
  };
}

const nightglass: ThemeDefinition = {
  id: 'nightglass',
  family: 'Nightglass',
  name: 'Nightglass',
  note: 'default',
  scheme: 'dark',
  base: '#07080c',
  surfaces: {
    sidebar: ['#090a0f', 62],
    pane: ['#0c0d13', 78],
    paneMuted: ['#0c0d13', 66],
    terminal: ['#06070a', 74],
  },
  raised: '#171820',
  overlay: '#14151b',
  scrim: 'rgb(4 5 9 / 62%)',
  browserWell: 'rgb(0 0 0 / 25%)',
  badgeRing: '#0f1119',
  tint: '#bed2ff',
  fills: [3.5, 6, 9],
  borders: [5, 8, 12],
  text: NIGHTGLASS_TEXT,
  accent: '#6f9bff',
  accentSecondary: '#5fb4ff',
  accentRoles: {
    strong: '#a8c3ff',
    soft: 'rgb(111 155 255 / 12%)',
    border: 'rgb(111 155 255 / 28%)',
    glow: 'rgb(111 155 255 / 55%)',
    on: '#07101f',
  },
  status: { success: '#7ec39a', warning: '#e6a85e', danger: '#e6807a', soft: [11, 12, 10] },
  diff: { addText: '#b0d9bf', delText: '#e9aea9', addGutter: '#5a7e68', delGutter: '#8e5c58' },
  provider: { claude: '#d48f74', codex: '#c3c9d6', violet: '#a99bff', codexStops },
  glow: [
    'radial-gradient(circle farthest-corner at 50% 50% in oklab, oklab(86.4% -0.004 -0.066 / 7%) 0%, transparent 100%)',
    'radial-gradient(ellipse 60% 55% at 85% 0% in oklab, oklab(55.8% -0.023 -0.198 / 58%) 0%, transparent 70%)',
    'radial-gradient(ellipse 55% 50% at 25% 105% in oklab, oklab(44.2% -0.013 -0.179 / 50%) 0%, transparent 70%)',
    'radial-gradient(ellipse 45% 45% at 100% 100% in oklab, oklab(64.1% -0.068 -0.111 / 35%) 0%, transparent 70%)',
  ].join(', '),
  syntax: {
    keyword: '#8fb0ff',
    string: '#9fd1b0',
    number: '#e8b784',
    function: '#bccfff',
    type: '#7cc7e8',
    property: '#c9d0de',
    variable: '#d2d6e0',
    definition: '#e3e6ee',
    operator: '#99a4c2',
    punctuation: '#7b8194',
    comment: '#6a7185',
    tag: '#8fb0ff',
    attribute: '#b8a9f5',
    meta: '#b8a9f5',
    heading: '#f1f3f9',
    link: '#8fb0ff',
    code: '#e8b784',
    quote: '#9095a3',
    marker: '#6f9bff',
  },
  ansi: darkAnsi(NIGHTGLASS_TEXT, {
    red: '#e6807a',
    green: '#7ec39a',
    yellow: '#e6a85e',
    blue: '#6f9bff',
    magenta: '#a99bff',
    cyan: '#5fb4ff',
    brightRed: '#e9aea9',
    brightGreen: '#b0d9bf',
    brightBlue: '#a8c3ff',
  }),
  terminal: { foreground: '#9095a3', cursor: '#b1b6c3' },
};

const TIDE_TEXT: Text = {
  strong: '#eef8f7',
  primary: '#e0eeec',
  body: '#d2e6e6',
  secondary: '#aec7c5',
  muted: '#8ca6a4',
  subtle: '#6a8583',
  faint: '#546c6a',
  ghost: '#415654',
};

const tide: ThemeDefinition = {
  id: 'tide',
  family: 'Tide',
  name: 'Tide',
  note: 'teal accent',
  scheme: 'dark',
  base: '#071012',
  surfaces: {
    sidebar: ['#081012', 70],
    pane: ['#0a1416', 80],
    paneMuted: ['#0a1416', 68],
    terminal: ['#060d0e', 76],
  },
  raised: '#122022',
  overlay: '#0f1b1d',
  scrim: 'rgb(3 8 9 / 62%)',
  browserWell: 'rgb(0 0 0 / 25%)',
  badgeRing: '#0c1719',
  tint: '#c8f0f0',
  fills: [3.5, 6, 9],
  borders: [5, 8, 12],
  text: TIDE_TEXT,
  accent: '#6cc4c0',
  accentSecondary: '#6fb8e0',
  status: { success: '#86c99a', warning: '#e4ab62', danger: '#e6827b', soft: [11, 12, 10] },
  diff: { addText: '#b3dcc1', delText: '#e9b0aa', addGutter: '#5b806a', delGutter: '#8e5d59' },
  provider: { claude: '#d48f74', codex: '#c3d2d2', violet: '#a9a2f0', codexStops },
  glow: [
    'radial-gradient(ellipse 80% 70% at 10% 100% in oklab, oklab(58.9% -0.081 -0.038 / 60%) 0%, transparent 70%)',
    'radial-gradient(ellipse 50% 45% at 90% 0% in oklab, oklab(48% -0.06 -0.05 / 30%) 0%, transparent 70%)',
  ].join(', '),
  syntax: {
    keyword: '#74cfc9',
    string: '#b5d99c',
    number: '#e6ba8a',
    function: '#bfe8e3',
    type: '#8fc3ef',
    property: '#cbdedd',
    variable: '#d2e6e6',
    definition: '#e0eeec',
    operator: '#8fb3b1',
    punctuation: '#718c8b',
    comment: '#62807e',
    tag: '#74cfc9',
    attribute: '#c0aaf0',
    meta: '#c0aaf0',
    heading: '#eef8f7',
    link: '#74cfc9',
    code: '#e6ba8a',
    quote: '#8ca6a4',
    marker: '#6cc4c0',
  },
  ansi: darkAnsi(TIDE_TEXT, {
    red: '#e6827b',
    green: '#86c99a',
    yellow: '#e4ab62',
    blue: '#6fa6e8',
    magenta: '#a9a2f0',
    cyan: '#6cc4c0',
    brightRed: '#e9b0aa',
    brightGreen: '#b3dcc1',
    brightBlue: '#a6c9f2',
  }),
  terminal: { foreground: '#8ca6a4', cursor: '#aec7c5' },
};

const GRAPHITE_TEXT: Text = {
  strong: '#f2f2f3',
  primary: '#e4e4e6',
  body: '#d4d4d7',
  secondary: '#b3b3b8',
  muted: '#939398',
  subtle: '#77777c',
  faint: '#5a5a5f',
  ghost: '#46464b',
};

const graphite: ThemeDefinition = {
  id: 'graphite',
  family: 'Graphite',
  name: 'Graphite',
  note: 'opaque · no wallpaper',
  scheme: 'dark',
  base: '#0b0b0c',
  surfaces: {
    sidebar: ['#111112', 100],
    pane: ['#141415', 100],
    paneMuted: ['#131314', 100],
    terminal: ['#101011', 100],
  },
  raised: '#1b1b1d',
  overlay: '#19191b',
  scrim: 'rgb(0 0 0 / 60%)',
  browserWell: 'rgb(0 0 0 / 30%)',
  badgeRing: '#111112',
  tint: '#ffffff',
  fills: [3, 5, 8],
  borders: [5, 8, 11],
  text: GRAPHITE_TEXT,
  accent: '#e8e8ea',
  accentSecondary: '#9cb4ff',
  status: { success: '#86c29c', warning: '#e0a862', danger: '#e2837d', soft: [11, 12, 10] },
  diff: { addText: '#b4d8c0', delText: '#e6b0ab', addGutter: '#5d7d69', delGutter: '#8b5f5b' },
  provider: { claude: '#d48f74', codex: '#c8c8cd', violet: '#aea6f0', codexStops },
  glow: 'none',
  syntax: {
    keyword: '#9cb4ff',
    string: '#a8cf9f',
    number: '#dcb07c',
    function: '#e6e6e8',
    type: '#8ec9d8',
    property: '#c4c4c8',
    variable: '#d4d4d7',
    definition: '#e4e4e6',
    operator: '#9d9da3',
    punctuation: '#808086',
    comment: '#76767c',
    tag: '#9cb4ff',
    attribute: '#bba6ea',
    meta: '#bba6ea',
    heading: '#f2f2f3',
    link: '#9cb4ff',
    code: '#dcb07c',
    quote: '#939398',
    marker: '#b3b3b8',
  },
  ansi: darkAnsi(GRAPHITE_TEXT, {
    red: '#e2837d',
    green: '#86c29c',
    yellow: '#e0a862',
    blue: '#8aa6f0',
    magenta: '#aea6f0',
    cyan: '#7cc0d8',
    brightRed: '#e6b0ab',
    brightGreen: '#b4d8c0',
    brightBlue: '#b7c8f6',
  }),
  terminal: { foreground: '#939398', cursor: '#b3b3b8' },
};

const OLED_TEXT: Text = {
  strong: '#ffffff',
  primary: '#eef0f5',
  body: '#e0e3ea',
  secondary: '#c0c4cf',
  muted: '#a2a7b3',
  subtle: '#7e8391',
  faint: '#646876',
  ghost: '#4c505c',
};

const oled: ThemeDefinition = {
  id: 'oled',
  family: 'OLED',
  name: 'OLED',
  note: 'true black · high contrast',
  scheme: 'dark',
  base: '#000000',
  surfaces: {
    sidebar: ['#000000', 100],
    pane: ['#000000', 100],
    paneMuted: ['#000000', 100],
    terminal: ['#000000', 100],
  },
  raised: '#101114',
  overlay: '#0c0d10',
  scrim: 'rgb(0 0 0 / 72%)',
  browserWell: 'rgb(255 255 255 / 3%)',
  badgeRing: '#000000',
  tint: '#c8d6ff',
  fills: [5, 8, 12],
  borders: [9, 13, 18],
  text: OLED_TEXT,
  accent: '#7ea6ff',
  accentSecondary: '#6cc0ff',
  status: { success: '#86d3a5', warning: '#f0b36a', danger: '#f08a84', soft: [13, 14, 12] },
  diff: { addText: '#bde6cb', delText: '#f2b9b4', addGutter: '#63907a', delGutter: '#a06660' },
  provider: { claude: '#e09a7e', codex: '#d0d5e0', violet: '#b4a8ff', codexStops },
  glow: 'none',
  syntax: {
    keyword: '#9ab8ff',
    string: '#a8e0bb',
    number: '#f2c18d',
    function: '#d0ddff',
    type: '#86d4ef',
    property: '#dde2ec',
    variable: '#e0e3ea',
    definition: '#ffffff',
    operator: '#a9b3cc',
    punctuation: '#8a90a0',
    comment: '#737a90',
    tag: '#9ab8ff',
    attribute: '#c3b6ff',
    meta: '#c3b6ff',
    heading: '#ffffff',
    link: '#9ab8ff',
    code: '#f2c18d',
    quote: '#a2a7b3',
    marker: '#7ea6ff',
  },
  ansi: darkAnsi(OLED_TEXT, {
    red: '#f08a84',
    green: '#86d3a5',
    yellow: '#f0b36a',
    blue: '#7ea6ff',
    magenta: '#b4a8ff',
    cyan: '#6cc0ff',
    brightRed: '#f2b9b4',
    brightGreen: '#bde6cb',
    brightBlue: '#b3caff',
  }),
  terminal: { foreground: '#b0b5c1', cursor: '#e0e3ea' },
};

const FROST_TEXT: Text = {
  strong: '#0e1320',
  primary: '#1a2030',
  body: '#272e3e',
  secondary: '#434b5d',
  muted: '#5d6577',
  subtle: '#737b8c',
  faint: '#9197a5',
  ghost: '#b3b8c3',
};

/** Light ANSI: dark text steps for black/white so every colour reads on a pale pane. */
function lightAnsi(
  text: Text,
  colours: {
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
  },
): Record<AnsiRole, string> {
  return {
    black: text.strong,
    red: colours.red,
    green: colours.green,
    yellow: colours.yellow,
    blue: colours.blue,
    magenta: colours.magenta,
    cyan: colours.cyan,
    white: text.faint,
    'bright-black': text.subtle,
    'bright-red': mix(colours.red, text.strong, 0.25),
    'bright-green': mix(colours.green, text.strong, 0.25),
    'bright-yellow': mix(colours.yellow, text.strong, 0.25),
    'bright-blue': mix(colours.blue, text.strong, 0.25),
    'bright-magenta': mix(colours.magenta, text.strong, 0.25),
    'bright-cyan': mix(colours.cyan, text.strong, 0.25),
    'bright-white': text.muted,
  };
}

const frost: ThemeDefinition = {
  id: 'frost',
  family: 'Nightglass',
  name: 'Frost',
  note: 'cool light',
  scheme: 'light',
  base: '#e6ebf4',
  surfaces: {
    sidebar: ['#f2f5fa', 70],
    pane: ['#fbfcfe', 84],
    paneMuted: ['#f6f8fc', 76],
    terminal: ['#f4f6fa', 88],
  },
  raised: '#ffffff',
  overlay: '#ffffff',
  scrim: 'rgb(20 28 48 / 26%)',
  browserWell: 'rgb(20 34 70 / 5%)',
  badgeRing: '#ffffff',
  tint: '#1e3264',
  fills: [4, 6.5, 10],
  borders: [7, 11, 16],
  text: FROST_TEXT,
  accent: '#2f64e0',
  accentSecondary: '#1f8ad6',
  status: { success: '#1d8049', warning: '#9f5d0a', danger: '#c23e36', soft: [10, 12, 10] },
  diff: { addText: '#1c6b3d', delText: '#a8342c', addGutter: '#86b89a', delGutter: '#d49a94' },
  provider: { claude: '#bd6444', codex: '#4d5566', violet: '#6b55d6', codexStops },
  glow: [
    'radial-gradient(ellipse 60% 55% at 85% 0% in oklab, oklab(75% -0.02 -0.12 / 32%) 0%, transparent 70%)',
    'radial-gradient(ellipse 55% 50% at 20% 105% in oklab, oklab(82% -0.03 -0.07 / 30%) 0%, transparent 70%)',
  ].join(', '),
  syntax: {
    keyword: '#2f55c8',
    string: '#1d7446',
    number: '#a8570c',
    function: '#3a3fae',
    type: '#0c718f',
    property: '#394154',
    variable: '#1f2533',
    definition: '#0e1320',
    operator: '#56617a',
    punctuation: '#6a7184',
    comment: '#747c8e',
    tag: '#2f55c8',
    attribute: '#7342ba',
    meta: '#7342ba',
    heading: '#0e1320',
    link: '#2f55c8',
    code: '#a8570c',
    quote: '#5d6577',
    marker: '#2f64e0',
  },
  ansi: lightAnsi(FROST_TEXT, {
    red: '#c23e36',
    green: '#1d8049',
    yellow: '#9a6108',
    blue: '#2f64e0',
    magenta: '#7342ba',
    cyan: '#0c7c9c',
  }),
  terminal: { foreground: '#343b4b', cursor: '#1a2030' },
};

const LINEN_TEXT: Text = {
  strong: '#1d1a16',
  primary: '#2a2621',
  body: '#36312b',
  secondary: '#504941',
  muted: '#6a6258',
  subtle: '#7f776c',
  faint: '#a0978b',
  ghost: '#c0b8ac',
};

const linen: ThemeDefinition = {
  id: 'linen',
  family: 'Linen',
  name: 'Linen',
  note: 'warm light · for reading',
  scheme: 'light',
  base: '#ebe6dd',
  surfaces: {
    sidebar: ['#f3efe8', 74],
    pane: ['#fbf9f5', 88],
    paneMuted: ['#f7f4ee', 80],
    terminal: ['#f5f1ea', 90],
  },
  raised: '#fffdf9',
  overlay: '#fffdf9',
  scrim: 'rgb(40 30 18 / 24%)',
  browserWell: 'rgb(60 40 10 / 5%)',
  badgeRing: '#fffdf9',
  tint: '#46321a',
  fills: [4.5, 7, 10],
  borders: [8, 12, 17],
  text: LINEN_TEXT,
  accent: '#34579f',
  accentSecondary: '#2f7480',
  status: { success: '#3d7a3a', warning: '#a15f14', danger: '#b5412f', soft: [11, 12, 10] },
  diff: { addText: '#335f2e', delText: '#983526', addGutter: '#9dbb91', delGutter: '#d6a293' },
  provider: { claude: '#b35f3e', codex: '#5a5249', violet: '#6d4fa8', codexStops },
  glow: [
    'radial-gradient(ellipse 60% 55% at 12% 0% in oklab, oklab(88% 0.01 0.05 / 55%) 0%, transparent 70%)',
    'radial-gradient(ellipse 50% 45% at 95% 100% in oklab, oklab(80% 0.01 0.04 / 30%) 0%, transparent 70%)',
  ].join(', '),
  syntax: {
    keyword: '#33539c',
    string: '#4c7431',
    number: '#9c531b',
    function: '#5a3d8f',
    type: '#2b6c77',
    property: '#433d36',
    variable: '#2a2621',
    definition: '#1d1a16',
    operator: '#6a6258',
    punctuation: '#81786c',
    comment: '#877d71',
    tag: '#33539c',
    attribute: '#86499a',
    meta: '#86499a',
    heading: '#1d1a16',
    link: '#34579f',
    code: '#9c531b',
    quote: '#6a6258',
    marker: '#34579f',
  },
  ansi: lightAnsi(LINEN_TEXT, {
    red: '#b5412f',
    green: '#3d7a3a',
    yellow: '#94600f',
    blue: '#34579f',
    magenta: '#86499a',
    cyan: '#2b6c77',
  }),
  terminal: { foreground: '#3d372f', cursor: '#2a2621' },
};

/** JAM's own themes first, then editor-style themes. Frost is Nightglass's light version. */
export const JAM_THEMES: ThemeId[] = ['nightglass', 'tide', 'graphite', 'oled', 'frost', 'linen'];

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  nightglass,
  tide,
  graphite,
  oled,
  frost,
  linen,
  ...EDITOR_THEMES,
};

export interface AccentDefinition {
  id: Exclude<AccentId, 'theme' | 'custom'>;
  name: string;
  /** Main and secondary tones for dark and light schemes. */
  dark: [string, string];
  light: [string, string];
}

/** Restrained built-ins. Accent is interface emphasis, never status: success stays green. */
export const ACCENTS: AccentDefinition[] = [
  { id: 'blue', name: 'JAM Blue', dark: ['#6f9bff', '#5fb4ff'], light: ['#2f64e0', '#1f8ad6'] },
  { id: 'cobalt', name: 'Cobalt', dark: ['#6a82ff', '#8a9cff'], light: ['#3450d0', '#4d68dc'] },
  { id: 'cyan', name: 'Cyan', dark: ['#56c2e6', '#7ad3ef'], light: ['#0b7fa4', '#1491b7'] },
  { id: 'violet', name: 'Violet', dark: ['#a48bff', '#bfaeff'], light: ['#6a4dd6', '#8166e3'] },
  { id: 'emerald', name: 'Emerald', dark: ['#56cc9c', '#7ad9b2'], light: ['#12815a', '#1e976a'] },
  { id: 'amber', name: 'Amber', dark: ['#eeb357', '#f3c67d'], light: ['#9e6307', '#b37514'] },
  { id: 'rose', name: 'Rose', dark: ['#ef7f9f', '#f49db7'], light: ['#c03a64', '#d2557e'] },
];

/** The accent roles for one accent colour, derived for the scheme it sits on. */
export function accentRoles(accent: string, secondary: string, scheme: Scheme, ground?: string) {
  const dark = scheme === 'dark';
  const onDark = luminance(accent) > 0.3;
  const strong = dark ? mix(accent, '#ffffff', 0.4) : mix(accent, '#000000', 0.22);
  return {
    '--color-accent': accent,
    // Links and selected text use accent-strong, so it always reads as text.
    '--color-accent-strong': ground ? ensureContrast(strong, ground, 4.5) : strong,
    '--color-accent-soft': alpha(accent, dark ? 12 : 10),
    '--color-accent-border': alpha(accent, dark ? 28 : 30),
    '--color-accent-glow': alpha(accent, dark ? 55 : 40),
    '--color-accent-secondary': secondary,
    '--color-on-accent': onDark ? mix(accent, '#000000', 0.9) : '#ffffff',
  };
}

export function resolveAccent(
  theme: ThemeDefinition,
  accent: AccentId,
  customAccent: string,
): Record<string, string> {
  const ground = theme.surfaces.pane[0];
  if (accent === 'theme') {
    const derived = accentRoles(theme.accent, theme.accentSecondary, theme.scheme, ground);
    const fixed = theme.accentRoles ?? {};
    return {
      ...derived,
      ...(fixed.strong ? { '--color-accent-strong': fixed.strong } : {}),
      ...(fixed.soft ? { '--color-accent-soft': fixed.soft } : {}),
      ...(fixed.border ? { '--color-accent-border': fixed.border } : {}),
      ...(fixed.glow ? { '--color-accent-glow': fixed.glow } : {}),
      ...(fixed.on ? { '--color-on-accent': fixed.on } : {}),
    };
  }
  if (accent === 'custom') {
    const main = legible(customAccent, theme);
    const secondary =
      theme.scheme === 'dark' ? mix(main, '#ffffff', 0.2) : mix(main, '#000000', 0.12);
    return accentRoles(main, secondary, theme.scheme, ground);
  }
  const preset = ACCENTS.find((item) => item.id === accent) ?? ACCENTS[0]!;
  const [main, secondary] = preset[theme.scheme];
  return accentRoles(main, secondary, theme.scheme, ground);
}

/**
 * A custom accent is used for links, focus rings and selected text, so it must
 * stay readable on the theme's panes. A colour that is too close to the
 * background is moved towards white (dark themes) or black (light themes)
 * until it reaches 3:1, the WCAG minimum for interface elements.
 */
export function legible(accent: string, theme: ThemeDefinition): string {
  const ground = theme.surfaces.pane[0];
  const target = theme.scheme === 'dark' ? '#ffffff' : '#000000';
  let colour = accent;
  for (let step = 1; step <= 20 && contrast(colour, ground) < 3; step++) {
    colour = mix(accent, target, step * 0.05);
  }
  return colour;
}
