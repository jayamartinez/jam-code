import { describe, expect, it, vi } from 'vitest';
import type {
  JamTransport,
  RequestMap,
  RequestMethod,
  TerminalSession,
  TerminalStreamEvent,
} from '@jam/protocol';
import { ACK_EVERY, TerminalConnection, chunkInput } from './terminal-connection';

const session = (overrides: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 'terminal-session-1',
  resourceId: 'terminal-1',
  projectId: 'project-jam',
  cwd: '/home/demo',
  cwdLabel: '~',
  cwdSource: 'home',
  shell: 'zsh',
  title: 'zsh',
  status: 'running',
  createdAt: '2026-09-26T10:00:00.000Z',
  cols: 80,
  rows: 24,
  ...overrides,
});

const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

function harness() {
  const calls: { method: string; params: unknown }[] = [];
  let deliver: (event: TerminalStreamEvent) => void = () => {};
  const detach = vi.fn();
  const pending: (() => void)[] = [];
  let holdInput = false;
  const transport: JamTransport = {
    async subscribe() {
      throw new Error('Terminal views do not use workspace subscriptions.');
    },
    async attachTerminal(_resourceId, listener) {
      deliver = listener;
      listener({ type: 'snapshot', attachmentId: 'attachment-1', terminal: session(), data: '$ ' });
      return { id: 'attachment-1', detach };
    },
    async request<M extends RequestMethod>(
      method: M,
      params: RequestMap[M]['params'],
    ): Promise<RequestMap[M]['result']> {
      calls.push({ method, params });
      if (method === 'terminal.input' && holdInput)
        await new Promise<void>((resolve) => pending.push(resolve));
      if (method === 'terminal.resize') {
        const { cols, rows } = params as RequestMap['terminal.resize']['params'];
        return { terminal: session({ cols, rows }) } as RequestMap[M]['result'];
      }
      return { accepted: true } as RequestMap[M]['result'];
    },
  };
  const written: string[] = [];
  const screen = {
    write: vi.fn((data: string, rendered: () => void) => {
      written.push(data);
      rendered();
    }),
    reset: vi.fn(),
  };
  const onSession = vi.fn();
  const onError = vi.fn();
  const connection = new TerminalConnection(transport, 'terminal-1', screen, {
    onSession,
    onError,
  });
  return {
    connection,
    calls,
    written,
    screen,
    onSession,
    onError,
    detach,
    deliver: (event: TerminalStreamEvent) => deliver(event),
    hold: (value: boolean) => (holdInput = value),
    release: () => pending.splice(0).forEach((resolve) => resolve()),
    methods: () => calls.map((call) => call.method),
  };
}

describe('terminal connection', () => {
  it('draws the snapshot, then streams output to the screen and not to state', async () => {
    const test = harness();
    await test.connection.open();
    expect(test.written).toEqual(['$ ']);
    expect(test.onSession).toHaveBeenCalledTimes(1);
    test.deliver({ type: 'output', seq: 1, data: 'hello\r\n' });
    test.deliver({ type: 'output', seq: 2, data: '\u001b[31mred\u001b[0m' });
    expect(test.written).toEqual(['$ ', 'hello\r\n', '\u001b[31mred\u001b[0m']);
    // Output never notifies the surrounding UI.
    expect(test.onSession).toHaveBeenCalledTimes(1);
  });

  it('sends input in order, one request at a time', async () => {
    const test = harness();
    await test.connection.open();
    test.hold(true);
    test.connection.input('l');
    test.connection.input('s');
    test.connection.input('\r');
    await flush();
    expect(test.methods()).toEqual(['terminal.input']);
    test.hold(false);
    test.release();
    await flush();
    expect(test.calls.map((call) => call.params)).toEqual([
      { resourceId: 'terminal-1', data: 'l' },
      { resourceId: 'terminal-1', data: 's\r' },
    ]);
  });

  it('splits large pastes without breaking characters', () => {
    const text = `${'a'.repeat(9)}😀${'b'.repeat(5)}`;
    const chunks = chunkInput(text, 10);
    expect(chunks.join('')).toBe(text);
    expect(chunks[0]).toBe('a'.repeat(9));
    expect(chunks.every((chunk) => chunk.length <= 10)).toBe(true);
  });

  it('acknowledges rendered output in steps', async () => {
    const test = harness();
    await test.connection.open();
    const chunk = 'x'.repeat(ACK_EVERY / 4);
    for (let seq = 1; seq <= 4; seq++) test.deliver({ type: 'output', seq, data: chunk });
    await flush();
    expect(test.calls.filter((call) => call.method === 'terminal.ack')).toEqual([
      { method: 'terminal.ack', params: { attachmentId: 'attachment-1', seq: 4 } },
    ]);
  });

  it('sends only the latest size while a resize is in flight', async () => {
    const test = harness();
    await test.connection.open();
    test.connection.resize(100, 30);
    test.connection.resize(101, 30);
    test.connection.resize(120, 40);
    await flush();
    expect(test.calls.filter((call) => call.method === 'terminal.resize')).toEqual([
      { method: 'terminal.resize', params: { resourceId: 'terminal-1', cols: 100, rows: 30 } },
      { method: 'terminal.resize', params: { resourceId: 'terminal-1', cols: 120, rows: 40 } },
    ]);
    test.connection.resize(120, 40);
    test.connection.resize(0, 40);
    await flush();
    expect(test.methods().filter((method) => method === 'terminal.resize')).toHaveLength(2);
  });

  it('closing a view detaches it and never ends the shell', async () => {
    const test = harness();
    await test.connection.open();
    test.connection.close();
    test.connection.close();
    expect(test.detach).toHaveBeenCalledTimes(1);
    test.deliver({ type: 'output', seq: 1, data: 'late' });
    test.connection.input('ignored');
    await flush();
    expect(test.written).toEqual(['$ ']);
    expect(test.methods()).not.toContain('terminal.kill');
    expect(test.methods()).not.toContain('terminal.input');
  });

  it('a new shell in the same resource starts on a clean screen', async () => {
    const test = harness();
    await test.connection.open();
    test.deliver({
      type: 'session',
      terminal: session({ status: 'exited', exitCode: 0, endedAt: '2026-09-26T10:01:00Z' }),
    });
    expect(test.screen.reset).not.toHaveBeenCalled();
    test.connection.input('ignored after exit');
    test.deliver({ type: 'session', terminal: session({ id: 'terminal-session-2' }) });
    expect(test.screen.reset).toHaveBeenCalledTimes(1);
    expect(test.connection.current?.id).toBe('terminal-session-2');
    await flush();
    expect(test.methods()).not.toContain('terminal.input');
  });

  it('reports an unavailable terminal instead of pretending', async () => {
    const test = harness();
    const failing: JamTransport = {
      request: () => Promise.reject(new Error('unused')),
      subscribe: () => Promise.reject(new Error('unused')),
      attachTerminal: () => Promise.reject(new Error('Terminals run in the jam desktop app.')),
    };
    const onError = vi.fn();
    const connection = new TerminalConnection(
      failing,
      'terminal-1',
      { write: () => {}, reset: () => {} },
      { onSession: () => {}, onError },
    );
    await connection.open();
    expect(onError).toHaveBeenCalledWith('Terminals run in the jam desktop app.');
    expect(test.detach).not.toHaveBeenCalled();
  });
});
