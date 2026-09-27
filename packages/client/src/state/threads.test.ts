import { describe, expect, it } from 'vitest';
import type { Project, Resource, Session } from '@jam/protocol';
import { compactAge, orderProjects, suggestsClosing, threadsOf } from './threads';

const now = Date.parse('2026-09-26T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const thread = (id: string, extra: Partial<Resource> = {}): Resource => ({
  id,
  kind: 'conversation',
  title: id,
  projectId: 'project-jam',
  pinned: false,
  updatedAt: daysAgo(1),
  ...extra,
});
const session = (status: Session['status']): Session => ({
  id: 's',
  resourceId: 'r',
  providerId: 'mock',
  presentation: 'claude',
  status,
  model: 'Demo model',
});

describe('project threads', () => {
  it('splits a project’s conversations into open and closed, newest first', () => {
    const { open, closed } = threadsOf(
      [
        thread('old', { updatedAt: daysAgo(5) }),
        thread('new', { updatedAt: daysAgo(0.1) }),
        thread('closed-early', { closedAt: daysAgo(4) }),
        thread('closed-late', { closedAt: daysAgo(1) }),
        thread('elsewhere', { projectId: 'project-atlas' }),
        { ...thread('terminal'), kind: 'terminal' },
      ],
      'project-jam',
    );
    expect(open.map((item) => item.id)).toEqual(['new', 'old']);
    expect(closed.map((item) => item.id)).toEqual(['closed-late', 'closed-early']);
  });

  it('only suggests closing an idle, open, quiet thread — and Keep open snoozes it', () => {
    const idle = thread('idle', { updatedAt: daysAgo(12) });
    expect(suggestsClosing(idle, undefined, now, 7)).toBe(true);
    expect(suggestsClosing(idle, undefined, now, null)).toBe(false);
    expect(suggestsClosing(idle, session('running'), now, 7)).toBe(false);
    expect(suggestsClosing({ ...idle, closedAt: daysAgo(1) }, undefined, now, 7)).toBe(false);
    expect(suggestsClosing(thread('fresh', { updatedAt: daysAgo(2) }), undefined, now, 7)).toBe(
      false,
    );
    const kept = { ...idle, closeSuggestionDismissedAt: daysAgo(3) };
    expect(suggestsClosing(kept, undefined, now, 7)).toBe(false);
    expect(suggestsClosing(kept, undefined, now + 5 * 86_400_000, 7)).toBe(true);
  });

  it('puts pinned projects first without reordering the rest', () => {
    const project = (id: string, pinned?: boolean): Project => ({
      id,
      name: id,
      initials: 'XX',
      branch: 'main',
      ...(pinned ? { pinned } : {}),
    });
    expect(
      orderProjects([project('a'), project('b', true), project('c'), project('d', true)]).map(
        (item) => item.id,
      ),
    ).toEqual(['b', 'd', 'a', 'c']);
  });

  it('formats compact ages', () => {
    expect(compactAge(new Date(now - 30_000).toISOString(), now)).toBe('1m');
    expect(compactAge(daysAgo(2 / 24), now)).toBe('2h');
    expect(compactAge(daysAgo(12), now)).toBe('12d');
    expect(compactAge(daysAgo(21), now)).toBe('3w');
    expect(compactAge(daysAgo(90), now)).toBe('3mo');
  });
});
