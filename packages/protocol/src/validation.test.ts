import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/workspace.json';
import { JamError } from './errors';
import { validateEvent, validateFixture, validateRequest, validateResponse } from './validation';

describe('JAM wire boundary', () => {
  it('validates the canonical fixture and resource/session references', () => {
    const seed = validateFixture(fixture);
    expect(seed.workspace.projects).toHaveLength(4);
    expect(seed.conversations).toHaveLength(9);
    expect(seed.workspace.resources.filter((resource) => resource.pinned)).toHaveLength(3);
    expect(new Set(seed.workspace.resources.map((resource) => resource.id)).size).toBe(
      seed.workspace.resources.length,
    );
    for (const conversation of seed.conversations) {
      const resource = seed.workspace.resources.find((item) => item.id === conversation.resourceId);
      const session = seed.workspace.sessions.find((item) => item.id === conversation.sessionId);
      expect(resource?.sessionId).toBe(session?.id);
      expect(session?.resourceId).toBe(resource?.id);
      expect(session?.providerId).toBe('mock');
    }
  });

  it('rejects unsupported versions and methods before interpreting input', () => {
    expect(() =>
      validateRequest({ protocolVersion: 2, method: 'workspace.get', params: {} }),
    ).toThrow(expect.objectContaining({ code: 'unsupported_version' }));
    expect(() => validateRequest({ protocolVersion: 1, method: 'shell.exec', params: {} })).toThrow(
      expect.objectContaining({ code: 'unknown_method' }),
    );
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'rejects inherited-looking unknown field %s',
    (key) => {
      const params: unknown = JSON.parse(`{"${key}": "unexpected"}`);
      expect(() =>
        validateRequest({ protocolVersion: 1, method: 'workspace.get', params }),
      ).toThrow(JamError);
    },
  );

  it('rejects malformed and oversized mutation input', () => {
    const params = { resourceId: 'conversation', text: '', context: [], requestId: 'request-1' };
    expect(() => validateRequest({ protocolVersion: 1, method: 'turn.start', params })).toThrow(
      JamError,
    );
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'turn.start',
        params: { ...params, text: 'x'.repeat(20_001) },
      }),
    ).toThrow(JamError);
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'turn.start',
        params: { ...params, text: 'Hello', context: [null] },
      }),
    ).toThrow(JamError);
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'turn.start',
        params: { ...params, text: 'Hello', extra: true },
      }),
    ).toThrow(JamError);
  });

  it('rejects non-JSON objects at the direct preview boundary', () => {
    expect(() =>
      validateRequest({ protocolVersion: 1, method: 'workspace.get', params: new Date() }),
    ).toThrow(JamError);
  });

  it('accepts an explicit context-only submission', () => {
    const params = {
      resourceId: 'conversation',
      text: ' ',
      requestId: 'request-context',
      context: [
        {
          id: 'context-1',
          kind: 'file',
          label: 'App.tsx',
          source: { uri: 'project://demo/App.tsx' },
        },
      ],
    };
    expect(validateRequest({ protocolVersion: 1, method: 'turn.start', params }).params).toEqual(
      params,
    );
  });

  it('validates received provider identities without restricting domain types to the mock', () => {
    const workspace = structuredClone(fixture.workspace);
    workspace.sessions[0]!.providerId = 'codex';
    expect(validateResponse('workspace.get', workspace).sessions[0]?.providerId).toBe('codex');
    workspace.sessions[0]!.providerId = 'imaginary';
    expect(() => validateResponse('workspace.get', workspace)).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
  });

  it('accepts a reported account only as bounded plain text', () => {
    const withAccount = (account: unknown) => ({
      providers: [{ ...fixture.workspace.providers[0], account }],
    });
    const account = { method: 'ChatGPT', plan: 'ChatGPT Pro 5x', identity: 'reader@example.com' };
    expect(validateResponse('provider.list', withAccount(account)).providers[0]?.account).toEqual(
      account,
    );
    expect(validateResponse('provider.list', withAccount({})).providers[0]?.account).toEqual({});
    for (const bad of [
      { identity: 'a'.repeat(257) },
      { identity: 'reader@example.com\nforged' },
      { identity: '\u001b[31mred' },
      { plan: 'x'.repeat(129) },
      { identity: 42 },
      { token: 'secret' },
    ]) {
      expect(() => validateResponse('provider.list', withAccount(bad))).toThrow(
        expect.objectContaining({ code: 'invalid_response' }),
      );
    }
    // The error names no reported value.
    try {
      validateResponse('provider.list', withAccount({ identity: 'reader@example.com\n' }));
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('reader@');
    }
  });

  it('rejects malformed native responses and mismatched event identities', () => {
    expect(() => validateResponse('turn.start', { accepted: true })).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
    expect(() =>
      validateEvent({
        protocolVersion: 1,
        cursor: { runtimeId: 'runtime', sequence: 1 },
        resourceId: 'wrong-resource',
        type: 'session.updated',
        session: fixture.workspace.sessions[0],
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_response' }));
    expect(() => validateEvent({ protocolVersion: 1, type: 'provider.raw-secret' })).toThrow(
      JamError,
    );
  });
});
