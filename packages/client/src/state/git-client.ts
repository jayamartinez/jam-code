import type { GitDiffSide, GitStatus, JamTransport } from '@jam/protocol';

export interface GitProjection {
  status?: GitStatus;
  error?: string;
  loading: boolean;
  revision: number;
}
const EMPTY: GitProjection = { loading: false, revision: 0 };
/** Disposable projection shared by branch indicators and Review panes. No timers. */
export class GitClient {
  private selections = new Map<string, { path: string; side: GitDiffSide }>();
  selection(resourceId: string) {
    return this.selections.get(resourceId);
  }
  select(resourceId: string, path: string, side: GitDiffSide) {
    this.selections.set(resourceId, { path, side });
  }
  private states = new Map<string, GitProjection>();
  private pending = new Map<string, Promise<void>>();
  private generations = new Map<string, number>();
  private listeners = new Set<() => void>();
  private revision = 0;
  constructor(readonly transport: JamTransport) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.revision;
  /**
   * One projection per checkout: the project's folder, or one of its JAM
   * worktrees. Review in a worktree chat never shares the checkout's state.
   */
  get(projectId: string, worktreeId?: string) {
    return this.states.get(key(projectId, worktreeId)) ?? EMPTY;
  }
  private set(target: string, state: GitProjection) {
    this.states.set(target, state);
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
  invalidate(projectId: string) {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1);
    this.pending.delete(projectId);
    this.set(projectId, { loading: false, revision: this.get(projectId).revision + 1 });
  }
  refresh(projectId: string, worktreeId?: string): Promise<void> {
    const target = key(projectId, worktreeId);
    const pending = this.pending.get(target);
    if (pending) return pending;
    const generation = this.generations.get(target);
    this.set(target, {
      ...this.states.get(target),
      loading: true,
      revision: this.revisionOf(target),
    });
    const request = this.transport
      .request('git.status', { projectId, ...(worktreeId ? { worktreeId } : {}) })
      .then(
        (status) =>
          generation === this.generations.get(target) &&
          this.set(target, {
            status,
            loading: false,
            revision: this.revisionOf(target) + 1,
          }),
        (error: unknown) =>
          generation === this.generations.get(target) &&
          this.set(target, {
            loading: false,
            revision: this.revisionOf(target) + 1,
            error: error instanceof Error ? error.message : 'Git is unavailable.',
          }),
      )
      .then(() => undefined)
      .finally(() => {
        if (this.pending.get(target) === request) this.pending.delete(target);
      });
    this.pending.set(target, request);
    return request;
  }
  async setStaged(projectId: string, path: string, staged: boolean, worktreeId?: string) {
    const target = key(projectId, worktreeId);
    await this.pending.get(target);
    const generation = this.generations.get(target);
    const operation = this.transport
      .request('git.setStaged', {
        projectId,
        path,
        staged,
        ...(worktreeId ? { worktreeId } : {}),
      })
      .then((status) => {
        if (generation === this.generations.get(target))
          this.set(target, {
            status,
            loading: false,
            revision: this.revisionOf(target) + 1,
          });
      });
    const pending = operation.catch(() => undefined);
    this.pending.set(target, pending);
    try {
      await operation;
    } catch (error) {
      if (this.pending.get(target) === pending) this.pending.delete(target);
      await this.refresh(projectId, worktreeId);
      throw error;
    } finally {
      if (this.pending.get(target) === pending) this.pending.delete(target);
    }
  }
  private revisionOf(target: string) {
    return this.states.get(target)?.revision ?? 0;
  }
}

/** Projects and worktrees have separate IDs; NUL never appears in either. */
function key(projectId: string, worktreeId?: string) {
  return worktreeId ? `${projectId}\u0000${worktreeId}` : projectId;
}
