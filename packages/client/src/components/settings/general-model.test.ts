import type { ProviderDescriptor } from '@jam/protocol';
import { describe, expect, it } from 'vitest';
import { defaultProvider } from './general-model';

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
