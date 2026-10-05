import type { ProviderId, Resource, Session } from './types';

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
  /** The Git branch it last worked on, as the provider reported it. */
  branch?: string;
  /**
   * That branch's work is finished: merged into the default branch, or
   * deleted. Only `providerHistory.findInFolders` says; absent is unknown.
   */
  merged?: boolean;
  /** A complete scan no longer listed it. */
  missingSince?: string;
  /** Removed from JAM Code; scans keep it hidden until it is restored. */
  ignoredAt?: string;
  /** The provider's conversation changed since its last sync. */
  changed?: boolean;
  resumable: boolean;
}

export interface HistoryScanSummary {
  providerId: ProviderId;
  discovered: number;
  updated: number;
  unchanged: number;
  /** Items without a usable ID. */
  rejected: number;
  /** Entries a complete scan did not list; zero when incomplete. */
  missing: number;
  complete: boolean;
}

export const HISTORY_LIST_LIMIT = 200;
/** The most entries one `providerHistory.findInFolders` returns. */
export const HISTORY_FOUND_LIMIT = 500;

export interface ProviderHistoryRequestMap {
  /**
   * Lists the provider's own history into JAM's index: metadata only, no
   * transcripts and no conversations. `unsupported` for a provider whose
   * history JAM cannot read; `conflict` while a scan of it runs.
   */
  'providerHistory.scan': { params: { providerId: ProviderId }; result: HistoryScanSummary };
  /**
   * The provider conversations that worked in exactly one of these folders
   * and are not in JAM Code yet, newest first (at most
   * `HISTORY_FOUND_LIMIT`; `total` counts them all): what the New project
   * dialog offers to add. Each provider that can report its history is asked
   * for those folders and indexed; one that cannot answer is left out. Asked
   * once the project exists, the entries come back linked to it, ready to
   * sync. Nothing is read beyond listing metadata.
   */
  'providerHistory.findInFolders': {
    params: { paths: string[] };
    result: { entries: HistoryEntry[]; total: number };
  };
  /**
   * A page of the index, newest first. `ignored` lists tombstones instead.
   * `cursor` continues from the previous page's.
   */
  'providerHistory.list': {
    params: { providerId?: ProviderId; ignored?: boolean; cursor?: string; limit?: number };
    result: { entries: HistoryEntry[]; cursor?: string };
  };
  /**
   * Reads one conversation into its JAM projection, creating it the first
   * time. An unlinked entry is refused (`project_folder_required`) until it
   * has a project; an ignored one (`conflict`) until it is restored.
   * `archive` makes a projection this sync creates start archived.
   */
  'providerHistory.sync': {
    params: { historyId: string; archive?: boolean };
    result: { entry: HistoryEntry; resource: Resource; session: Session };
  };
  /** Links an entry that is not synced yet to a project JAM already has. */
  'providerHistory.associate': {
    params: { historyId: string; projectId: string };
    result: { entry: HistoryEntry };
  };
  /**
   * Hides an entry from JAM Code (a tombstone) until it is restored. One
   * linked to a conversation is removed by deleting that conversation. The
   * provider's history is kept.
   */
  'providerHistory.ignore': { params: { historyId: string }; result: { entry: HistoryEntry } };
  /** Lists an ignored entry again, so it can be synced. */
  'providerHistory.restore': { params: { historyId: string }; result: { entry: HistoryEntry } };
}
