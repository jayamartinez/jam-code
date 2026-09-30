import type { DesktopServices } from '../../desktop';

/**
 * The shortcuts JAM handles, as data. Each entry names the handler that
 * implements it (`source`), and a test reads that file for `evidence`, so the
 * list cannot quietly describe a shortcut the app does not have.
 *
 * `editable` shortcuts are JAM's own commands, dispatched from JamApp by
 * chord, and can be rebound in Settings → Keybindings. The rest belong to one
 * component (the composer, the editor, a terminal) and are shown as they are.
 */

/** `mod` is ⌘ on a Mac and Ctrl elsewhere, as JAM's own handlers decide. */
export type KeyToken =
  'mod' | 'shift' | 'alt' | 'ctrl' | 'enter' | 'escape' | 'left' | 'right' | 'arrows' | string;

export interface Binding {
  id: string;
  command: string;
  sub?: string;
  /** Where the shortcut works, shown as a chip. */
  context: string;
  /** The default keys; empty when a command starts without a shortcut. */
  keys: {
    mac: KeyToken[];
    other: KeyToken[];
  };
  /** Rebindable in Settings. */
  editable?: boolean;
  /** The file implementing it, relative to packages/client/src. */
  source: string;
  /** Text that must appear in `source`. */
  evidence: string;
}

export interface BindingGroup {
  title: string;
  bindings: Binding[];
}

const same = (keys: KeyToken[]) => ({ mac: keys, other: keys });
const command = (id: string) => ({
  editable: true,
  source: 'JamApp.tsx',
  evidence: `case '${id}':`,
});

export const BINDING_GROUPS: BindingGroup[] = [
  {
    title: 'Workspace',
    bindings: [
      {
        id: 'search',
        command: 'Search everything',
        context: 'Everywhere',
        keys: same(['mod', 'K']),
        ...command('search'),
      },
      {
        id: 'new-chat',
        command: 'New chat with the default agent',
        context: 'Everywhere',
        keys: same(['mod', 'N']),
        ...command('new-chat'),
      },
      {
        id: 'new-chat-codex',
        command: 'New chat with Codex',
        context: 'Everywhere',
        keys: same(['mod', 'shift', 'N']),
        ...command('new-chat-codex'),
      },
      {
        id: 'new-tab',
        command: 'New tab',
        sub: 'Choose a chat, file, terminal or browser.',
        context: 'Everywhere',
        keys: same(['mod', 'T']),
        ...command('new-tab'),
      },
      {
        id: 'open-terminal',
        command: 'Open terminal',
        sub: 'Where Settings → Terminal says, or focus the one this tab has.',
        context: 'Everywhere',
        // ⌘` switches windows on a Mac, so it is ⌃` there, as in most editors.
        keys: { mac: ['ctrl', '`'], other: ['mod', '`'] },
        ...command('open-terminal'),
      },
      {
        id: 'settings',
        command: 'Settings',
        context: 'Everywhere',
        keys: same(['mod', ',']),
        ...command('settings'),
      },
      {
        id: 'focus',
        command: 'Toggle focus mode',
        context: 'Everywhere',
        keys: same(['mod', '.']),
        ...command('focus'),
      },
      {
        id: 'escape',
        command: 'Leave focus mode or Settings',
        context: 'Everywhere',
        keys: same(['escape']),
        source: 'JamApp.tsx',
        evidence: "event.key === 'Escape'",
      },
    ],
  },
  {
    title: 'Tabs and panes',
    bindings: [
      {
        id: 'close-tab',
        command: 'Close tab',
        sub: 'Closes the view, not the session.',
        context: 'Workspace',
        keys: same(['mod', 'W']),
        ...command('close-tab'),
      },
      {
        id: 'reopen-tab',
        command: 'Reopen closed tab',
        context: 'Workspace',
        keys: same(['mod', 'shift', 'T']),
        ...command('reopen-tab'),
      },
      {
        id: 'split-right',
        command: 'Split right',
        context: 'Workspace',
        keys: same(['mod', '\\']),
        ...command('split-right'),
      },
      {
        id: 'split-down',
        command: 'Split down',
        context: 'Workspace',
        keys: same(['mod', 'shift', '\\']),
        ...command('split-down'),
      },
      {
        id: 'close-pane',
        command: 'Close pane',
        sub: 'Closes the view, not the session.',
        context: 'Workspace',
        keys: same([]),
        ...command('close-pane'),
      },
      {
        id: 'move-tab',
        command: 'Move tab left or right',
        context: 'Tab strip',
        keys: same(['alt', 'left', 'right']),
        source: 'components/WorkspaceTitlebar.tsx',
        evidence: "event.key === 'ArrowLeft' && event.altKey",
      },
      {
        id: 'resize-split',
        command: 'Resize a split',
        sub: 'With the divider focused.',
        context: 'Divider',
        keys: same(['arrows']),
        source: 'components/TileLayout.tsx',
        evidence: 'onResize(clamp(',
      },
    ],
  },
  {
    title: 'Conversation and files',
    bindings: [
      {
        id: 'send',
        command: 'Send',
        sub: 'Context stays staged until you send.',
        context: 'Composer',
        keys: same(['enter']),
        source: 'components/composer-model.ts',
        evidence: "event.key === 'Enter' && !event.shiftKey",
      },
      {
        id: 'new-line',
        command: 'New line',
        sub: 'Adds a line to the message instead of sending it.',
        context: 'Composer',
        keys: same(['shift', 'enter']),
        source: 'components/composer-model.ts',
        evidence: '!event.shiftKey',
      },
      {
        id: 'pick-model',
        command: 'Choose a numbered model',
        sub: 'Favorites first, then current models, as numbered in the model picker.',
        context: 'Composer',
        keys: same(['alt', '1–9']),
        source: 'components/ConversationPane.tsx',
        evidence: '/^Digit([1-9])$/',
      },
      {
        id: 'save-file',
        command: 'Save file',
        context: 'Editor',
        keys: same(['mod', 'S']),
        source: 'components/CodeMirrorEditor.tsx',
        evidence: "key: 'Mod-s'",
      },
    ],
  },
  {
    title: 'Terminal',
    bindings: [
      {
        id: 'terminal-find',
        command: 'Find in terminal',
        context: 'Terminal',
        keys: { mac: ['mod', 'F'], other: ['ctrl', 'shift', 'F'] },
        source: 'components/TerminalView.tsx',
        evidence: "primary && key === 'f'",
      },
      {
        id: 'terminal-find-next',
        command: 'Next or previous match',
        sub: 'Shift goes back.',
        context: 'Terminal find',
        keys: same(['enter']),
        source: 'components/TerminalView.tsx',
        evidence: 'find(event.shiftKey)',
      },
      {
        id: 'terminal-copy',
        command: 'Copy selection',
        sub: 'On a Mac, ⌘C. Elsewhere Ctrl+C copies only while text is selected.',
        context: 'Terminal',
        keys: { mac: ['mod', 'C'], other: ['ctrl', 'shift', 'C'] },
        source: 'components/TerminalView.tsx',
        evidence: "event.ctrlKey && event.shiftKey && key === 'c'",
      },
    ],
  },
];

export const ALL_BINDINGS = BINDING_GROUPS.flatMap((group) => group.bindings);

/** Whether shortcuts use ⌘, following the OS like JamApp does, not the host. */
export function usesCommand(
  platform: DesktopServices['platform'],
  navigatorPlatform = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  return platform === 'macos' || (platform === 'web' && /Mac|iPhone|iPad/.test(navigatorPlatform));
}

/*
 * Chords: a shortcut as one string, "mod+shift+k". Modifiers come first in a
 * fixed order, then one key named by its position on the keyboard (so Shift
 * does not turn "," into "<"), lower-case.
 */
const MODIFIERS = ['mod', 'ctrl', 'alt', 'shift'] as const;

export function chordOf(tokens: readonly KeyToken[]): string | null {
  if (!tokens.length) return null;
  const lower = tokens.map((token) => token.toLowerCase());
  const key = lower.filter((token) => !(MODIFIERS as readonly string[]).includes(token));
  if (key.length !== 1) return null;
  return [...MODIFIERS.filter((modifier) => lower.includes(modifier)), key[0]].join('+');
}

export const chordTokens = (chord: string): string[] => chord.split('+');

const CODE_KEYS: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  IntlBackslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
  Space: 'space',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
};

/** The chord a key press makes, or null for a modifier on its own. */
export function chordFromEvent(
  event: Pick<KeyboardEvent, 'code' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  mac: boolean,
): string | null {
  if (['Meta', 'Control', 'Alt', 'Shift', 'OS', 'AltGraph'].includes(event.key)) return null;
  const code = event.code;
  const key = /^Key[A-Z]$/.test(code)
    ? code.slice(3).toLowerCase()
    : /^(Digit|Numpad)[0-9]$/.test(code)
      ? code.slice(-1)
      : /^F([1-9]|1[0-9]|2[0-4])$/.test(code)
        ? code.toLowerCase()
        : (CODE_KEYS[code] ?? event.key.toLowerCase());
  const held = [
    (mac ? event.metaKey : event.ctrlKey) && 'mod',
    mac && event.ctrlKey && 'ctrl',
    event.altKey && 'alt',
    event.shiftKey && 'shift',
  ].filter((token): token is string => Boolean(token));
  return [...held, key].join('+');
}

/**
 * Why a chord cannot be a shortcut, or null when it can: it needs a modifier
 * other than Shift (or is a function key), and text editing keeps its own.
 */
export function chordProblem(chord: string): string | null {
  const tokens = chordTokens(chord);
  const key = tokens[tokens.length - 1] ?? '';
  const modified = tokens.some((token) => token === 'mod' || token === 'ctrl' || token === 'alt');
  if (!modified && !/^f\d+$/.test(key)) return 'Include Ctrl, Alt or ⌘ (or use a function key).';
  if (tokens.length === 2 && tokens[0] === 'mod' && ['a', 'c', 'v', 'x', 'y', 'z'].includes(key))
    return 'That one is kept for editing text.';
  return null;
}

const MAC_LABELS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
  enter: '↵',
  escape: 'Esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  arrows: '← →',
  space: 'Space',
  tab: 'Tab',
  backspace: '⌫',
  delete: '⌦',
};
const OTHER_LABELS: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
  enter: 'Enter',
  escape: 'Esc',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  arrows: '← →',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
};

/** The keycap labels for a list of keys on this platform. */
export function tokenLabels(tokens: readonly KeyToken[], mac: boolean): string[] {
  const labels = mac ? MAC_LABELS : OTHER_LABELS;
  return tokens.map((token) => {
    const lower = token.toLowerCase();
    if (labels[lower]) return labels[lower];
    return /^f\d+$/.test(lower)
      ? lower.toUpperCase()
      : token.length === 1
        ? token.toUpperCase()
        : token;
  });
}

/** The keycap labels for a binding's default keys on this platform. */
export function keyLabels(binding: Binding, mac: boolean): string[] {
  return tokenLabels(mac ? binding.keys.mac : binding.keys.other, mac);
}

/** A binding's default chord on this platform, or null when it has none. */
export const defaultChord = (binding: Binding, mac: boolean) =>
  chordOf(mac ? binding.keys.mac : binding.keys.other);

/**
 * Groups whose bindings match a plain-text query on command, sub, context or
 * the keycaps as shown ("⌘K", "ctrl k"). Empty groups are dropped. `labels`
 * gives a binding's current keycaps when they differ from its defaults.
 */
export function filterBindings(
  groups: BindingGroup[],
  query: string,
  mac: boolean,
  labels: (binding: Binding) => string[] = (binding) => keyLabels(binding, mac),
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((group) => ({
      ...group,
      bindings: group.bindings.filter((binding) => {
        const keys = labels(binding);
        const haystack = [
          binding.command,
          binding.sub ?? '',
          binding.context,
          group.title,
          keys.join(' '),
          keys.join(''),
        ]
          .join(' ')
          .toLowerCase();
        return words.every((word) => haystack.includes(word));
      }),
    }))
    .filter((group) => group.bindings.length > 0);
}
