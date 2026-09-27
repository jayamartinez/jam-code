import { describe, expect, it } from 'vitest';
import { BrowserPreviewTransport } from './preview';
import { validateRequest, validateResponse, validateTerminalEvent } from './validation';

const request = (method: string, params: unknown) =>
  validateRequest({ protocolVersion: 1, method, params });

const session = {
  id: 'terminal-session-1',
  resourceId: 'terminal-1',
  projectId: 'project-jam',
  cwd: '/Users/demo/code/jam',
  cwdLabel: '~/code/jam',
  cwdSource: 'project',
  shell: 'zsh',
  title: 'zsh',
  status: 'running',
  createdAt: '2026-09-26T10:00:00.000Z',
  cols: 80,
  rows: 24,
};

describe('terminal contract', () => {
  it('bounds terminal requests before they reach the runtime', () => {
    expect(() => request('terminal.create', { projectId: 'project-jam' })).not.toThrow();
    expect(() => request('terminal.create', { projectId: 'project-jam', cols: 1 })).toThrow();
    expect(() => request('terminal.create', { projectId: 'project-jam', rows: 501 })).toThrow();
    // The client never chooses the program: there is no shell field.
    expect(() =>
      request('terminal.create', { projectId: 'project-jam', shell: '/bin/sh' }),
    ).toThrow();
    expect(() => request('terminal.input', { resourceId: 'terminal-1', data: '' })).toThrow();
    expect(() =>
      request('terminal.input', { resourceId: 'terminal-1', data: 'x'.repeat(65_537) }),
    ).toThrow();
    expect(() =>
      request('terminal.input', { resourceId: 'terminal-1', data: '\u0003' }),
    ).not.toThrow();
    expect(() =>
      request('terminal.resize', { resourceId: 'terminal-1', cols: 80.5, rows: 24 }),
    ).toThrow();
    expect(() => request('terminal.ack', { attachmentId: 'a', seq: -1 })).toThrow();
  });

  it('validates sessions and stream events from the runtime', () => {
    expect(() => validateResponse('terminal.get', { terminal: session })).not.toThrow();
    expect(() => validateResponse('terminal.get', {})).not.toThrow();
    expect(() =>
      validateResponse('terminal.get', { terminal: { ...session, status: 'zombie' } }),
    ).toThrow();
    expect(() =>
      validateResponse('terminal.kill', {
        terminal: {
          ...session,
          status: 'exited',
          exitCode: 1,
          terminated: true,
          endedAt: '2026-09-26T10:01:00Z',
        },
      }),
    ).not.toThrow();
    expect(
      validateTerminalEvent({ type: 'snapshot', attachmentId: 'a', terminal: session, data: '' }),
    ).toMatchObject({ type: 'snapshot' });
    expect(() =>
      validateTerminalEvent({ type: 'output', seq: 1, data: '\u001b[0m' }),
    ).not.toThrow();
    expect(() => validateTerminalEvent({ type: 'output', seq: 1 })).toThrow();
    expect(() => validateTerminalEvent({ type: 'session', terminal: {} })).toThrow();
    expect(() => validateTerminalEvent({ type: 'run', command: 'ls' })).toThrow();
  });

  it('the browser preview says it cannot run a shell instead of pretending', async () => {
    const preview = new BrowserPreviewTransport();
    await expect(preview.request('terminal.list', {})).resolves.toEqual({ terminals: [] });
    await expect(preview.request('terminal.get', { resourceId: 'terminal-pane' })).resolves.toEqual(
      {},
    );
    await expect(
      preview.request('terminal.create', { projectId: 'project-jam' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(preview.attachTerminal()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
