import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/workspace.json';
import { BrowserPreviewTransport } from './preview';
import { validateEvent, validateRequest, validateResponse } from './validation';

const request = (method: string, params: unknown) =>
  validateRequest({ protocolVersion: 1, method, params });

describe('provider contract', () => {
  it('describes every capability for every provider', () => {
    const response = validateResponse('provider.list', { providers: fixture.workspace.providers });
    expect(response.providers.map((provider) => provider.id)).toEqual(['claude', 'codex', 'mock']);
  });

  it('accepts provider options only as short named values', () => {
    expect(() =>
      request('conversation.create', {
        projectId: 'p',
        presentation: 'claude',
        providerId: 'claude',
        options: { model: 'opus', effort: 'high', permissionMode: 'plan' },
      }),
    ).not.toThrow();
    expect(() =>
      request('conversation.create', {
        projectId: 'p',
        presentation: 'claude',
        providerId: 'gemini',
      }),
    ).toThrow();
    expect(() =>
      request('turn.start', {
        resourceId: 'r',
        text: 'hi',
        context: [],
        requestId: 'q',
        options: { 'bad key': 'x' },
      }),
    ).toThrow();
    expect(() =>
      request('provider.configure', { providerId: 'codex', defaults: { model: '' } }),
    ).toThrow();
  });

  it('answers an interaction with exactly one choice or answers', () => {
    expect(() =>
      request('interaction.respond', { resourceId: 'r', interactionId: 'i', choiceId: 'allow' }),
    ).not.toThrow();
    expect(() =>
      request('interaction.respond', {
        resourceId: 'r',
        interactionId: 'i',
        answers: { q1: ['A'] },
      }),
    ).not.toThrow();
    expect(() => request('interaction.respond', { resourceId: 'r', interactionId: 'i' })).toThrow();
    expect(() =>
      request('interaction.respond', {
        resourceId: 'r',
        interactionId: 'i',
        choiceId: 'allow',
        answers: { q1: ['A'] },
      }),
    ).toThrow();
  });

  it('carries interactions, reasoning and notices as message blocks', () => {
    const event = {
      protocolVersion: 1,
      cursor: { runtimeId: 'runtime', sequence: 2 },
      resourceId: 'r',
      type: 'message.upserted',
      message: {
        id: 'm',
        role: 'assistant',
        createdAt: '2026-09-27T00:00:00Z',
        blocks: [
          { type: 'reasoning', text: 'thinking' },
          {
            type: 'interaction',
            interaction: {
              id: 'interaction-1',
              kind: 'command',
              title: 'Codex wants to run a command',
              detail: 'ls',
              choices: [{ id: 'accept', label: 'Allow once', tone: 'allow' }],
              status: 'pending',
            },
          },
          {
            type: 'tool',
            id: 'x',
            kind: 'agent',
            title: 'Sub-agent',
            detail: '',
            status: 'running',
          },
          { type: 'notice', tone: 'error', text: 'Codex exited.' },
        ],
      },
    };
    expect(() => validateEvent(event)).not.toThrow();
    const unknownTone = structuredClone(event);
    (
      unknownTone.message.blocks[1] as { interaction: { choices: { tone: string }[] } }
    ).interaction.choices[0]!.tone = 'always';
    expect(() => validateEvent(unknownTone)).toThrow();
  });

  it('keeps real providers out of the browser preview', async () => {
    const preview = new BrowserPreviewTransport();
    await expect(
      preview.request('conversation.create', {
        projectId: 'project-jam',
        presentation: 'claude',
        providerId: 'claude',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('answers the simulated approval through the same request as real ones', async () => {
    const preview = new BrowserPreviewTransport();
    const { resource } = await preview.request('conversation.create', {
      projectId: 'project-jam',
      presentation: 'claude',
    });
    await preview.request('turn.start', {
      resourceId: resource.id,
      text: '/approval',
      context: [],
      requestId: 'approval',
    });
    const conversation = await preview.request('conversation.get', { resourceId: resource.id });
    const block = conversation.messages.at(-1)?.blocks.find((item) => item.type === 'interaction');
    if (block?.type !== 'interaction') throw new Error('no interaction');
    await preview.request('interaction.respond', {
      resourceId: resource.id,
      interactionId: block.interaction.id,
      choiceId: 'allow',
    });
    await expect(
      preview.request('interaction.respond', {
        resourceId: resource.id,
        interactionId: block.interaction.id,
        choiceId: 'allow',
      }),
    ).rejects.toMatchObject({ code: 'stale' });
    const { workspace } = { workspace: await preview.request('workspace.get', {}) };
    expect(workspace.sessions.find((session) => session.resourceId === resource.id)?.status).toBe(
      'idle',
    );
  });
});
