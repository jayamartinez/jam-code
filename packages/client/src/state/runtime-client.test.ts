import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validateFixture,
  type Conversation,
  type JamEvent,
  type JamTransport,
  type RequestMap,
  type RequestMethod,
} from '@jam/protocol';
import { BrowserPreviewTransport } from '@jam/protocol/preview';
import fixtureJson from '../../../protocol/fixtures/workspace.json';
import { applyEvent, RuntimeClient } from './runtime-client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

function harness() {
  const fixture = structuredClone(validateFixture(fixtureJson));
  const resourceId = fixture.conversations[0]!.resourceId;
  const calls: string[] = [];
  let listener: ((event: JamEvent) => void) | undefined;
  let nextConversation: Promise<Conversation> | undefined;
  let nextWorkspace: Promise<RequestMap['workspace.get']['result']> | undefined;
  const dispose = vi.fn();
  const transport: JamTransport = {
    async attachTerminal() {
      throw new Error('This harness has no terminals.');
    },
    async subscribe(_scope, callback) {
      calls.push('subscribe');
      listener = callback;
      return dispose;
    },
    async request<M extends RequestMethod>(method: M): Promise<RequestMap[M]['result']> {
      calls.push(method);
      if (method === 'workspace.get') {
        const pending = nextWorkspace;
        nextWorkspace = undefined;
        return (
          pending ? await pending : structuredClone(fixture.workspace)
        ) as RequestMap[M]['result'];
      }
      if (method === 'conversation.get') {
        const pending = nextConversation;
        nextConversation = undefined;
        return (
          pending ? await pending : structuredClone(fixture.conversations[0]!)
        ) as RequestMap[M]['result'];
      }
      throw new Error(`Unexpected method ${method}`);
    },
  };
  return {
    fixture,
    resourceId,
    calls,
    dispose,
    transport,
    emit: (event: JamEvent) => listener?.(event),
    delayConversation: (promise: Promise<Conversation>) => {
      nextConversation = promise;
    },
    delayWorkspace: (promise: Promise<RequestMap['workspace.get']['result']>) => {
      nextWorkspace = promise;
    },
  };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('runtime projection lifetime and recovery', () => {
  it('registers before snapshot and replaces duplicate message identities', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    expect(h.calls.slice(0, 2)).toEqual(['subscribe', 'workspace.get']);
    await client.loadConversation(h.resourceId);
    const before = client.getConversation(h.resourceId)!;
    const message = {
      ...before.messages[1]!,
      blocks: [{ type: 'text' as const, text: 'Updated output' }],
    };
    const event: JamEvent = {
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence: 1 },
      type: 'message.upserted',
      message,
    };
    h.emit(event);
    h.emit(event);
    expect(client.getConversation(h.resourceId)?.messages).toHaveLength(before.messages.length);
    expect(client.getConversation(h.resourceId)?.messages[1]?.blocks).toEqual(message.blocks);
    client.disconnect();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it('rejects a delayed old-epoch conversation after authoritative recovery', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    const unsubscribe = client.subscribeConversation(h.resourceId, () => undefined);
    const oldRead = deferred<Conversation>();
    h.delayConversation(oldRead.promise);
    const loading = client.loadConversation(h.resourceId);
    const oldConversation = structuredClone(h.fixture.conversations[0]!);
    h.fixture.workspace.runtimeId = 'restarted-runtime';
    h.fixture.workspace.sequence = 1;
    h.fixture.conversations[0]!.cursor = { runtimeId: 'restarted-runtime', sequence: 1 };
    h.fixture.conversations[0]!.messages[0]!.blocks = [{ type: 'text', text: 'After restart' }];
    h.emit({
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: 'restarted-runtime', sequence: 1 },
      type: 'session.updated',
      session: h.fixture.workspace.sessions[0]!,
    });
    await flush();
    oldRead.resolve(oldConversation);
    await loading;
    expect(client.getConversation(h.resourceId)?.cursor.runtimeId).toBe('restarted-runtime');
    expect(client.getConversation(h.resourceId)?.messages[0]?.blocks).toEqual([
      { type: 'text', text: 'After restart' },
    ]);
    unsubscribe();
    client.disconnect();
  });

  it('refetches gaps and does not replay a guessed transcript', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    await client.loadConversation(h.resourceId);
    h.fixture.workspace.sequence = 4;
    h.fixture.conversations[0]!.cursor.sequence = 4;
    h.fixture.conversations[0]!.messages[1]!.blocks = [
      { type: 'text', text: 'Recovered complete output' },
    ];
    h.emit({
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence: 4 },
      type: 'message.upserted',
      message: h.fixture.conversations[0]!.messages[1]!,
    });
    await flush();
    expect(h.calls.filter((call) => call === 'workspace.get')).toHaveLength(2);
    expect(client.getConversation(h.resourceId)?.messages[1]?.blocks).toEqual([
      { type: 'text', text: 'Recovered complete output' },
    ]);
    client.disconnect();
  });

  it('resnapshots after a bounded bootstrap buffer overflows', async () => {
    const h = harness();
    const pending = deferred<RequestMap['workspace.get']['result']>();
    h.delayWorkspace(pending.promise);
    const client = new RuntimeClient(h.transport);
    const connecting = client.connect();
    await flush();
    const initial = structuredClone(h.fixture.workspace);
    for (let sequence = 1; sequence <= 700; sequence++)
      h.emit({
        protocolVersion: 1,
        resourceId: h.resourceId,
        cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence },
        type: 'session.updated',
        session: h.fixture.workspace.sessions[0]!,
      });
    h.fixture.workspace.sequence = 700;
    pending.resolve(initial);
    await connecting;
    expect(h.calls.filter((call) => call === 'workspace.get')).toHaveLength(2);
    expect(client.getSnapshot().workspace?.sequence).toBe(700);
    client.disconnect();
  });

  it('rereads chat order when a chat starts waiting, and not while it keeps waiting', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    const session = h.fixture.workspace.sessions[0]!;
    const reads = () => h.calls.filter((call) => call === 'workspace.get').length;
    const update = (sequence: number, changes: Partial<typeof session>) =>
      h.emit({
        protocolVersion: 1,
        resourceId: h.resourceId,
        cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence },
        type: 'session.updated',
        session: { ...session, status: 'running', ...changes },
      });
    update(1, {});
    await flush();
    expect(reads()).toBe(1);
    // The runtime moved the chat up when it asked; its timestamp is read again.
    h.fixture.workspace.resources.find((item) => item.id === h.resourceId)!.updatedAt =
      '2030-01-01T00:00:00.000Z';
    update(2, { needsInput: true });
    await flush();
    expect(reads()).toBe(2);
    expect(
      client.getSnapshot().workspace?.resources.find((item) => item.id === h.resourceId)?.updatedAt,
    ).toBe('2030-01-01T00:00:00.000Z');
    // A later update of the same waiting chat is not another reason to read.
    update(3, { needsInput: true, model: 'Another model' });
    await flush();
    expect(reads()).toBe(2);
    client.disconnect();
  });

  it('applies an arrangement of sections and projects to the projection', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    const ids = client.getSnapshot().workspace!.projects.map((project) => project.id);
    const reversed = [...ids].reverse();
    // A project the order does not name stays after the ones it does.
    client.reorderProjects(reversed.slice(0, 2));
    expect(client.getSnapshot().workspace!.projects.map((project) => project.id)).toEqual([
      ...reversed.slice(0, 2),
      ...ids.filter((id) => !reversed.slice(0, 2).includes(id)),
    ]);
    client.reorderSections(['history', 'projects', 'pinned']);
    expect(client.getSnapshot().workspace!.sidebarSections).toEqual([
      'history',
      'projects',
      'pinned',
    ]);
    client.disconnect();
  });

  it('releases a subscription that finishes registering after disposal', async () => {
    const pending = deferred<() => void>();
    const dispose = vi.fn();
    const h = harness();
    h.transport.subscribe = () => pending.promise;
    const client = new RuntimeClient(h.transport);
    const connecting = client.connect();
    client.disconnect();
    pending.resolve(dispose);
    await connecting;
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.calls).not.toContain('workspace.get');
  });

  it('detaching UI preserves a running mock turn and creation is an idempotent upsert', async () => {
    vi.useFakeTimers();
    const transport = new BrowserPreviewTransport();
    const request = vi.spyOn(transport, 'request');
    const client = new RuntimeClient(transport);
    await client.connect();
    const created = await transport.request('conversation.create', {
      projectId: 'project-jam',
      presentation: 'claude',
    });
    await flush();
    client.addConversation(created);
    client.addConversation(created);
    expect(
      client
        .getSnapshot()
        .workspace?.resources.filter((resource) => resource.id === created.resource.id),
    ).toHaveLength(1);
    expect(
      client
        .getSnapshot()
        .workspace?.sessions.filter((session) => session.id === created.session.id),
    ).toHaveLength(1);
    await transport.request('turn.start', {
      resourceId: created.resource.id,
      text: 'Continue independently',
      context: [],
      requestId: 'lifetime-test',
    });
    client.disconnect();
    expect(request.mock.calls.some(([method]) => method === 'turn.interrupt')).toBe(false);
    await vi.runAllTimersAsync();
    expect(
      (await transport.request('workspace.get', {})).sessions.find(
        (session) => session.id === created.session.id,
      )?.status,
    ).toBe('idle');
  });

  it('offscreen message updates do not notify workspace or unrelated conversation listeners', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    await client.loadConversation(h.resourceId);
    const workspaceListener = vi.fn();
    const otherListener = vi.fn();
    client.subscribe(workspaceListener);
    client.subscribeConversation('different-resource', otherListener);
    h.emit({
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence: 1 },
      type: 'message.upserted',
      message: h.fixture.conversations[0]!.messages[1]!,
    });
    expect(workspaceListener).not.toHaveBeenCalled();
    expect(otherListener).not.toHaveBeenCalled();
    client.disconnect();
  });
});

it('ignores conversation events from a different runtime epoch', () => {
  const h = harness();
  const conversation = h.fixture.conversations[0]!;
  expect(
    applyEvent(conversation, {
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: 'unrelated', sequence: 100 },
      type: 'message.upserted',
      message: conversation.messages[1]!,
    }),
  ).toBe(conversation);
});

describe('a deleted conversation', () => {
  it('leaves the projection and is not restored by a read or event already on its way', async () => {
    const h = harness();
    const client = new RuntimeClient(h.transport);
    await client.connect();
    await client.loadConversation(h.resourceId);
    const sessionId = client.getConversation(h.resourceId)!.sessionId;
    const others = client.getSnapshot().workspace!.resources.length - 1;

    // A metadata read that started before the deletion still lists it.
    const stale = deferred<RequestMap['workspace.get']['result']>();
    h.delayWorkspace(stale.promise);
    h.emit({
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence: 1 },
      type: 'session.updated',
      session: { ...h.fixture.workspace.sessions.find((item) => item.id === sessionId)! },
    });

    const changed = vi.fn();
    client.subscribeConversation(h.resourceId, changed);
    client.removeConversation(h.resourceId);
    const gone = () => {
      const workspace = client.getSnapshot().workspace!;
      expect(workspace.resources.some((item) => item.id === h.resourceId)).toBe(false);
      expect(workspace.sessions.some((item) => item.id === sessionId)).toBe(false);
      expect(workspace.resources).toHaveLength(others);
      expect(client.getConversation(h.resourceId)).toBeUndefined();
    };
    gone();
    expect(changed).toHaveBeenCalled();

    stale.resolve(structuredClone(h.fixture.workspace));
    await flush();
    gone();

    // A late event for it changes nothing, and its transcript is never re-read.
    h.emit({
      protocolVersion: 1,
      resourceId: h.resourceId,
      cursor: { runtimeId: h.fixture.workspace.runtimeId, sequence: 2 },
      type: 'session.updated',
      session: {
        ...h.fixture.workspace.sessions.find((item) => item.id === sessionId)!,
        status: 'running',
      },
    });
    gone();
    const reads = h.calls.filter((call) => call === 'conversation.get').length;
    await client.loadConversation(h.resourceId);
    expect(h.calls.filter((call) => call === 'conversation.get')).toHaveLength(reads);

    // A full reread (reconnect) that still lists it is filtered too.
    await client.reload();
    gone();
  });
});

describe('the reported error', () => {
  it('about a chat is taken down by that chat’s next successful Send, and only then', () => {
    const client = new RuntimeClient(harness().transport);
    const shown = () => client.getSnapshot().error;

    client.reportError(new Error('Git refused to switch.'), 'chat-a');
    // Another chat's Send says nothing about this one.
    client.settle('chat-b');
    expect(shown()).toBe('Git refused to switch.');
    // A draft's Send settles under both its draft and its conversation ID.
    client.settle('draft-a', 'chat-a');
    expect(shown()).toBeNull();

    // An error that is about no chat stays until dismissed.
    client.reportError(new Error('The file could not be opened.'));
    client.settle('chat-a');
    expect(shown()).toBe('The file could not be opened.');

    // A newer error replaces what the banner is about.
    client.reportError(new Error('first'), 'chat-a');
    client.reportError(new Error('second'));
    client.settle('chat-a');
    expect(shown()).toBe('second');
    client.clearError();
    expect(shown()).toBeNull();
  });
});
