import { describe, expect, it, vi } from 'vitest';
import type { JamEvent } from '@jam/protocol';
import { TauriTransport } from './tauri-transport';
import type { NativeBridge } from './tauri-transport';

const event: JamEvent = {
  protocolVersion: 1,
  cursor: { runtimeId: 'test-runtime', sequence: 1 },
  resourceId: 'chat-1',
  type: 'session.updated',
  session: {
    id: 'session-1',
    resourceId: 'chat-1',
    providerId: 'mock',
    presentation: 'claude',
    status: 'running',
    model: 'Demo model',
  },
};

function bridgeFixture() {
  let deliver: (payload: unknown) => void = () => {};
  const call = vi.fn<NativeBridge['invoke']>();
  const bridge: NativeBridge = {
    invoke: call,
    channel(listener) {
      deliver = listener;
      return 'opaque-channel';
    },
  };
  return {
    transport: new TauriTransport(bridge),
    call,
    deliver: (payload: unknown) => deliver(payload),
  };
}

describe('Tauri transport', () => {
  it('validates inputs before crossing IPC and responses before returning them', async () => {
    const { transport, call } = bridgeFixture();
    await expect(transport.request('conversation.get', { resourceId: '' })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
    call.mockResolvedValueOnce({ malformed: true });
    await expect(
      transport.request('conversation.get', { resourceId: 'chat-1' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(call).toHaveBeenCalledWith('jam_request', {
      request: { protocolVersion: 1, method: 'conversation.get', params: { resourceId: 'chat-1' } },
    });
  });

  it('filters resources and ignores late delivery after an idempotent unsubscribe', async () => {
    const fixture = bridgeFixture();
    fixture.call.mockResolvedValue('subscription-1');
    const listener = vi.fn();
    const dispose = await fixture.transport.subscribe({ resourceId: 'chat-1' }, listener);
    fixture.deliver({
      ...event,
      resourceId: 'chat-2',
      session: { ...event.session, resourceId: 'chat-2' },
    });
    fixture.deliver(event);
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    dispose();
    fixture.deliver(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fixture.call.mock.calls.map(([command]) => command)).toEqual([
      'jam_subscribe',
      'jam_unsubscribe',
    ]);
  });

  it('preserves safe runtime errors and redacts unknown native details', async () => {
    const { transport, call } = bridgeFixture();
    call.mockRejectedValueOnce({ code: 'conflict', message: 'A turn is already running.' });
    await expect(transport.request('workspace.get', {})).rejects.toMatchObject({
      code: 'conflict',
    });
    call.mockRejectedValueOnce('native internal path or sensitive detail');
    await expect(transport.request('workspace.get', {})).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
