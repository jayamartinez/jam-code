import { describe, expect, it } from 'vitest';
import { BrowserPreviewTransport } from './preview';
import { validateRequest } from './validation';

describe('thread lifecycle through the preview transport', () => {
  it('closes, keeps open and reopens only when asked, and a send reopens', async () => {
    const transport = new BrowserPreviewTransport();
    const closed = await transport.request('thread.setClosed', {
      resourceId: 'conv-pane-lifetime',
      closed: true,
    });
    expect(closed.resource.closedAt).toEqual(expect.any(String));

    const kept = await transport.request('thread.keepOpen', { resourceId: 'conv-navigation' });
    expect(kept.resource.closeSuggestionDismissedAt).toEqual(expect.any(String));
    expect(kept.resource.closedAt).toBeUndefined();

    await transport.request('turn.start', {
      resourceId: 'conv-pane-lifetime',
      text: 'Back to this',
      context: [],
      requestId: 'reopen-by-send',
    });
    const workspace = await transport.request('workspace.get', {});
    expect(
      workspace.resources.find((item) => item.id === 'conv-pane-lifetime')?.closedAt,
    ).toBeUndefined();

    await expect(
      transport.request('thread.setClosed', { resourceId: 'diff-pane', closed: true }),
    ).rejects.toThrow('Only a conversation');
  });

  it('keeps an archived thread whole and searchable, and refuses one that is working', async () => {
    const transport = new BrowserPreviewTransport();
    const before = (await transport.request('workspace.get', {})).resources.find(
      (item) => item.id === 'conv-pane-lifetime',
    )!;
    const { resource } = await transport.request('thread.setClosed', {
      resourceId: 'conv-pane-lifetime',
      closed: true,
    });
    expect(resource).toMatchObject({
      sessionId: before.sessionId,
      projectId: before.projectId,
      pinned: before.pinned,
      title: before.title,
    });
    const { results } = await transport.request('search.query', { query: 'PTY' });
    expect(results.map((item) => item.resourceId)).toContain('conv-pane-lifetime');

    // Archiving never stops an agent: a running turn is settled first.
    await transport.request('turn.start', {
      resourceId: 'conv-navigation',
      text: 'Keep working',
      context: [],
      requestId: 'archive-while-running',
    });
    await expect(
      transport.request('thread.setClosed', { resourceId: 'conv-navigation', closed: true }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('deletes an idle conversation for good, and refuses one that is working', async () => {
    const transport = new BrowserPreviewTransport();
    const before = await transport.request('workspace.get', {});
    const doomed = before.resources.find((item) => item.id === 'conv-layout')!;

    await transport.request('turn.start', {
      resourceId: 'conv-layout',
      text: 'Keep working',
      context: [],
      requestId: 'delete-while-running',
    });
    await expect(
      transport.request('conversation.delete', { resourceId: 'conv-layout' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const session = before.sessions.find((item) => item.id === doomed.sessionId)!;
    await transport.request('turn.interrupt', { sessionId: session.id });

    await expect(
      transport.request('conversation.delete', { resourceId: 'conv-layout' }),
    ).resolves.toEqual({ resourceId: 'conv-layout' });
    const after = await transport.request('workspace.get', {});
    expect(after.resources.map((item) => item.id)).toEqual(
      before.resources.map((item) => item.id).filter((id) => id !== 'conv-layout'),
    );
    expect(after.sessions.some((item) => item.id === session.id)).toBe(false);
    expect(after.projects).toEqual(before.projects);
    await expect(
      transport.request('conversation.get', { resourceId: 'conv-layout' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A retry is recognizable; other kinds of resource are never deleted this way.
    await expect(
      transport.request('conversation.delete', { resourceId: 'conv-layout' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      transport.request('conversation.delete', { resourceId: 'diff-pane' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'conversation.delete',
        params: { resourceId: 'conv-layout', force: true },
      }),
    ).toThrow();
  });

  it('pins and unpins a project', async () => {
    const transport = new BrowserPreviewTransport();
    const pinned = await transport.request('project.update', {
      projectId: 'project-orbit',
      pinned: true,
    });
    expect(pinned.project.pinned).toBe(true);
    const unpinned = await transport.request('project.update', {
      projectId: 'project-orbit',
      pinned: false,
    });
    expect(unpinned.project.pinned).toBeUndefined();
  });

  it('rejects malformed thread requests before they reach a runtime', () => {
    for (const params of [
      { resourceId: 'conv-layout' },
      { resourceId: 'conv-layout', closed: 'yes' },
      { resourceId: 'conv-layout', closed: true, reason: 'merged' },
    ])
      expect(() =>
        validateRequest({ protocolVersion: 1, method: 'thread.setClosed', params }),
      ).toThrow();
  });
});
