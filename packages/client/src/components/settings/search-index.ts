import type { SettingsPageId } from './types';
import { BINDING_GROUPS } from './keybindings-data';

/**
 * What Settings search can find: each page's rows by the title they show,
 * with a few other words people use for them. A test keeps the titles in
 * step with the pages.
 */
export interface SettingsEntry {
  page: SettingsPageId;
  /** The row's title, exactly as the page shows it. */
  title: string;
  section?: string;
  keywords?: string;
}

const ROWS: SettingsEntry[] = [
  {
    page: 'General',
    section: 'New chats',
    title: 'Default agent',
    keywords: 'provider claude codex',
  },
  { page: 'General', section: 'New chats', title: 'Stream replies', keywords: 'streaming typing' },
  { page: 'General', section: 'New chats', title: 'Effort', keywords: 'reasoning thinking' },
  {
    page: 'General',
    section: 'New chats',
    title: 'Default permissions',
    keywords: 'approval access auto-accept',
  },
  { page: 'General', section: 'Messages', title: 'Time format', keywords: 'clock 12-hour 24-hour' },
  {
    page: 'General',
    section: 'Where new threads work',
    title: 'Worktree location',
    keywords: 'git folder',
  },
  { page: 'General', section: 'Where new threads work', title: 'Branch prefix', keywords: 'git' },
  {
    page: 'General',
    section: 'Threads',
    title: 'Suggest archiving idle threads',
    keywords: 'archive close old',
  },
  { page: 'General', section: 'Threads', title: 'Sending reopens an archived thread' },
  {
    page: 'General',
    section: 'Notifications',
    title: 'Play a sound',
    keywords: 'chime audio finished alert',
  },
  {
    page: 'General',
    section: 'Notifications',
    title: 'Sound',
    keywords: 'chime glass pop bell marimba blip',
  },
  {
    page: 'General',
    section: 'Notifications',
    title: 'Show a badge',
    keywords: 'taskbar dock tray dot icon',
  },
  {
    page: 'General',
    section: 'Notifications',
    title: 'Show notifications',
    keywords: 'toast alert',
  },
  {
    page: 'Appearance',
    section: 'Background & surfaces',
    title: 'Background',
    keywords: 'wallpaper theme',
  },
  { page: 'Appearance', section: 'Background & surfaces', title: 'Gradient' },
  {
    page: 'Appearance',
    section: 'Background & surfaces',
    title: 'Image',
    keywords: 'wallpaper photo',
  },
  {
    page: 'Appearance',
    section: 'Background & surfaces',
    title: 'Match colors to image',
    keywords: 'color',
  },
  { page: 'Appearance', section: 'Background & surfaces', title: 'Brightness' },
  { page: 'Appearance', section: 'Background & surfaces', title: 'Saturation' },
  {
    page: 'Appearance',
    section: 'Background & surfaces',
    title: 'Blur',
    keywords: 'transparency glass',
  },
  {
    page: 'Appearance',
    section: 'Background & surfaces',
    title: 'Surfaces',
    keywords: 'opacity panes',
  },
  {
    page: 'Appearance',
    section: 'Background & surfaces',
    title: 'Effects',
    keywords: 'pattern fade vignette',
  },
  {
    page: 'Appearance',
    section: 'Interface',
    title: 'Accent',
    keywords: 'color color highlight theme',
  },
  {
    page: 'Appearance',
    section: 'Interface',
    title: 'Interface font',
    keywords: 'text size scale typeface',
  },
  {
    page: 'Appearance',
    section: 'Interface',
    title: 'Code font',
    keywords: 'monospace editor size',
  },
  { page: 'Appearance', section: 'Interface', title: 'Terminal font', keywords: 'monospace size' },
  { page: 'Projects', title: 'Name', keywords: 'project rename icon' },
  { page: 'Projects', title: 'Pinned in sidebar', keywords: 'project pin' },
  { page: 'Providers', title: 'Default for new chats', keywords: 'claude codex agent' },
  { page: 'Providers', title: 'Model', keywords: 'opus sonnet gpt' },
  { page: 'Providers', title: 'Effort and permissions' },
  { page: 'Providers', title: 'Executable', keywords: 'path install cli' },
  {
    page: 'Browser',
    section: 'Annotate',
    title: 'Picking an element adds',
    keywords: 'annotation',
  },
  {
    page: 'Browser',
    section: 'Annotate',
    title: 'Stage to',
    keywords: 'annotation composer context',
  },
  {
    page: 'Browser',
    section: 'Profile & developer',
    title: 'Web links open in',
    keywords: 'links',
  },
  {
    page: 'Browser',
    section: 'Profile & developer',
    title: 'Open localhost links beside the chat',
    keywords: 'split',
  },
  {
    page: 'Browser',
    section: 'Profile & developer',
    title: 'New tab opens',
    keywords: 'home page',
  },
  { page: 'Terminal', section: 'Shell', title: 'Shell', keywords: 'powershell bash zsh' },
  { page: 'Terminal', section: 'Display', title: 'Font' },
  { page: 'Terminal', section: 'Display', title: 'Option as Meta', keywords: 'alt key' },
  { page: 'Terminal', section: 'Display', title: 'Copy on select', keywords: 'clipboard' },
  {
    page: 'Terminal',
    section: 'Display',
    title: 'Confirm multi-line paste',
    keywords: 'clipboard',
  },
  {
    page: 'Snapshots',
    section: 'Capture',
    title: 'Shortcut',
    keywords: 'screenshot capture hotkey',
  },
  {
    page: 'Snapshots',
    section: 'After capture',
    title: 'Also copy to clipboard',
    keywords: 'screenshot',
  },
  {
    page: 'Snapshots',
    section: 'After capture',
    title: 'Also bring JAM to the front',
    keywords: 'screenshot',
  },
  {
    page: 'Snapshots',
    section: 'Feedback',
    title: 'Flash the captured window',
    keywords: 'screenshot',
  },
  { page: 'Snapshots', section: 'Feedback', title: 'Show a toast', keywords: 'screenshot' },
  { page: 'Snapshots', section: 'Feedback', title: 'Play a sound', keywords: 'screenshot' },
  {
    page: 'Snapshots',
    section: 'Storage',
    title: 'Keep snapshots',
    keywords: 'screenshot retention',
  },
  { page: 'Skills', title: 'Skill', keywords: 'SKILL.md add' },
  {
    page: 'Storage',
    section: 'Location and search',
    title: 'Search index',
    keywords: 'fts database',
  },
  { page: 'Storage', section: 'Retention', title: 'Keep logs' },
  { page: 'Storage', section: 'Export and reset', title: 'Export data', keywords: 'backup json' },
  { page: 'Storage', section: 'Export and reset', title: 'Delete demo data', keywords: 'sample' },
  {
    page: 'Advanced',
    section: 'Diagnostics',
    title: 'Copy diagnostics',
    keywords: 'bug report version',
  },
  { page: 'Advanced', section: 'Developer', title: 'Event inspector', keywords: 'debug' },
  { page: 'Advanced', section: 'Developer', title: 'Show IDs in tooltips', keywords: 'debug' },
  { page: 'About', section: 'Version', title: 'Version', keywords: 'update license' },
];

/** Every shortcut is findable by its command, on Keybindings. */
const SHORTCUTS: SettingsEntry[] = BINDING_GROUPS.flatMap((group) =>
  group.bindings.map((binding) => ({
    page: 'Keybindings' as const,
    section: group.title,
    title: binding.command,
    keywords: 'shortcut keybinding hotkey',
  })),
);

export const SETTINGS_INDEX: readonly SettingsEntry[] = [...ROWS, ...SHORTCUTS];

/** Entries whose words all appear in the title, page, section or keywords; best titles first. */
export function searchSettings(query: string, index = SETTINGS_INDEX, limit = 12) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return [];
  return index
    .flatMap((entry) => {
      const title = entry.title.toLowerCase();
      const text = [title, entry.page, entry.section, entry.keywords].join(' ').toLowerCase();
      if (!words.every((word) => text.includes(word))) return [];
      const rank = title.startsWith(first) ? 0 : title.includes(first) ? 1 : 2;
      return [{ entry, rank }];
    })
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
