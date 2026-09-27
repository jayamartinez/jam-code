/**
 * What a Terminal tab does today, shown read-only on the Terminal page until
 * these become settings. `tests/settings-terminal-facts.test.ts` checks them against
 * TerminalView so the page cannot drift from the real terminal; importing
 * TerminalView here would pull xterm into the Settings chunk.
 */
export const TERMINAL_FACTS = {
  scrollback: 5000,
  scrollbackLabel: '5,000 lines',
  optionAsMeta: false,
  cursorBlink: false,
} as const;

export type SkillAgent = 'claude' | 'codex';
export type SkillScope = 'project' | 'everywhere';

/** The file each agent reads in every project. Paths are the agents' own conventions. */
export const GLOBAL_INSTRUCTIONS: { agent: SkillAgent; name: string; path: string }[] = [
  { agent: 'claude', name: 'Claude Code', path: '~/.claude/CLAUDE.md' },
  { agent: 'codex', name: 'Codex', path: '~/.codex/AGENTS.md' },
];

/** Adds or removes an agent; at least one agent always stays chosen. */
export function toggleAgent(selected: readonly SkillAgent[], agent: SkillAgent): SkillAgent[] {
  if (!selected.includes(agent)) return [...selected, agent];
  return selected.length > 1 ? selected.filter((item) => item !== agent) : [...selected];
}

export const SNAPSHOT_SOUNDS = [
  { value: 'shutter', label: 'Shutter' },
  { value: 'tick', label: 'Tick' },
  { value: 'pop', label: 'Pop' },
  { value: 'chime', label: 'Soft chime' },
] as const;
