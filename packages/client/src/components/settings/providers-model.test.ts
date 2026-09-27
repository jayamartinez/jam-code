import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@jam/protocol';
import {
  authenticationCell,
  checkedLabel,
  initialProviderId,
  providerSummary,
  runningCell,
  statusCells,
} from './providers-model';

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
    expect(enabled?.label).toBe('Off');
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
      runningCount: 1,
    });
    expect(statusCells(mock).map((cell) => cell.label)).toEqual([
      'Built in',
      'Not required',
      'Default',
      '1 running',
    ]);
    expect(providerSummary(mock)).toBe('Built in · Default');
  });

  it('keeps installed, signed in, enabled and running independent', () => {
    const claude = provider({
      installation: 'installed',
      authentication: 'unauthenticated',
      enabled: true,
      runningCount: 2,
    });
    expect(statusCells(claude).map((cell) => cell.label)).toEqual([
      'Installed',
      'Signed out',
      'Enabled',
      '2 running',
    ]);
    expect(providerSummary(claude)).toBe('Signed out');
  });

  it('shows a plan only when the provider reported one', () => {
    expect(authenticationCell(provider({ authentication: 'authenticated' })).detail).toBe(
      'by its own CLI',
    );
    expect(
      authenticationCell(
        provider({ authentication: 'authenticated', account: { method: 'ChatGPT', plan: 'pro' } }),
      ).detail,
    ).toBe('ChatGPT · pro');
  });

  it('never calls a disabled provider connected', () => {
    expect(providerSummary(provider({ installation: 'installed' }))).toBe('Off');
    expect(runningCell(provider({})).label).toBe('Idle');
  });

  it('says when providers were last checked', () => {
    const now = Date.parse('2026-09-27T12:00:00Z');
    expect(checkedLabel(undefined, now)).toBe('Not checked yet');
    expect(checkedLabel('2026-09-27T11:59:30Z', now)).toBe('Checked just now');
    expect(checkedLabel('2026-09-27T11:55:00Z', now)).toBe('Checked 5m ago');
  });

  it('selects the default provider first', () => {
    const list = [provider({ id: 'claude' }), provider({ id: 'mock', isDefault: true })];
    expect(initialProviderId(list)).toBe('mock');
    expect(initialProviderId([provider({ id: 'codex' })])).toBe('codex');
    expect(initialProviderId([])).toBeUndefined();
  });
});
