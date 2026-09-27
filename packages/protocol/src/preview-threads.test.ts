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
