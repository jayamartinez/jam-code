import { describe, expect, it } from 'vitest';
import { pastChatDone } from './past-chats';

const now = Date.parse('2026-10-05T12:00:00Z');

describe('past chats that come in archived', () => {
  it('archives a chat whose branch was merged, however recent', () => {
    expect(pastChatDone({ merged: true, updatedAt: '2026-10-05T11:59:00Z' }, 7, now)).toBe(true);
  });

  it('archives a chat idle longer than the idle setting', () => {
    expect(pastChatDone({ updatedAt: '2026-09-27T12:00:00Z' }, 7, now)).toBe(true);
    expect(pastChatDone({ updatedAt: '2026-09-29T12:00:00Z' }, 7, now)).toBe(false);
    expect(pastChatDone({ merged: false, updatedAt: '2026-10-04T12:00:00Z' }, 1, now)).toBe(false);
  });

  it('never archives for age when the setting is Never, or without a time', () => {
    expect(pastChatDone({ updatedAt: '2020-01-01T00:00:00Z' }, null, now)).toBe(false);
    expect(pastChatDone({}, 7, now)).toBe(false);
    expect(pastChatDone({ updatedAt: 'not a time' }, 7, now)).toBe(false);
  });
});
