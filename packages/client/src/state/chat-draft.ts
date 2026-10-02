import type {
  MoveWorkspace,
  NewWorkspace,
  Presentation,
  ProviderDescriptor,
  ProviderId,
  WorkspaceSnapshot,
} from '@jam/protocol';

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
 * time and has not yet. `worktree` is a new worktree; `existing` is one that
 * is already there, the one that has `branch` checked out. `branch` is
 * otherwise the checkout's branch to switch to on Send, or a new worktree's
 * base; absent keeps the current branch.
 *
 * A started chat stages the same shape for its next Send, and there an empty
 * one means "stay where it is": `{ branch }` works on that branch wherever it
 * is, `{ kind: 'checkout' }` returns to the project's checkout, and
 * `{ kind: 'worktree' }` makes a new worktree.
 */
export interface DraftWorkspace {
  kind?: 'checkout' | 'worktree' | 'existing';
  branch?: string;
}

/** Where a started chat works: the project's checkout, or a worktree. */
export type ChatHome = 'checkout' | 'existing';

/** What a started chat's next Send asks the runtime for, or nothing. */
export function moveRequest(staged: DraftWorkspace, text: string): MoveWorkspace | undefined {
  if (staged.kind === 'worktree')
    return {
      kind: 'worktree',
      nameHint: text,
      ...(staged.branch ? { baseBranch: staged.branch } : {}),
    };
  if (staged.branch) return { kind: 'branch', branch: staged.branch };
  return staged.kind === 'checkout' ? { kind: 'checkout' } : undefined;
}

/** Whether a chat is running in a project's own checkout rather than a worktree. */
export function checkoutBusy(
  workspace: Pick<WorkspaceSnapshot, 'resources' | 'sessions'> | null | undefined,
  projectId: string,
): boolean {
  return !!workspace?.sessions.some(
    (session) =>
      session.status === 'running' &&
      workspace.resources.some(
        (resource) =>
          resource.id === session.resourceId &&
          resource.projectId === projectId &&
          !resource.worktreeId,
      ),
  );
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
  if (workspace.kind === 'existing' && workspace.branch)
    return { kind: 'existing', branch: workspace.branch };
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
    // A worktree belongs to one repository too.
    workspace: draft.workspace.kind
      ? { kind: draft.workspace.kind === 'existing' ? 'checkout' : draft.workspace.kind }
      : {},
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
