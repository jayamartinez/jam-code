import type { ProviderDescriptor } from '@jam/protocol';
import { describe, expect, it } from 'vitest';
import { defaultProvider, sharedDefault, sharedEfforts, withSharedDefault } from './general-model';

const provider = (overrides: Partial<ProviderDescriptor>): ProviderDescriptor =>
  ({
    id: 'mock',
    name: 'Mock',
    installation: 'builtin',
    authentication: 'not-required',
    enabled: true,
    isDefault: false,
    running: false,
    capabilities: {},
    ...overrides,
  }) as ProviderDescriptor;

describe('defaultProvider', () => {
  it('is the enabled provider the runtime marks default', () => {
    const chosen = provider({ id: 'mock', isDefault: true });
    expect(defaultProvider([provider({ id: 'claude', enabled: false }), chosen])).toBe(chosen);
  });

  it('is absent when the default is not enabled', () => {
    expect(defaultProvider([provider({ isDefault: true, enabled: false })])).toBeUndefined();
  });
});

describe('shared defaults', () => {
  const access = {
    id: 'access',
    label: 'Access',
    default: 'ask',
    values: ['ask', 'edits', 'full'].map((value) => ({ value, label: value })),
  };
  const claude = provider({
    id: 'claude',
    options: [access],
    models: [
      { id: 'opus', label: 'Opus', isDefault: true, efforts: ['low', 'medium', 'high', 'max'] },
    ],
  } as Partial<ProviderDescriptor>);
  const codex = provider({
    id: 'codex',
    options: [access],
    defaults: { model: 'gpt', access: 'full' },
    models: [
      { id: 'gpt', label: 'GPT', isDefault: true, efforts: ['low', 'medium', 'high', 'xhigh'] },
    ],
  } as Partial<ProviderDescriptor>);
  const demo = provider({ id: 'mock' });

  it('offers every level any agent has, in order', () => {
    expect(sharedEfforts([codex, claude, demo])).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('shows one value only when the agents agree', () => {
    expect(sharedDefault([claude, codex], 'access')).toBeNull();
    expect(sharedDefault([codex], 'access')).toBe('full');
    expect(sharedDefault([claude, demo], 'effort')).toBe('');
  });

  it('applies to every real agent, and never the demo', () => {
    expect(withSharedDefault([claude, codex, demo], 'access', 'edits')).toEqual([
      { providerId: 'claude', defaults: { access: 'edits' } },
      { providerId: 'codex', defaults: { model: 'gpt', access: 'edits' } },
    ]);
    // Asking is the starting point, so it clears the saved value.
    expect(withSharedDefault([claude, codex], 'access', 'ask')).toEqual([
      { providerId: 'codex', defaults: { model: 'gpt' } },
    ]);
  });

  it('leaves an agent on its own effort when its model lacks the level', () => {
    expect(withSharedDefault([claude, codex], 'effort', 'max')).toEqual([
      { providerId: 'claude', defaults: { effort: 'max' } },
    ]);
    expect(withSharedDefault([claude, codex], 'effort', 'high')).toEqual([
      { providerId: 'claude', defaults: { effort: 'high' } },
      { providerId: 'codex', defaults: { model: 'gpt', access: 'full', effort: 'high' } },
    ]);
  });
});
