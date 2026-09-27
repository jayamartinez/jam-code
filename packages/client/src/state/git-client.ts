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
  get(projectId: string) {
    return this.states.get(projectId) ?? EMPTY;
  }
  private set(projectId: string, state: GitProjection) {
    this.states.set(projectId, state);
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
  invalidate(projectId: string) {
    this.generations.set(projectId, (this.generations.get(projectId) ?? 0) + 1);
    this.pending.delete(projectId);
    this.set(projectId, { loading: false, revision: this.get(projectId).revision + 1 });
  }
  refresh(projectId: string): Promise<void> {
    const pending = this.pending.get(projectId);
    if (pending) return pending;
    const generation = this.generations.get(projectId);
    this.set(projectId, { ...this.get(projectId), loading: true });
    const request = this.transport
      .request('git.status', { projectId })
      .then(
        (status) =>
          generation === this.generations.get(projectId) &&
          this.set(projectId, {
            status,
            loading: false,
            revision: this.get(projectId).revision + 1,
          }),
        (error: unknown) =>
          generation === this.generations.get(projectId) &&
          this.set(projectId, {
            loading: false,
            revision: this.get(projectId).revision + 1,
            error: error instanceof Error ? error.message : 'Git is unavailable.',
          }),
      )
      .then(() => undefined)
      .finally(() => {
        if (this.pending.get(projectId) === request) this.pending.delete(projectId);
      });
    this.pending.set(projectId, request);
    return request;
  }
  async setStaged(projectId: string, path: string, staged: boolean) {
    await this.pending.get(projectId);
    const generation = this.generations.get(projectId);
    const operation = this.transport
      .request('git.setStaged', { projectId, path, staged })
      .then((status) => {
        if (generation === this.generations.get(projectId))
          this.set(projectId, {
            status,
            loading: false,
            revision: this.get(projectId).revision + 1,
          });
      });
    const pending = operation.catch(() => undefined);
    this.pending.set(projectId, pending);
    try {
      await operation;
    } catch (error) {
      if (this.pending.get(projectId) === pending) this.pending.delete(projectId);
      await this.refresh(projectId);
      throw error;
    } finally {
      if (this.pending.get(projectId) === pending) this.pending.delete(projectId);
    }
  }
}
