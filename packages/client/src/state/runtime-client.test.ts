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
