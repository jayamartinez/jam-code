import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserPreviewTransport } from './preview';
import type { JamEvent } from './types';

const resourceId = 'conv-pane-lifetime';
const sessionId = 'session-pane-lifetime';
const turn = (text = 'Keep the session alive', requestId = 'request-1') => ({
  resourceId,
  text,
  context: [],
  requestId,
});

describe('explicit browser preview runtime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('keeps preview instances isolated and returns detached snapshots', async () => {
    const first = new BrowserPreviewTransport();
    const second = new BrowserPreviewTransport();
    const snapshot = await first.request('workspace.get', {});
    snapshot.resources[0]!.title = 'Client-side mutation';
    expect((await first.request('workspace.get', {})).resources[0]?.title).not.toBe(
      'Client-side mutation',
    );
    expect((await second.request('workspace.get', {})).runtimeId).not.toBe(snapshot.runtimeId);
    expect(snapshot.runtimeId.startsWith('preview-')).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deduplicates accepted submissions before and after completion', async () => {
    const runtime = new BrowserPreviewTransport();
    const before = await runtime.request('conversation.get', { resourceId });
    const receipt = await runtime.request('turn.start', turn());
    expect(await runtime.request('turn.start', turn())).toEqual(receipt);
    expect((await runtime.request('conversation.get', { resourceId })).messages).toHaveLength(
      before.messages.length + 2,
    );
    await vi.runAllTimersAsync();
    expect(await runtime.request('turn.start', turn())).toEqual(receipt);
    expect((await runtime.request('conversation.get', { resourceId })).messages).toHaveLength(
      before.messages.length + 2,
    );
    await expect(runtime.request('turn.start', turn('Different payload'))).rejects.toMatchObject({
      code: 'conflict',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects conflicting work and preserves the accepted transcript', async () => {
    const runtime = new BrowserPreviewTransport();
    await runtime.request('turn.start', turn());
    const conversation = await runtime.request('conversation.get', { resourceId });
    await expect(
      runtime.request('turn.start', turn('Second turn', 'request-2')),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect((await runtime.request('conversation.get', { resourceId })).messages).toEqual(
      conversation.messages,
    );
  });

  it('finishes work after the last visible subscriber detaches', async () => {
    const runtime = new BrowserPreviewTransport();
    const events: JamEvent[] = [];
    const unrelated = vi.fn();
    await runtime.subscribe({ resourceId: 'conv-navigation' }, unrelated);
    const unsubscribe = await runtime.subscribe({ resourceId }, (event) => events.push(event));
    await runtime.request('turn.start', turn());
    expect(
      events.some(
        (event) => event.type === 'session.updated' && event.session.status === 'running',
      ),
    ).toBe(true);
    unsubscribe();
    unsubscribe();
    const detachedCount = events.length;
    await vi.runAllTimersAsync();
    expect(events).toHaveLength(detachedCount);
    expect(unrelated).not.toHaveBeenCalled();
    const workspace = await runtime.request('workspace.get', {});
    expect(workspace.sessions.find((session) => session.id === sessionId)?.status).toBe('idle');
    expect(workspace.providers.find((provider) => provider.id === 'mock')?.running).toBe(false);
    const conversation = await runtime.request('conversation.get', { resourceId });
    expect(conversation.messages.at(-1)?.blocks.at(-1)).toMatchObject({
      type: 'text',
      text: expect.stringContaining('simulated response'),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('upserts one assistant message through monotonically ordered events', async () => {
    const runtime = new BrowserPreviewTransport();
    const events: JamEvent[] = [];
    await runtime.subscribe({ resourceId }, (event) => events.push(event));
    await runtime.request('turn.start', turn());
    await vi.runAllTimersAsync();
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.cursor.sequence).toBeGreaterThan(events[index - 1]!.cursor.sequence);
    }
    const assistantEvents = events.filter(
      (event) => event.type === 'message.upserted' && event.message.role === 'assistant',
    );
    expect(assistantEvents).toHaveLength(4);
    const ids = assistantEvents.map((event) =>
      event.type === 'message.upserted' ? event.message.id : '',
    );
    expect(new Set(ids).size).toBe(1);
    expect(assistantEvents[0]).toMatchObject({ message: { blocks: [] } });
    expect(assistantEvents.at(-1)).toMatchObject({
      message: {
        blocks: expect.arrayContaining([
          expect.objectContaining({ type: 'tool', status: 'completed' }),
        ]),
      },
    });
  });

  it('interrupts immediately and does not later publish successful completion', async () => {
    const runtime = new BrowserPreviewTransport();
    await runtime.request('turn.start', turn());
    await vi.advanceTimersByTimeAsync(900);
    expect(await runtime.request('turn.interrupt', { sessionId })).toEqual({
      sessionId,
      interrupted: true,
    });
    expect(await runtime.request('turn.interrupt', { sessionId })).toEqual({
      sessionId,
      interrupted: false,
    });
    await vi.runAllTimersAsync();
    expect(
      (await runtime.request('workspace.get', {})).sessions.find(
        (session) => session.id === sessionId,
      )?.status,
    ).toBe('interrupted');
    expect(
      (await runtime.request('conversation.get', { resourceId })).messages.at(-1)?.blocks.at(-1),
    ).toMatchObject({ text: expect.stringContaining('interrupted') });
    expect(vi.getTimerCount()).toBe(0);
    await runtime.request('turn.start', turn('Continue now', 'request-2'));
    await vi.runAllTimersAsync();
    expect(
      (await runtime.request('workspace.get', {})).sessions.find(
        (session) => session.id === sessionId,
      )?.status,
    ).toBe('idle');
  });

  it('allows cancellation from a running-state listener without leaving a timer', async () => {
    const runtime = new BrowserPreviewTransport();
    const sequences: number[] = [];
    await runtime.subscribe({ resourceId }, (event) => {
      if (event.type === 'session.updated' && event.session.status === 'running') {
        void runtime.request('turn.interrupt', { sessionId });
      }
    });
    await runtime.subscribe({ resourceId }, (event) => sequences.push(event.cursor.sequence));
    await runtime.request('turn.start', turn());
    await vi.runAllTimersAsync();
    expect(
      (await runtime.request('workspace.get', {})).sessions.find(
        (session) => session.id === sessionId,
      )?.status,
    ).toBe('interrupted');
    expect(vi.getTimerCount()).toBe(0);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
  });

  it('deduplicates equivalent context even if JSON field ordering changes', async () => {
    const runtime = new BrowserPreviewTransport();
    const context = [
      {
        id: 'attachment',
        kind: 'file' as const,
        label: 'App.tsx',
        source: { uri: 'project://demo/App.tsx', resourceId: 'file-pane' },
      },
    ];
    const receipt = await runtime.request('turn.start', { ...turn(), context });
    const reordered = [
      {
        source: { resourceId: 'file-pane', uri: 'project://demo/App.tsx' },
        label: 'App.tsx',
        kind: 'file' as const,
        id: 'attachment',
      },
    ];
    expect(await runtime.request('turn.start', { ...turn(), context: reordered })).toEqual(receipt);
  });

  it('reports deterministic failure and permits a later turn', async () => {
    const runtime = new BrowserPreviewTransport();
    await runtime.request('turn.start', turn('/fail'));
    await vi.runAllTimersAsync();
    expect(
      (await runtime.request('workspace.get', {})).sessions.find(
        (session) => session.id === sessionId,
      )?.status,
    ).toBe('failed');
    expect(
      (await runtime.request('conversation.get', { resourceId })).messages.at(-1)?.blocks.at(-1),
    ).toMatchObject({ text: expect.stringContaining('simulated failure') });
    await runtime.request('turn.start', turn('Retry', 'request-2'));
    await vi.runAllTimersAsync();
    expect(
      (await runtime.request('workspace.get', {})).sessions.find(
        (session) => session.id === sessionId,
      )?.status,
    ).toBe('idle');
  });

  it('searches titles, text and tool paths with project, provider and pinned filters', async () => {
    const runtime = new BrowserPreviewTransport();
    expect((await runtime.request('search.query', { query: ' ' })).results).toHaveLength(0);
    const result = await runtime.request('search.query', {
      query: 'SessionMan',
      projectId: 'project-jam',
      providerId: 'mock',
      pinned: true,
    });
    expect(result.results.map((item) => item.resourceId)).toContain(resourceId);
    expect(
      (await runtime.request('search.query', { query: 'session', projectId: 'project-forge' }))
        .results,
    ).toHaveLength(0);
    expect(
      (await runtime.request('search.query', { query: 'session', providerId: 'claude' })).results,
    ).toHaveLength(0);
    expect((await runtime.request('search.query', { query: '"*()' })).results).toHaveLength(0);
  });

  it('creates a conversation under an existing project and names it on first send', async () => {
    const runtime = new BrowserPreviewTransport();
    await expect(
      runtime.request('conversation.create', { projectId: 'missing', presentation: 'codex' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    const created = await runtime.request('conversation.create', {
      projectId: 'project-jam',
      presentation: 'codex',
    });
    expect(created.session.providerId).toBe('mock');
    expect(created.conversation.messages).toHaveLength(0);
    await runtime.request('turn.start', {
      ...turn('Investigate pane ownership'),
      resourceId: created.resource.id,
    });
    expect(
      (await runtime.request('workspace.get', {})).resources.find(
        (resource) => resource.id === created.resource.id,
      )?.title,
    ).toBe('Investigate pane ownership');
  });

  it('queues follow-ups and starts them in order as turns complete', async () => {
    const runtime = new BrowserPreviewTransport();
    const sessions: string[] = [];
    await runtime.subscribe({ resourceId }, (event) => {
      if (event.type === 'session.updated') sessions.push(event.session.status);
    });
    await runtime.request('turn.start', turn());
    const queue = (text: string, requestId: string) =>
      runtime.request('queue.add', { resourceId, text, context: [], requestId });
    await queue('second', 'q1');
    await queue('third', 'q2');
    expect(await queue('second', 'q1')).toMatchObject({ requestId: 'q1' });
    const waiting = await runtime.request('conversation.get', { resourceId });
    expect(waiting.queued?.map((item) => item.text)).toEqual(['second', 'third']);
    await vi.runAllTimersAsync();
    const done = await runtime.request('conversation.get', { resourceId });
    expect(done.queued).toEqual([]);
    const sent = done.messages
      .filter((message) => message.role === 'user')
      .slice(-3)
      .map((message) => (message.blocks[0]?.type === 'text' ? message.blocks[0].text : ''));
    expect(sent).toEqual(['Keep the session alive', 'second', 'third']);
    // One idle at the very end: no "finished" between handed-off turns.
    expect(sessions.filter((status) => status === 'idle')).toHaveLength(1);
  });

  it('keeps the queue after Stop and steers a streaming demo turn', async () => {
    const runtime = new BrowserPreviewTransport();
    await runtime.request('turn.start', turn());
    await runtime.request('queue.add', { resourceId, text: 'later', context: [], requestId: 'q1' });
    await runtime.request('turn.steer', {
      resourceId,
      text: 'use tabs',
      context: [],
      requestId: 's1',
    });
    const steered = await runtime.request('conversation.get', { resourceId });
    expect(steered.messages.at(-2)?.role).toBe('user');
    expect(steered.messages.at(-1)?.role).toBe('assistant');
    await runtime.request('turn.interrupt', { sessionId });
    await vi.runAllTimersAsync();
    const stopped = await runtime.request('conversation.get', { resourceId });
    expect(stopped.queued?.map((item) => item.text)).toEqual(['later']);
    await expect(
      runtime.request('turn.steer', { resourceId, text: 'late', context: [], requestId: 's2' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
