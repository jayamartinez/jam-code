import type { ProviderDescriptor } from '@jam/protocol';
import { describe, expect, it } from 'vitest';
import { agentStep, isAgentReady } from './agent-setup-model';

const agent = (overrides: Partial<ProviderDescriptor>) =>
  ({
    id: 'claude',
    name: 'Claude Code',
    installation: 'installed',
    authentication: 'authenticated',
    enabled: true,
    isDefault: true,
    running: false,
    capabilities: {},
    ...overrides,
  }) as ProviderDescriptor;

describe('agent setup', () => {
  it('shows the official installer for the platform', () => {
    expect(agentStep(agent({ installation: 'missing' }), 'windows').command).toBe(
      'irm https://claude.ai/install.ps1 | iex',
    );
    expect(agentStep(agent({ id: 'codex', installation: 'missing' }), 'macos').command).toBe(
      'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    );
  });

  it('signs in with the CLI itself', () => {
    const step = agentStep(
      agent({ id: 'codex', authentication: 'unauthenticated', version: '0.159.0' }),
      'windows',
    );
    expect(step).toMatchObject({
      kind: 'sign-in',
      command: 'codex',
      state: '0.159.0 · Signed out',
    });
  });

  it('is ready only when on, installed and not signed out', () => {
    expect(isAgentReady(agent({}))).toBe(true);
    expect(isAgentReady(agent({ authentication: 'unknown' }))).toBe(true);
    expect(isAgentReady(agent({ enabled: false }))).toBe(false);
    expect(isAgentReady(agent({ installation: 'missing' }))).toBe(false);
    expect(isAgentReady(agent({ id: 'mock' }))).toBe(false);
  });
});
