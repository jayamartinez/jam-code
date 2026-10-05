import type { HistoryEntry } from '@jam/protocol';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Whether a past chat is done and comes into its new project archived: its
 * branch was merged (or deleted), or it has been idle longer than the
 * reader's "Suggest archiving idle threads" (`idleDays`; null never
 * archives for age). A chat without a time is not idle.
 */
export function pastChatDone(
  entry: Pick<HistoryEntry, 'merged' | 'updatedAt'>,
  idleDays: number | null,
  now: number,
): boolean {
  if (entry.merged) return true;
  if (idleDays === null || !entry.updatedAt) return false;
  const at = Date.parse(entry.updatedAt);
  return Number.isFinite(at) && now - at > idleDays * DAY;
}
