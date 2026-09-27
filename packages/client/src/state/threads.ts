import type { Project, Resource, Session } from '@jam/protocol';

/**
 * A project's threads are its conversations. Open and closed are the reader's
 * decision: JAM may suggest closing an idle thread, but only an explicit
 * choice closes one.
 */

const DAY = 86_400_000;

export interface ProjectThreads {
  open: Resource[];
  closed: Resource[];
}

const newestFirst = (left: string, right: string) => Date.parse(right) - Date.parse(left);

export function threadsOf(resources: Resource[], projectId: string): ProjectThreads {
  const threads = resources.filter(
    (resource) => resource.kind === 'conversation' && resource.projectId === projectId,
  );
  return {
    open: threads
      .filter((thread) => !thread.closedAt)
      .sort((left, right) => newestFirst(left.updatedAt, right.updatedAt)),
    closed: threads
      .filter((thread) => thread.closedAt)
      .sort((left, right) => newestFirst(left.closedAt!, right.closedAt!)),
  };
}

/** Pinned projects first; otherwise the runtime's order is kept. */
export function orderProjects(projects: Project[]): Project[] {
  return [...projects.filter((project) => project.pinned), ...projects.filter((p) => !p.pinned)];
}

/**
 * Whether to ask about closing a thread. It must be open, not working, and
 * untouched for the threshold — counted from its last activity or from the
 * last time the reader said to keep it open, whichever is later, so "Keep
 * open" snoozes the question for another full period.
 */
export function suggestsClosing(
  thread: Resource,
  session: Session | undefined,
  now: number,
  thresholdDays: number | null,
): boolean {
  if (thresholdDays === null || thread.closedAt || session?.status === 'running') return false;
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
