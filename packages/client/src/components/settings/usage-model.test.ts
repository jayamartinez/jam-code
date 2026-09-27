import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@jam/protocol';
import {
  dailySeries,
  dayRange,
  formatResetsIn,
  formatTokens,
  monotonePath,
  niceCeiling,
  percentLeft,
  seriesPoints,
  usageSources,
  windowTitle,
  type UsageBucket,
  type UsageWindow,
} from './usage-model';

const weekly: UsageWindow = {
  providerId: 'claude',
  label: 'Weekly',
  usedFraction: 0.18,
  resetsAt: '2026-10-01T00:00:00Z',
};

describe('usage windows', () => {
  it('names a model-scoped window after its model', () => {
    expect(windowTitle(weekly)).toBe('Weekly');
    expect(windowTitle({ ...weekly, model: 'Fable' })).toBe('Weekly · Fable');
  });

  it('reports whole percent left, clamped', () => {
    expect(percentLeft(weekly)).toBe(82);
    expect(percentLeft({ ...weekly, usedFraction: 1.4 })).toBe(0);
    expect(percentLeft({ ...weekly, usedFraction: -1 })).toBe(100);
    expect(percentLeft({ ...weekly, usedFraction: Number.NaN })).toBe(100);
  });

  it('formats time until reset', () => {
    const now = new Date('2026-09-27T12:00:00Z');
    expect(formatResetsIn('2026-09-27T15:21:00Z', now)).toBe('3h 21m');
    expect(formatResetsIn('2026-10-01T01:00:00Z', now)).toBe('3d 13h');
    expect(formatResetsIn('2026-09-27T12:00:30Z', now)).toBe('1m');
    expect(formatResetsIn('2026-09-27T11:00:00Z', now)).toBe('now');
    expect(formatResetsIn('not a date', now)).toBe('now');
  });
});

describe('formatTokens', () => {
  it('keeps at most three significant figures', () => {
    expect(formatTokens(934_000_000)).toBe('934M');
    expect(formatTokens(1_540_000)).toBe('1.54M');
    expect(formatTokens(16_400_000)).toBe('16.4M');
    expect(formatTokens(312_000)).toBe('312K');
    expect(formatTokens(2_120_000_000)).toBe('2.12B');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(0)).toBe('0');
  });
});

describe('daily series', () => {
  const dates = dayRange(new Date(2026, 8, 27), 3);

  it('lists local days oldest first', () => {
    expect(dates).toEqual(['2026-09-25', '2026-09-26', '2026-09-27']);
    expect(dayRange(new Date(2026, 2, 1), 2)).toEqual(['2026-02-28', '2026-03-01']);
  });

  it('zero-fills per provider and ignores days outside the range', () => {
    const buckets: UsageBucket[] = [
      { date: '2026-09-26', providerId: 'claude', input: 10, cached: 20, output: 5 },
      { date: '2026-09-26', providerId: 'claude', input: 1, cached: 0, output: 0 },
      { date: '2026-09-27', providerId: 'codex', input: 3, cached: 0, output: 1, estimatedCost: 2 },
      { date: '2026-08-01', providerId: 'codex', input: 999, cached: 0, output: 0 },
    ];
    const tokens = dailySeries(buckets, dates, 'tokens');
    expect(tokens.get('claude')).toEqual([0, 36, 0]);
    expect(tokens.get('codex')).toEqual([0, 0, 4]);
    expect(dailySeries(buckets, dates, 'cost').get('codex')).toEqual([0, 0, 2]);
  });

  it('is empty when nothing was reported', () => {
    expect(dailySeries([], dates, 'tokens').size).toBe(0);
  });
});

describe('chart geometry', () => {
  it('rounds the axis up to 1, 2 or 5 × 10ⁿ', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(470_000_000)).toBe(500_000_000);
    expect(niceCeiling(130)).toBe(200);
    expect(niceCeiling(1000)).toBe(1000);
  });

  it('maps values into the box with the baseline at the bottom', () => {
    expect(seriesPoints([0, 50, 100], 200, 100, 100)).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
  });

  it('draws a monotone curve that never overshoots', () => {
    const points = seriesPoints([0, 0, 100, 0, 0], 400, 100, 100);
    const d = monotonePath(points);
    expect(d.startsWith('M0 100')).toBe(true);
    const ys = [...d.matchAll(/-?\d+(?:\.\d+)?/g)]
      .map((match) => Number(match[0]))
      .filter((_, i) => i % 2 === 1);
    // Every control point stays within the data's own range.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('handles tiny inputs', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 3, y: 4 }])).toBe('M3 4');
  });
});

describe('usage sources', () => {
  const descriptor = (id: ProviderDescriptor['id'], enabled: boolean) =>
    ({ id, name: id, enabled }) as ProviderDescriptor;

  it('keeps live providers only, split by connection', () => {
    const { connected, disconnected } = usageSources([
      descriptor('mock', true),
      descriptor('claude', true),
      descriptor('codex', false),
    ]);
    expect(connected.map((p) => p.id)).toEqual(['claude']);
    expect(disconnected.map((p) => p.id)).toEqual(['codex']);
  });
});
