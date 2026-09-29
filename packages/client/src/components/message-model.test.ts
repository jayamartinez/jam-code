import { describe, expect, it } from 'vitest';
import type { Message, MessageBlock } from '@jam/protocol';
import {
  copyText,
  dividerLabel,
  formatClock,
  formatDuration,
  lastActionIndex,
  startsAfterGap,
  turnDuration,
} from './message-model';
import { readTimeFormat } from '../state/preferences';

/** A local time, as the runtime would store it. */
const at = (day: number, hour: number, minute = 0, month = 8, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();
/** ICU may put a narrow no-break space before AM/PM. */
const plain = (text: string) => text.replace(/\s/g, ' ');

const message = (overrides: Partial<Message> = {}): Message => ({
  id: 'm',
  role: 'user',
  createdAt: at(29, 14),
  blocks: [{ type: 'text', text: 'Hello' }],
  ...overrides,
});

describe('message times', () => {
  it('follows the chosen clock, or the locale for System', () => {
    const value = at(29, 14, 5);
    expect(plain(formatClock(value, '12h', 'en-GB'))).toBe('2:05 pm');
    expect(formatClock(value, '24h', 'en-US')).toBe('14:05');
    expect(plain(formatClock(value, 'system', 'en-US'))).toBe('2:05 PM');
    expect(formatClock(value, 'system', 'en-GB')).toBe('14:05');
    expect(formatClock('not a date', '24h')).toBe('');
  });

  it('labels dividers today, yesterday, this year and before', () => {
    const now = new Date(2026, 8, 29, 16, 0);
    expect(plain(dividerLabel(at(29, 14, 14), '12h', now, 'en-US'))).toBe('Today 2:14 PM');
    expect(dividerLabel(at(28, 18, 40), '24h', now, 'en-US')).toBe('Yesterday 18:40');
    expect(plain(dividerLabel(at(21, 9, 5), '12h', now, 'en-US'))).toBe('Mon, Sep 21, 9:05 AM');
    expect(plain(dividerLabel(at(21, 9, 5, 8, 2025), '12h', now, 'en-US'))).toBe(
      'Sep 21, 2025, 9:05 AM',
    );
    // Yesterday across a month boundary.
    expect(dividerLabel(at(30, 23, 0, 8), '24h', new Date(2026, 9, 1, 8), 'en-US')).toBe(
      'Yesterday 23:00',
    );
    expect(dividerLabel('bad', '24h', now)).toBe('');
  });

  it('reads a stored time format, defaulting to System', () => {
    expect(readTimeFormat('24h')).toBe('24h');
    expect(readTimeFormat('12h')).toBe('12h');
    expect(readTimeFormat(null)).toBe('system');
    expect(readTimeFormat('hourly')).toBe('system');
  });
});

describe('time gaps', () => {
  it('starts a divider after 30 minutes or on a new day', () => {
    const first = message({ createdAt: at(29, 14, 0) });
    expect(startsAfterGap(first, message({ createdAt: at(29, 14, 29) }))).toBe(false);
    expect(startsAfterGap(first, message({ createdAt: at(29, 14, 30) }))).toBe(true);
    const late = message({ createdAt: at(28, 23, 50) });
    expect(startsAfterGap(late, message({ createdAt: at(29, 0, 5) }))).toBe(true);
  });

  it('measures from the end of a long turn, not its start', () => {
    const reply = message({
      role: 'assistant',
      createdAt: at(29, 14, 0),
      completedAt: at(29, 14, 45),
    });
    expect(startsAfterGap(reply, message({ createdAt: at(29, 14, 46) }))).toBe(false);
  });

  it('never guesses from unreadable times', () => {
    expect(startsAfterGap(message({ createdAt: 'bad' }), message())).toBe(false);
  });
});

describe('turn durations', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(22_000)).toBe('22s');
    expect(formatDuration(72_400)).toBe('1m 12s');
    expect(formatDuration(2 * 3600_000 + 5 * 60_000)).toBe('2h 5m');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('uses the times the turn recorded, and nothing when it has no end', () => {
    const reply = message({ role: 'assistant', createdAt: '2026-09-29T14:00:00.000Z' });
    expect(turnDuration({ ...reply, completedAt: '2026-09-29T14:00:22.000Z' })).toBe('22s');
    expect(turnDuration(reply)).toBeUndefined();
    expect(turnDuration({ ...reply, completedAt: 'bad' })).toBeUndefined();
  });
});

describe('copy text', () => {
  const tool: MessageBlock = {
    type: 'tool',
    id: 't',
    kind: 'command',
    title: 'Run tests',
    detail: 'pnpm test',
    status: 'completed',
  };

  it("copies the reader's words without the context they attached", () => {
    const sent = message({
      blocks: [
        { type: 'context', items: [] },
        { type: 'text', text: 'Fix the test\n\nPlease' },
      ],
    });
    expect(copyText(sent)).toBe('Fix the test\n\nPlease');
  });

  it("copies an agent's answer after its last action, as Markdown", () => {
    const reply = message({
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Looking at the tests.' },
        tool,
        { type: 'text', text: 'All **green**.' },
        { type: 'text', text: '- one\n- two' },
      ],
    });
    expect(lastActionIndex(reply.blocks)).toBe(1);
    expect(copyText(reply)).toBe('All **green**.\n\n- one\n- two');
  });

  it('copies everything said when a reply ends in actions', () => {
    const reply = message({
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Running them.' }, tool],
    });
    expect(copyText(reply)).toBe('Running them.');
  });
});
