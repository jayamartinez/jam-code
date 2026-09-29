import type { ProviderDescriptor } from '@jam/protocol';

/** An agent a new chat can use now: turned on, installed and not signed out. */
export function isAgentReady(provider: ProviderDescriptor) {
  return (
    provider.id !== 'mock' &&
    provider.enabled &&
    provider.installation === 'installed' &&
    provider.authentication !== 'unauthenticated'
  );
}

/**
 * The official installers, as each provider documents them (checked
 * 2026-09-29: code.claude.com/docs/en/setup, github.com/openai/codex).
 * Windows commands are for PowerShell, which JAM's terminal runs there.
 */
const INSTALL: Record<'claude' | 'codex', { windows: string; macos: string }> = {
  claude: {
    windows: 'irm https://claude.ai/install.ps1 | iex',
    macos: 'curl -fsSL https://claude.ai/install.sh | bash',
  },
  codex: {
    windows:
      'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
    macos: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
  },
};

/** Signing in is the CLI's own: run it and follow its prompts. */
const SIGN_IN: Record<'claude' | 'codex', { command: string; note: string }> = {
  claude: {
    command: 'claude',
    note: 'Run claude and follow its sign-in in your browser. JAM never sees your credentials.',
  },
  codex: {
    command: 'codex',
    note: 'Run codex and choose Sign in with ChatGPT. JAM never sees your credentials.',
  },
};

export interface AgentStep {
  kind: 'install' | 'sign-in' | 'off' | 'checking' | 'ready';
  /** The status beside the agent's name. */
  state: string;
  command?: string;
  note?: string;
}

/** The one next step for an agent, for the platform JAM is running on. */
export function agentStep(
  provider: ProviderDescriptor,
  platform: 'macos' | 'windows' | 'web',
): AgentStep {
  const id = provider.id === 'codex' ? 'codex' : 'claude';
  const version = provider.version ? `${provider.version} · ` : '';
  if (provider.installation === 'unknown') return { kind: 'checking', state: 'Checking…' };
  if (provider.installation === 'missing') {
    const command = INSTALL[id][platform === 'macos' ? 'macos' : 'windows'];
    return {
      kind: 'install',
      state: provider.executableOverride ? 'Not found at the path set' : 'Not installed',
      command,
      note:
        platform === 'macos'
          ? `Official installer for macOS. Then run ${SIGN_IN[id].command} to sign in.`
          : `Official installer, in PowerShell. Then run ${SIGN_IN[id].command} to sign in.`,
    };
  }
  if (provider.authentication === 'unauthenticated')
    return {
      kind: 'sign-in',
      state: `${version}Signed out`,
      command: SIGN_IN[id].command,
      note: SIGN_IN[id].note,
    };
  if (!provider.enabled) return { kind: 'off', state: `${version}Off` };
  return { kind: 'ready', state: `${version}Ready` };
}
