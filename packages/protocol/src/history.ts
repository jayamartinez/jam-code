import type { ProviderId } from './types';

/**
 * Who created a provider's conversation: JAM Code (`jam`), or anything else,
 * such as the provider's own CLI or app (`external`). It never changes.
 */
export type HistoryOrigin = 'jam' | 'external';

/**
 * One conversation in a provider's own history, as JAM indexed it. The
 * provider's record stays canonical; this entry is JAM's index of it, and
 * `resourceId` its local, searchable projection once synced. The provider's
 * own conversation ID never reaches the client: the entry is addressed by
 * JAM's `id`.
 */
export interface HistoryEntry {
  id: string;
  providerId: ProviderId;
  origin: HistoryOrigin;
  title?: string;
  preview?: string;
  /** As the provider reported them. */
  createdAt?: string;
  updatedAt?: string;
  discoveredAt: string;
  /** The last complete sync. A projection without one is partly synced. */
  syncedAt?: string;
  /** The JAM conversation projecting it, once synced. */
  resourceId?: string;
  /** The trusted project it belongs to. Absent means unlinked. */
  projectId?: string;
  worktreeId?: string;
  /** The folder the provider reported, for display only. It grants no access. */
  sourcePath?: string;
  /** A complete scan no longer listed it. */
  missingSince?: string;
  /** Removed from JAM Code; scans keep it hidden until it is restored. */
  ignoredAt?: string;
  /** The provider's conversation changed since its last sync. */
  changed?: boolean;
  resumable: boolean;
}
