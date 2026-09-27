import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@jam/protocol';
import { initialProviderId, providerSummary, statusCells } from './providers-model';

const provider = (overrides: Partial<ProviderDescriptor>): ProviderDescriptor => ({
  id: 'claude',
  name: 'Claude Code',
  installation: 'unknown',
  authentication: 'unknown',
  enabled: false,
  isDefault: false,
  running: false,
  capabilities: {} as ProviderDescriptor['capabilities'],
  ...overrides,
});

describe('provider status', () => {
  it('keeps unknown installation and authentication unknown', () => {
    const [installation, authentication, enabled, running] = statusCells(provider({}));
    expect(installation?.label).toBe('Unknown');
    expect(authentication?.label).toBe('Unknown');
    expect(enabled?.label).toBe('Unavailable');
    expect(running?.label).toBe('Idle');
  });

  it('reports the built-in default as it is', () => {
    const mock = provider({
      id: 'mock',
      installation: 'builtin',
      authentication: 'not-required',
      enabled: true,
      isDefault: true,
      running: true,
    });
    expect(statusCells(mock).map((cell) => cell.label)).toEqual([
      'Built in',
      'Not required',
      'Default',
      'Running',
    ]);
    expect(providerSummary(mock)).toBe('Built in · Default');
  });

  it('never calls a disabled provider connected', () => {
    expect(providerSummary(provider({ installation: 'installed' }))).toBe('Not connected yet');
  });

  it('selects the default provider first', () => {
    const list = [provider({ id: 'claude' }), provider({ id: 'mock', isDefault: true })];
    expect(initialProviderId(list)).toBe('mock');
    expect(initialProviderId([provider({ id: 'codex' })])).toBe('codex');
    expect(initialProviderId([])).toBeUndefined();
  });
});
