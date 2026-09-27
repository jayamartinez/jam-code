import { describe, expect, it } from 'vitest';
import type { Project } from '@jam/protocol';
import {
  buildIcon,
  iconDraft,
  initialProjectId,
  normalizePaths,
  projectSummary,
  sameIcon,
  samePaths,
} from './projects-model';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'jam-code',
  initials: 'JC',
  branch: 'main',
  ...overrides,
});

describe('project icon drafts', () => {
  it('round-trips every stored icon kind', () => {
    for (const icon of [
      { kind: 'initials' as const },
      { kind: 'initials' as const, tone: 'green' },
      { kind: 'preset' as const, value: 'bug', tone: 'amber' },
      { kind: 'emoji' as const, value: '🦀', tone: 'clay' },
      { kind: 'image' as const, value: 'data:image/png;base64,AAAA' },
    ])
      expect(buildIcon(iconDraft(icon))).toEqual(icon);
  });

  it('treats a missing icon as default initials without a tone', () => {
    expect(buildIcon(iconDraft(undefined))).toEqual({ kind: 'initials' });
  });

  it('is incomplete until an emoji or image is chosen', () => {
    expect(buildIcon({ ...iconDraft(), kind: 'emoji', emoji: '  ' })).toBeNull();
    expect(buildIcon({ ...iconDraft(), kind: 'image' })).toBeNull();
  });

  it('keeps the chosen glyph when switching kinds and back', () => {
    const draft = iconDraft({ kind: 'preset', value: 'bug', tone: 'red' });
    const asInitials = buildIcon({ ...draft, kind: 'initials' });
    expect(asInitials).toEqual({ kind: 'initials', tone: 'red' });
    expect(buildIcon({ ...draft, kind: 'preset' })).toEqual({
      kind: 'preset',
      value: 'bug',
      tone: 'red',
    });
  });
});

describe('sameIcon', () => {
  it('matches default initials however they are written', () => {
    expect(sameIcon(undefined, { kind: 'initials' })).toBe(true);
    expect(sameIcon({ kind: 'initials', tone: 'blue' }, undefined)).toBe(true);
    expect(sameIcon({ kind: 'initials', tone: 'green' }, undefined)).toBe(false);
  });

  it('ignores tone for images and compares values otherwise', () => {
    expect(
      sameIcon({ kind: 'image', value: 'a' }, { kind: 'image', value: 'a', tone: 'red' }),
    ).toBe(true);
    expect(
      sameIcon({ kind: 'preset', value: 'bug', tone: 'red' }, { kind: 'preset', value: 'key' }),
    ).toBe(false);
  });
});

describe('folder paths', () => {
  it('trims, drops blanks and repeats, and keeps order', () => {
    expect(normalizePaths([' /a ', '', '/b', '/a', '  '])).toEqual(['/a', '/b']);
  });

  it('compares in order', () => {
    expect(samePaths(['/a', '/b'], ['/a', '/b'])).toBe(true);
    expect(samePaths(['/a', '/b'], ['/b', '/a'])).toBe(false);
    expect(samePaths(undefined, [])).toBe(true);
  });
});

describe('project summaries', () => {
  it('counts folders and names the branch', () => {
    expect(projectSummary(project())).toBe('No folders · main');
    expect(projectSummary(project({ paths: ['/a'] }))).toBe('1 folder · main');
    expect(projectSummary(project({ paths: ['/a', '/b'], branch: '' }))).toBe('2 folders');
  });

  it('opens the pinned project first', () => {
    expect(initialProjectId([project(), project({ id: 'p2', pinned: true })])).toBe('p2');
    expect(initialProjectId([project()])).toBe('p1');
    expect(initialProjectId([])).toBeUndefined();
  });
});
