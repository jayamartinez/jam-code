import type { NewWorkspace, Presentation, ProviderDescriptor, ProviderId } from '@jam/protocol';

/**
 * A new chat before its first Send. Nothing is created in the runtime until
 * then; the draft only remembers which agent and options it will start with,
 * and where it will work.
 */
export interface ChatDraft {
  projectId: string;
  providerId: ProviderId;
  presentation: Presentation;
  options: Record<string, string>;
  workspace: DraftWorkspace;
}

/**
 * Where a draft will work. No `kind` means the reader asked to choose each
 * time and has not yet. `branch` is the checkout's branch to switch to on
 * Send, or a new worktree's base; absent keeps the current branch.
 */
export interface DraftWorkspace {
  kind?: 'checkout' | 'worktree';
  branch?: string;
}

/**
 * What the first Send asks the runtime for. A branch choice that matches the
 * current branch asks for nothing, so Send never switches needlessly.
 */
export function workspaceRequest(
  workspace: DraftWorkspace,
  text: string,
  current?: string,
): NewWorkspace | undefined {
  const branch = workspace.branch && workspace.branch !== current ? workspace.branch : undefined;
  if (workspace.kind === 'worktree')
    return {
      kind: 'worktree',
      nameHint: text,
      ...(workspace.branch ? { baseBranch: workspace.branch } : {}),
    };
  return branch ? { kind: 'checkout', branch } : undefined;
}

/**
 * The same draft in another project. Text, context, agent and options stay;
 * branches belong to one repository, so the new project starts from its own
 * current branch in the same kind of workspace.
 */
export function inProject(draft: ChatDraft, projectId: string): ChatDraft {
  if (draft.projectId === projectId) return draft;
  return {
    ...draft,
    projectId,
    workspace: draft.workspace.kind ? { kind: draft.workspace.kind } : {},
  };
}

/** Why a draft cannot be sent yet because of where it would work, or null. */
export function workspaceProblem(workspace: DraftWorkspace): string | null {
  return workspace.kind ? null : 'Choose Current checkout or New worktree before sending.';
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
