import type { Message, MessageBlock } from '@jam/protocol';
import type { TimeFormat } from '../state/preferences';

/** A pause this long, or a new day, puts the next message's time on a divider. */
const GAP_MS = 30 * 60 * 1000;

const valid = (date: Date) => !Number.isNaN(date.getTime());

/** Clock options for a time format; `system` leaves the hour cycle to the locale. */
function clock(format: TimeFormat): Intl.DateTimeFormatOptions {
  return format === '24h'
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { hour: 'numeric', minute: '2-digit', ...(format === '12h' ? { hour12: true } : {}) };
}

/** "2:14 PM" or "14:14"; empty for an unreadable timestamp. */
export function formatClock(value: string, format: TimeFormat, locale?: string): string {
  const date = new Date(value);
  return valid(date) ? date.toLocaleTimeString(locale, clock(format)) : '';
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * A divider's label: "Today 2:14 PM", "Yesterday 6:40 PM", then the date,
 * with the year only when it is not this year.
 */
export function dividerLabel(
  value: string,
  format: TimeFormat,
  now = new Date(),
  locale?: string,
): string {
  const date = new Date(value);
  if (!valid(date)) return '';
  const time = date.toLocaleTimeString(locale, clock(format));
  if (sameDay(date, now)) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${time}`;
  return date.toLocaleString(locale, {
    ...(date.getFullYear() === now.getFullYear() ? { weekday: 'short' } : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    ...clock(format),
  });
}

/** When a message's activity ended: its turn's end, or when it was written. */
const lastActivity = (message: Message) => message.completedAt ?? message.createdAt;

/** Whether `next` comes after a long pause or on another day than `previous`. */
export function startsAfterGap(previous: Message, next: Message): boolean {
  const before = new Date(lastActivity(previous));
  const after = new Date(next.createdAt);
  if (!valid(before) || !valid(after)) return false;
  return after.getTime() - before.getTime() >= GAP_MS || !sameDay(before, after);
}

/** "22s", "1m 12s", "2h 5m". */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours}h ${minutes % 60}m`
    : minutes
      ? `${minutes}m ${seconds % 60}s`
      : `${seconds}s`;
}

/**
 * How long a finished turn took, from the times it recorded. A turn that was
 * stopped, or saved before JAM recorded turn ends, has no end: unknown.
 */
export function turnDuration(message: Message): string | undefined {
  if (!message.completedAt) return undefined;
  const start = Date.parse(message.createdAt);
  const end = Date.parse(message.completedAt);
  return Number.isNaN(start) || Number.isNaN(end) ? undefined : formatDuration(end - start);
}

/** Index of the last action; everything up to it is the turn's log, the prose after it the answer. */
export function lastActionIndex(blocks: readonly MessageBlock[]): number {
  let last = -1;
  blocks.forEach((block, index) => {
    if (block.type === 'tool' || (block.type === 'reasoning' && block.text.trim())) last = index;
  });
  return last;
}

const joinText = (blocks: readonly MessageBlock[]) =>
  blocks
    .flatMap((block) => (block.type === 'text' && block.text.trim() ? [block.text.trim()] : []))
    .join('\n\n');

/**
 * What Copy puts on the clipboard: the reader's words, or an agent's answer
 * as Markdown. A reply that ends in actions, with no answer after them,
 * copies everything it said instead.
 */
export function copyText(message: Message): string {
  if (message.role === 'user') return joinText(message.blocks);
  return (
    joinText(message.blocks.slice(lastActionIndex(message.blocks) + 1)) || joinText(message.blocks)
  );
}
