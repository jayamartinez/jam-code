import type { Project, Resource, Session } from '@jam/protocol';

/**
 * A project's threads are its conversations. Open and archived are the
 * reader's decision: JAM may suggest archiving an idle thread, but only an
 * explicit choice archives one. An archived thread keeps its transcript,
 * session and pin; it only leaves the lists of current work until it is
 * reopened or sent into. The runtime records it as `closedAt`.
 */

const DAY = 86_400_000;

export interface ProjectThreads {
  open: Resource[];
  archived: Resource[];
}

const newestFirst = (left: string, right: string) => Date.parse(right) - Date.parse(left);

export const isArchived = (resource: Resource) => !!resource.closedAt;

export function threadsOf(resources: Resource[], projectId: string): ProjectThreads {
  const threads = resources.filter(
    (resource) => resource.kind === 'conversation' && resource.projectId === projectId,
  );
  return {
    open: threads
      .filter((thread) => !isArchived(thread))
      .sort((left, right) => newestFirst(left.updatedAt, right.updatedAt)),
    archived: threads
      .filter(isArchived)
      .sort((left, right) => newestFirst(left.closedAt!, right.closedAt!)),
  };
}

/** Conversations that are current work: everything not archived. */
export function currentChats(resources: Resource[]): Resource[] {
  return resources.filter((resource) => resource.kind === 'conversation' && !isArchived(resource));
}

/** The Pinned section. An archived chat keeps its pin for when it is reopened. */
export function pinnedChats(resources: Resource[]): Resource[] {
  return currentChats(resources).filter((resource) => resource.pinned);
}

/** History's Recent list: current, unpinned chats, newest first, within the filters. */
export function recentChats(
  resources: Resource[],
  sessions: Session[],
  filter: { projectId?: string; providerId?: string } = {},
): Resource[] {
  return currentChats(resources)
    .filter(
      (resource) =>
        !resource.pinned &&
        (!filter.projectId || resource.projectId === filter.projectId) &&
        (!filter.providerId ||
          sessions.find((session) => session.id === resource.sessionId)?.providerId ===
            filter.providerId),
    )
    .sort((left, right) => newestFirst(left.updatedAt, right.updatedAt));
}

/**
 * Why a chat cannot be archived or deleted right now, or null when it can.
 * Neither stops an agent, so a chat that is working or waiting for an answer
 * is settled first rather than put away, or removed, mid-turn.
 */
function settleFirst(session: Session | undefined, doing: string): string | null {
  if (session?.needsInput) return `Answer the agent’s request before ${doing} this chat.`;
  if (session?.status === 'running')
    return `Stop the agent or let it finish before ${doing} this chat.`;
  return null;
}
export const archiveBlocked = (session: Session | undefined) => settleFirst(session, 'archiving');
export const deleteBlocked = (session: Session | undefined) => settleFirst(session, 'deleting');

/** Pinned projects first; otherwise the runtime's order is kept. */
export function orderProjects(projects: Project[]): Project[] {
  return [...projects.filter((project) => project.pinned), ...projects.filter((p) => !p.pinned)];
}

/**
 * Whether to ask about archiving a thread. It must be open, not working or
 * waiting, and untouched for the threshold — counted from its last activity
 * or from the last time the reader said to keep it open, whichever is later,
 * so "Keep open" snoozes the question for another full period.
 */
export function suggestsArchiving(
  thread: Resource,
  session: Session | undefined,
  now: number,
  thresholdDays: number | null,
): boolean {
  if (thresholdDays === null || isArchived(thread) || archiveBlocked(session)) return false;
  const last = Math.max(
    Date.parse(thread.updatedAt),
    thread.closeSuggestionDismissedAt ? Date.parse(thread.closeSuggestionDismissedAt) : 0,
  );
  return Number.isFinite(last) && now - last >= thresholdDays * DAY;
}

/** Whole days since a timestamp, for the suggestion's wording. */
export function daysSince(timestamp: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / DAY));
}

/** Compact age for a dense row: 5m, 2h, 3d, 6w, then months. */
export function compactAge(timestamp: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
