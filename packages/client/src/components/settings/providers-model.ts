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
      return { label: 'Installed', detail: 'found on this computer', tone: 'success' };
    case 'missing':
      return { label: 'Not installed', detail: 'CLI not found', tone: 'warning' };
    default:
      return { label: 'Unknown', detail: 'not checked', tone: 'muted' };
  }
}

export function authenticationCell(provider: ProviderDescriptor): StatusCell {
  switch (provider.authentication) {
    case 'not-required':
      return { label: 'Not required', detail: 'no sign-in', tone: 'success' };
    case 'authenticated':
      return { label: 'Signed in', detail: 'by its own CLI', tone: 'success' };
    case 'unauthenticated':
      return { label: 'Signed out', detail: 'sign in with its CLI', tone: 'warning' };
    default:
      return { label: 'Unknown', detail: 'not checked', tone: 'muted' };
  }
}

export function enabledCell(provider: ProviderDescriptor): StatusCell {
  if (!provider.enabled)
    return { label: 'Unavailable', detail: 'not connected yet', tone: 'muted' };
  return provider.isDefault
    ? { label: 'Default', detail: 'used for new chats', tone: 'success' }
    : { label: 'Enabled', detail: 'can start chats', tone: 'success' };
}

export function runningCell(provider: ProviderDescriptor): StatusCell {
  return provider.running
    ? { label: 'Running', detail: 'a session is active', tone: 'accent' }
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

/** One line under the provider's name, in the list and the detail header. */
export function providerSummary(provider: ProviderDescriptor): string {
  if (!provider.enabled) return 'Not connected yet';
  const parts = [installationCell(provider).label];
  if (provider.isDefault) parts.push('Default');
  return parts.join(' · ');
}

export function providerDescription(provider: ProviderDescriptor): string {
  switch (provider.id) {
    case 'mock':
      return 'Built-in demonstration · no external execution';
    case 'claude':
      return 'Anthropic · live integration is not implemented yet';
    case 'codex':
      return 'OpenAI · live integration is not implemented yet';
    default:
      return 'Live integration is not implemented yet';
  }
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
