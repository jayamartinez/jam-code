import type { CapabilitySupport, ProviderCapability, ProviderDescriptor } from '@jam/protocol';

/**
 * What the Providers page says about a provider, derived only from the
 * runtime's descriptor. Installation, authentication, enablement and running
 * are independent; anything the runtime does not know is shown as unknown.
 */

export type StatusTone = 'success' | 'warning' | 'accent' | 'muted';

export interface StatusCell {
  label: string;
  detail: string;
  tone: StatusTone;
}

export function installationCell(provider: ProviderDescriptor): StatusCell {
  switch (provider.installation) {
    case 'builtin':
      return { label: 'Built in', detail: 'part of JAM', tone: 'success' };
    case 'installed':
      return {
        label: 'Installed',
        detail:
          provider.executableSource === 'override'
            ? 'at the path set here'
            : 'found on this computer',
        tone: 'success',
      };
    case 'missing':
      return {
        label: provider.executableOverride ? 'Not found' : 'Not installed',
        detail: provider.executableOverride ? 'the path set here is not runnable' : 'CLI not found',
        tone: 'warning',
      };
    default:
      return { label: 'Unknown', detail: 'not checked yet', tone: 'muted' };
  }
}

export function authenticationCell(provider: ProviderDescriptor): StatusCell {
  switch (provider.authentication) {
    case 'not-required':
      return { label: 'Not required', detail: 'no sign-in', tone: 'success' };
    case 'authenticated': {
      // A plan appears only when the provider itself reported one.
      const account = [provider.account?.method, provider.account?.plan]
        .filter(Boolean)
        .join(' · ');
      return { label: 'Signed in', detail: account || 'by its own CLI', tone: 'success' };
    }
    case 'unauthenticated':
      return { label: 'Signed out', detail: 'sign in with its own CLI', tone: 'warning' };
    default:
      return { label: 'Unknown', detail: 'not checked yet', tone: 'muted' };
  }
}

export function enabledCell(provider: ProviderDescriptor): StatusCell {
  if (!provider.enabled) return { label: 'Off', detail: 'hidden from new chats', tone: 'muted' };
  return provider.isDefault
    ? { label: 'Default', detail: 'used for new chats', tone: 'success' }
    : { label: 'Enabled', detail: 'shown in new chats', tone: 'success' };
}

export function runningCell(provider: ProviderDescriptor): StatusCell {
  const count = provider.runningCount ?? (provider.running ? 1 : 0);
  return count > 0
    ? {
        label: `${count} running`,
        detail: count === 1 ? 'a turn is active' : 'turns are active',
        tone: 'accent',
      }
    : { label: 'Idle', detail: 'nothing running', tone: 'muted' };
}

export function statusCells(provider: ProviderDescriptor): StatusCell[] {
  return [
    installationCell(provider),
    authenticationCell(provider),
    enabledCell(provider),
    runningCell(provider),
  ];
}

/** One line under the provider's name, in the list. */
export function providerSummary(provider: ProviderDescriptor): string {
  if (!provider.enabled) return 'Off';
  if (provider.installation === 'missing') return installationCell(provider).label;
  const parts: string[] = [];
  if (provider.installation === 'unknown') parts.push('Not checked');
  else if (provider.authentication === 'authenticated') parts.push('Signed in');
  else if (provider.authentication === 'unauthenticated') parts.push('Signed out');
  else parts.push(installationCell(provider).label);
  if (provider.isDefault) parts.push('Default');
  return parts.join(' · ');
}

export function providerDescription(provider: ProviderDescriptor): string {
  switch (provider.id) {
    case 'mock':
      return 'Built-in demonstration · no external execution';
    case 'claude':
      return 'Anthropic · runs your installed claude CLI in each chat’s project folder';
    case 'codex':
      return 'OpenAI · runs your installed codex app-server in each chat’s project folder';
    default:
      return 'Runs its installed CLI';
  }
}

/** "Checked 3m ago", from the most recent provider check. */
export function checkedLabel(checkedAt: string | undefined, now = Date.now()): string {
  if (!checkedAt) return 'Not checked yet';
  const minutes = Math.floor((now - Date.parse(checkedAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Checked ${hours}h ago` : 'Checked over a day ago';
}

/** The default provider, else the first enabled one, else the first listed. */
export function initialProviderId(providers: ProviderDescriptor[]): string | undefined {
  return (
    providers.find((provider) => provider.isDefault)?.id ??
    providers.find((provider) => provider.enabled)?.id ??
    providers[0]?.id
  );
}

export const CAPABILITY_LABELS: Record<ProviderCapability, string> = {
  create: 'New chats',
  resume: 'Resume',
  fork: 'Fork',
  interrupt: 'Stop',
  streaming: 'Streaming',
  toolApproval: 'Tool approval',
  userInput: 'Questions',
  images: 'Images',
  steering: 'Steering',
  queue: 'Queued messages',
  modelSelection: 'Models',
  effort: 'Effort',
  permissionModes: 'Permission modes',
  usage: 'Usage',
};

export const CAPABILITY_STATUS: Record<CapabilitySupport['status'], string> = {
  supported: 'Supported',
  unsupported: 'Not supported',
  conditional: 'Conditional',
  unknown: 'Unknown',
};

/** Agents JAM plans to support; they are listed, never selectable or toggleable. */
export const COMING_SOON = [
  { id: 'gemini', name: 'Gemini CLI' },
  { id: 'cursor', name: 'Cursor Agent' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'grok', name: 'Grok CLI' },
  { id: 'copilot', name: 'GitHub Copilot CLI' },
] as const;

export type ComingSoonId = (typeof COMING_SOON)[number]['id'];
