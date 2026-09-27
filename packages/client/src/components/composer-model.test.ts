import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@jam/protocol';
import { composerChoices, contextShare, policyLabel } from './composer-model';
import { draftProvider, unavailableReason } from '../state/chat-draft';

const descriptor = (overrides: Partial<ProviderDescriptor> = {}): ProviderDescriptor => ({
  id: 'codex',
  name: 'Codex',
  installation: 'installed',
  authentication: 'authenticated',
  enabled: true,
  isDefault: false,
  running: false,
  capabilities: {} as ProviderDescriptor['capabilities'],
  models: [
    { id: 'a', label: 'Model A', isDefault: true, efforts: ['low', 'high'] },
    { id: 'b', label: 'Model B', efforts: [] },
  ],
  options: [
    {
      id: 'sandbox',
      label: 'Sandbox',
      default: 'workspace-write',
      values: [
        { value: 'read-only', label: 'Read only' },
        { value: 'workspace-write', label: 'Workspace write' },
      ],
    },
  ],
  ...overrides,
});

describe('composer choices', () => {
  it('come only from what the provider reported', () => {
    const choices = composerChoices(descriptor(), {});
    expect(choices.model).toBe('a');
    expect(choices.efforts.map((e) => e.value)).toEqual(['', 'low', 'high']);
    expect(choices.options[0]?.value).toBe('workspace-write');
    expect(policyLabel(choices)).toBe('Workspace write');
  });

  it('offer no effort for a model that reports none, and drop a stale effort', () => {
    const choices = composerChoices(descriptor(), { model: 'b', effort: 'high' });
    expect(choices.efforts).toEqual([]);
    expect(choices.effort).toBe('');
  });

  it('offer nothing when the provider listed nothing', () => {
    const choices = composerChoices(descriptor({ models: undefined, options: undefined }), {});
    expect(choices.models).toEqual([]);
    expect(choices.options).toEqual([]);
  });

  it('show context share only when both numbers are reported', () => {
    expect(contextShare({ contextTokens: 50_000, contextWindow: 200_000 })?.label).toBe(
      '25% context',
    );
    expect(contextShare({ contextTokens: 50_000 })).toBeNull();
  });
});

describe('new chat provider', () => {
  const claude = descriptor({ id: 'claude', name: 'Claude Code', isDefault: true });
  const codex = descriptor();

  it('starts with the requested enabled provider, else the default', () => {
    expect(draftProvider([claude, codex], 'codex')).toBe('codex');
    expect(draftProvider([claude, { ...codex, enabled: false }], 'codex')).toBe('claude');
    expect(draftProvider([claude, codex])).toBe('claude');
  });

  it('explains why a provider cannot start a chat', () => {
    expect(unavailableReason(codex)).toBeNull();
    expect(unavailableReason({ ...codex, installation: 'missing' })).toMatch(/not installed/);
    expect(unavailableReason({ ...codex, authentication: 'unauthenticated' })).toMatch(
      /signed out/,
    );
    expect(unavailableReason({ ...codex, enabled: false })).toMatch(/turned off/);
  });
});
