import type { DesktopServices } from '../../desktop';

/**
 * The shortcuts JAM handles today, as data. Each entry names the handler that
 * implements it (`source`), and a test reads that file for `evidence`, so the
 * list cannot quietly describe a shortcut the app does not have. Rebinding is
 * not implemented; this table is read-only.
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
  keys: {
    mac: KeyToken[];
    other: KeyToken[];
  };
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

export const BINDING_GROUPS: BindingGroup[] = [
  {
    title: 'Workspace',
    bindings: [
      {
        id: 'search',
        command: 'Search everything',
        context: 'Everywhere',
        keys: same(['mod', 'K']),
        source: 'JamApp.tsx',
        evidence: "key === 'k'",
      },
      {
        id: 'new-chat',
        command: 'New chat with the default agent',
        context: 'Everywhere',
        keys: same(['mod', 'N']),
        source: 'JamApp.tsx',
        evidence: "newChat(event.shiftKey ? 'codex' : undefined)",
      },
      {
        id: 'new-chat-codex',
        command: 'New chat with Codex',
        context: 'Everywhere',
        keys: same(['mod', 'shift', 'N']),
        source: 'JamApp.tsx',
        evidence: "newChat(event.shiftKey ? 'codex' : undefined)",
      },
      {
        id: 'new-tab',
        command: 'New tab',
        sub: 'Choose a chat, file, terminal or browser.',
        context: 'Everywhere',
        keys: same(['mod', 'T']),
        source: 'JamApp.tsx',
        evidence: "key === 't'",
      },
      {
        id: 'settings',
        command: 'Settings',
        context: 'Everywhere',
        keys: same(['mod', ',']),
        source: 'JamApp.tsx',
        evidence: "event.key === ','",
      },
      {
        id: 'focus',
        command: 'Toggle focus mode',
        context: 'Everywhere',
        keys: same(['mod', '.']),
        source: 'JamApp.tsx',
        evidence: "event.key === '.'",
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
        source: 'JamApp.tsx',
        evidence: "key === 'w'",
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
        keys: same(['mod', 'enter']),
        source: 'components/ConversationPane.tsx',
        evidence: "event.key === 'Enter'",
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

/** Whether shortcuts use ⌘, following the OS like JamApp does, not the host. */
export function usesCommand(
  platform: DesktopServices['platform'],
  navigatorPlatform = typeof navigator === 'undefined' ? '' : navigator.platform,
) {
  return platform === 'macos' || (platform === 'web' && /Mac|iPhone|iPad/.test(navigatorPlatform));
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
  arrows: '← →',
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
  arrows: '← →',
};

/** The keycap labels for a binding on this platform. */
export function keyLabels(binding: Binding, mac: boolean): string[] {
  const labels = mac ? MAC_LABELS : OTHER_LABELS;
  return (mac ? binding.keys.mac : binding.keys.other).map((key) => labels[key] ?? key);
}

/**
 * Groups whose bindings match a plain-text query on command, sub, context or
 * the keycaps as shown ("⌘K", "ctrl k"). Empty groups are dropped.
 */
export function filterBindings(groups: BindingGroup[], query: string, mac: boolean) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((group) => ({
      ...group,
      bindings: group.bindings.filter((binding) => {
        const keys = keyLabels(binding, mac);
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
