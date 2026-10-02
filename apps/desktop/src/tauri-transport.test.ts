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

  it('keeps the runtime’s own message for every code it answers with', async () => {
    const { transport, call } = bridgeFixture();
    // These once fell through to the generic failure, hiding what to do next.
    for (const [code, message] of [
      ['unsupported', 'Codex does not accept images with this model.'],
      ['project_folder_required', 'Add a folder to this project.'],
      ['provider_disabled', 'Codex is turned off in Settings.'],
      ['stale', 'That request is no longer waiting.'],
    ] as const) {
      call.mockRejectedValueOnce({ code, message });
      await expect(transport.request('workspace.get', {})).rejects.toMatchObject({
        code,
        message,
      });
    }
    // A code the protocol does not know is still not passed on.
    call.mockRejectedValueOnce({ code: 'made_up', message: 'C:\\Users\\someone\\secret' });
    await expect(transport.request('workspace.get', {})).rejects.toMatchObject({
      code: 'unavailable',
      message: 'The local runtime could not complete this request.',
    });
  });

  it('streams one terminal to one view and detaching leaves the shell alone', async () => {
    const fixture = bridgeFixture();
    fixture.call.mockResolvedValue('attachment-1');
    const listener = vi.fn();
    const attachment = await fixture.transport.attachTerminal('terminal-1', listener);
    expect(attachment.id).toBe('attachment-1');
    expect(fixture.call).toHaveBeenCalledWith('jam_terminal_attach', {
      resourceId: 'terminal-1',
      onEvent: 'opaque-channel',
    });
    fixture.deliver({ type: 'output', seq: 1, data: '\u001b[32mok\u001b[0m\r\n' });
    expect(listener).toHaveBeenCalledWith({
      type: 'output',
      seq: 1,
      data: '\u001b[32mok\u001b[0m\r\n',
    });
    // Malformed native payloads are rejected rather than written to a terminal.
    expect(() => fixture.deliver({ type: 'output', seq: -1, data: 'x' })).toThrow();
    expect(() => fixture.deliver({ type: 'exec', command: 'rm' })).toThrow();
    attachment.detach();
    attachment.detach();
    fixture.deliver({ type: 'output', seq: 2, data: 'late' });
    expect(listener).toHaveBeenCalledTimes(1);
    // Only a detach crosses IPC: nothing asks the runtime to stop the shell.
    expect(fixture.call.mock.calls.map(([command]) => command)).toEqual([
      'jam_terminal_attach',
      'jam_terminal_detach',
    ]);
  });
});
