import type { Presentation, ProviderDescriptor, ProviderId } from '@jam/protocol';

/**
 * A new chat before its first Send. Nothing is created in the runtime until
 * then; the draft only remembers which agent and options it will start with.
 */
export interface ChatDraft {
  projectId: string;
  providerId: ProviderId;
  presentation: Presentation;
  options: Record<string, string>;
}

/** A demo provider draft keeps the presentation it was opened with. */
export function presentationFor(providerId: ProviderId, fallback: Presentation): Presentation {
  return providerId === 'claude' || providerId === 'codex' ? providerId : fallback;
}

/**
 * Which provider a new chat starts with: the one asked for when it is
 * enabled, else the runtime's default, else the first enabled provider.
 */
export function draftProvider(
  providers: readonly ProviderDescriptor[],
  requested?: ProviderId,
): ProviderId {
  const enabled = providers.filter((provider) => provider.enabled);
  return (
    enabled.find((provider) => provider.id === requested)?.id ??
    enabled.find((provider) => provider.isDefault)?.id ??
    enabled[0]?.id ??
    requested ??
    'claude'
  );
}

/**
 * The same draft in another project: text, context, agent and options stay.
 */
export function inProject(draft: ChatDraft, projectId: string): ChatDraft {
  return draft.projectId === projectId ? draft : { ...draft, projectId };
}

/** Why a provider cannot start a chat right now, or null when it can. */
export function unavailableReason(provider: ProviderDescriptor | undefined): string | null {
  if (!provider) return 'This provider is not available.';
  if (!provider.enabled) return `${provider.name} is turned off in Settings → Providers.`;
  if (provider.installation === 'missing')
    return `${provider.name} is not installed on this computer.`;
  if (provider.authentication === 'unauthenticated')
    return `${provider.name} is signed out. Sign in with its own CLI, then check again in Settings.`;
  return null;
}
