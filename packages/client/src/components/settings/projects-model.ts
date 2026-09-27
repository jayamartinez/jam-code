import type { Project, ProjectIcon } from '@jam/protocol';

/**
 * The Projects page edits a project in place: each choice is sent as its own
 * `project.update`. These helpers turn the picker's working state into a
 * valid icon and decide whether anything actually changed, so a click that
 * changes nothing never becomes a request.
 */

export type IconKind = ProjectIcon['kind'];

export interface IconDraft {
  kind: IconKind;
  tone: string;
  preset: string;
  emoji: string;
  image?: string;
}

const DEFAULT_TONE = 'blue';
const DEFAULT_PRESET = 'rocket';

export function iconDraft(icon?: ProjectIcon): IconDraft {
  return {
    kind: icon?.kind ?? 'initials',
    tone: icon?.tone ?? DEFAULT_TONE,
    preset: icon?.kind === 'preset' && icon.value ? icon.value : DEFAULT_PRESET,
    emoji: icon?.kind === 'emoji' && icon.value ? icon.value : '',
    ...(icon?.kind === 'image' && icon.value ? { image: icon.value } : {}),
  };
}

/**
 * The icon a draft describes, or null while it is incomplete (an emoji or an
 * image not chosen yet). Initials in the default tone carry no tone, matching
 * what the runtime stores for a project that was never customised.
 */
export function buildIcon(draft: IconDraft): ProjectIcon | null {
  switch (draft.kind) {
    case 'preset':
      return { kind: 'preset', value: draft.preset, tone: draft.tone };
    case 'emoji': {
      const value = draft.emoji.trim();
      return value ? { kind: 'emoji', value, tone: draft.tone } : null;
    }
    case 'image':
      return draft.image ? { kind: 'image', value: draft.image } : null;
    default:
      return draft.tone === DEFAULT_TONE
        ? { kind: 'initials' }
        : { kind: 'initials', tone: draft.tone };
  }
}

/** Absent icons are default initials; tone only matters where it is drawn. */
export function sameIcon(a?: ProjectIcon, b?: ProjectIcon): boolean {
  const left = a ?? { kind: 'initials' };
  const right = b ?? { kind: 'initials' };
  if (left.kind !== right.kind) return false;
  if ((left.value ?? '') !== (right.value ?? '')) return false;
  if (left.kind === 'image') return true;
  return (left.tone ?? DEFAULT_TONE) === (right.tone ?? DEFAULT_TONE);
}

/** Trimmed, without blanks or repeats, in the order the user gave them. */
export function normalizePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of paths) {
    const path = raw.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

export function samePaths(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((path, index) => path === b[index]);
}

/** "2 folders · main" under a project's name. */
export function projectSummary(project: Project): string {
  const count = project.paths?.length ?? 0;
  const folders = count === 0 ? 'No folders' : count === 1 ? '1 folder' : `${count} folders`;
  return project.branch ? `${folders} · ${project.branch}` : folders;
}

/** The project to show first: the pinned one, else the first listed. */
export function initialProjectId(projects: Project[]): string | undefined {
  return (projects.find((project) => project.pinned) ?? projects[0])?.id;
}
