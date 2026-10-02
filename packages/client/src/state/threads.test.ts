import { describe, expect, it } from 'vitest';
import type { Project, Resource, Session } from '@jam/protocol';
import {
  archiveBlocked,
  compactAge,
  currentChats,
  orderProjects,
  pinnedChats,
  recentChats,
  suggestsArchiving,
  threadsOf,
} from './threads';

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
const session = (status: Session['status'], extra: Partial<Session> = {}): Session => ({
  id: 's',
  resourceId: 'r',
  providerId: 'mock',
  presentation: 'claude',
  status,
  model: 'Demo model',
  ...extra,
});

describe('project threads', () => {
  it('splits a project’s conversations into open and archived, newest first', () => {
    const { open, archived } = threadsOf(
      [
        thread('old', { updatedAt: daysAgo(5) }),
        thread('new', { updatedAt: daysAgo(0.1) }),
        // Archived threads sort by when they were archived, not last used.
        thread('archived-early', { closedAt: daysAgo(4), updatedAt: daysAgo(4.5) }),
        thread('archived-late', { closedAt: daysAgo(1), updatedAt: daysAgo(9) }),
        thread('elsewhere', { projectId: 'project-atlas' }),
        { ...thread('terminal'), kind: 'terminal' },
      ],
      'project-jam',
    );
    expect(open.map((item) => item.id)).toEqual(['new', 'old']);
    expect(archived.map((item) => item.id)).toEqual(['archived-late', 'archived-early']);
  });

  it('counts open and archived threads per project, with Unicode names', () => {
    const resources = [
      thread('café repo testing', { projectId: 'project-café' }),
      thread('naïve résumé — 日本語', { projectId: 'project-café', closedAt: daysAgo(2) }),
      thread('other', { projectId: 'project-jam', closedAt: daysAgo(2) }),
    ];
    const { open, archived } = threadsOf(resources, 'project-café');
    expect([open.length, archived.length]).toEqual([1, 1]);
    expect(archived[0]?.title).toBe('naïve résumé — 日本語');
  });

  it('only suggests archiving an idle, open, quiet thread — and Keep open snoozes it', () => {
    const idle = thread('idle', { updatedAt: daysAgo(12) });
    expect(suggestsArchiving(idle, undefined, now, 7)).toBe(true);
    expect(suggestsArchiving(idle, undefined, now, null)).toBe(false);
    expect(suggestsArchiving(idle, session('running'), now, 7)).toBe(false);
    expect(suggestsArchiving(idle, session('idle', { needsInput: true }), now, 7)).toBe(false);
    expect(suggestsArchiving({ ...idle, closedAt: daysAgo(1) }, undefined, now, 7)).toBe(false);
    expect(suggestsArchiving(thread('fresh', { updatedAt: daysAgo(2) }), undefined, now, 7)).toBe(
      false,
    );
    const kept = { ...idle, closeSuggestionDismissedAt: daysAgo(3) };
    expect(suggestsArchiving(kept, undefined, now, 7)).toBe(false);
    expect(suggestsArchiving(kept, undefined, now + 5 * 86_400_000, 7)).toBe(true);
  });

  it('refuses to archive a chat that is working or waiting, and says why', () => {
    expect(archiveBlocked(undefined)).toBeNull();
    expect(archiveBlocked(session('idle'))).toBeNull();
    expect(archiveBlocked(session('interrupted'))).toBeNull();
    expect(archiveBlocked(session('failed'))).toBeNull();
    expect(archiveBlocked(session('running'))).toMatch(/Stop the agent/);
    expect(archiveBlocked(session('running', { needsInput: true }))).toMatch(/Answer/);
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

describe('archived chats in History and Pinned', () => {
  const sessions: Session[] = [
    session('idle', { id: 's-claude', providerId: 'claude' }),
    session('idle', { id: 's-codex', providerId: 'codex', presentation: 'codex' }),
  ];
  const resources = [
    thread('recent', { sessionId: 's-claude', updatedAt: daysAgo(1) }),
    thread('older', { sessionId: 's-codex', updatedAt: daysAgo(3), projectId: 'project-atlas' }),
    thread('archived', { sessionId: 's-claude', updatedAt: daysAgo(0.5), closedAt: daysAgo(0.2) }),
    thread('pinned', { sessionId: 's-claude', pinned: true }),
    thread('pinned-archived', { sessionId: 's-claude', pinned: true, closedAt: daysAgo(2) }),
    { ...thread('terminal'), kind: 'terminal' as const },
  ];
  const ids = (items: Resource[]) => items.map((item) => item.id);

  it('leaves archived chats out of Recent, however recently they were used', () => {
    expect(ids(recentChats(resources, sessions))).toEqual(['recent', 'older']);
  });

  it('applies the project and provider filters to Recent', () => {
    expect(ids(recentChats(resources, sessions, { projectId: 'project-atlas' }))).toEqual([
      'older',
    ]);
    expect(ids(recentChats(resources, sessions, { providerId: 'claude' }))).toEqual(['recent']);
    expect(ids(recentChats(resources, sessions, { projectId: '', providerId: '' }))).toEqual([
      'recent',
      'older',
    ]);
  });

  it('hides an archived chat from Pinned but keeps its pin for when it is reopened', () => {
    expect(ids(pinnedChats(resources))).toEqual(['pinned']);
    const reopened = resources.map((item) =>
      item.id === 'pinned-archived' ? { ...item, closedAt: undefined } : item,
    );
    expect(ids(pinnedChats(reopened))).toEqual(['pinned', 'pinned-archived']);
  });

  it('counts only current chats for History', () => {
    expect(ids(currentChats(resources))).toEqual(['recent', 'older', 'pinned']);
  });
});
