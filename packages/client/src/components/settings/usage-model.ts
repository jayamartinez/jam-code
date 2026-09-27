import type { ProviderDescriptor, ProviderId } from '@jam/protocol';

/**
 * Usage as a provider adapter would report it: the account-wide allowance
 * windows and daily token counts an agent's own service publishes, across
 * everything the user runs with it — not anything JAM counts itself.
 *
 * This is client-local on purpose. No adapter reports usage yet, so the
 * runtime contract (including whether values are incremental or cumulative
 * and whether subagents are included, per docs/PROVIDERS.md) arrives with
 * the real adapters. The page renders these shapes from empty data today.
 */

export type LiveProviderId = Exclude<ProviderId, 'mock'>;

/** One allowance window, e.g. Claude Code's 5-hour session or a model's weekly cap. */
export interface UsageWindow {
  providerId: LiveProviderId;
  /** The provider's own name for the window, e.g. "5-hour session" or "Weekly". */
  label: string;
  /** Present when the window only counts one model, e.g. "Fable". */
  model?: string;
  /** 0–1 of the allowance already used. */
  usedFraction: number;
  /** ISO time the window resets. */
  resetsAt: string;
}

/** Tokens one provider reported for one local day (YYYY-MM-DD). */
export interface UsageBucket {
  date: string;
  providerId: LiveProviderId;
  input: number;
  cached: number;
  output: number;
  /** An API-price estimate in US dollars, never a bill. */
  estimatedCost?: number;
}

export interface UsageSummary {
  windows: UsageWindow[];
  daily: UsageBucket[];
}

export const EMPTY_USAGE: UsageSummary = { windows: [], daily: [] };

/** "Weekly · Fable" for a model-scoped window, else the window's label. */
export function windowTitle(window: UsageWindow): string {
  return window.model ? `${window.label} · ${window.model}` : window.label;
}

/** Whole percent left, clamped to 0–100. */
export function percentLeft(window: UsageWindow): number {
  return Math.round((1 - clamp01(window.usedFraction)) * 100);
}

/** "3h 21m", "3d 13h", "12m"; "now" once the reset has passed. */
export function formatResetsIn(resetsAt: string, now: Date): string {
  const ms = Date.parse(resetsAt) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(mins, 1)}m`;
}

/** 934M, 1.54M, 312K, 950 — three significant figures at most. */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return String(Math.round(value));
}

/** The `days` local dates ending at `end`, oldest first, as YYYY-MM-DD. */
export function dayRange(end: Date, days: number): string[] {
  const dates: string[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - offset);
    dates.push(localDate(day));
  }
  return dates;
}

export function localDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type Measure = 'tokens' | 'cost';

/**
 * One value per day per provider for the chart, zero-filled for days a
 * provider reported nothing. Buckets outside the range are ignored.
 */
export function dailySeries(
  buckets: readonly UsageBucket[],
  dates: readonly string[],
  measure: Measure,
): Map<LiveProviderId, number[]> {
  const index = new Map(dates.map((date, i) => [date, i]));
  const series = new Map<LiveProviderId, number[]>();
  for (const bucket of buckets) {
    const i = index.get(bucket.date);
    if (i === undefined) continue;
    let values = series.get(bucket.providerId);
    if (!values) {
      values = dates.map(() => 0);
      series.set(bucket.providerId, values);
    }
    values[i]! += bucketValue(bucket, measure);
  }
  return series;
}

export function bucketValue(bucket: UsageBucket, measure: Measure): number {
  return measure === 'cost'
    ? (bucket.estimatedCost ?? 0)
    : bucket.input + bucket.cached + bucket.output;
}

/** A round axis ceiling (1, 2 or 5 × 10ⁿ) at or above `value`; 1 for no data. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A smooth SVG path through `points` (sorted by x) using monotone cubic
 * interpolation (Fritsch–Carlson), so the curve never overshoots the data:
 * a day with zero tokens stays on the baseline instead of dipping below it.
 */
export function monotonePath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const fmt = (n: number) => Number(n.toFixed(2));
  const first = points[0]!;
  if (points.length === 1) return `M${fmt(first.x)} ${fmt(first.y)}`;
  const n = points.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    slopes.push((b.y - a.y) / (b.x - a.x));
  }
  const tangents: number[] = [slopes[0]!];
  for (let i = 1; i < n - 1; i++) {
    const before = slopes[i - 1]!;
    const after = slopes[i]!;
    tangents.push(before * after <= 0 ? 0 : (before + after) / 2);
  }
  tangents.push(slopes[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i]!;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / slope;
    const b = tangents[i + 1]! / slope;
    const length = a * a + b * b;
    if (length > 9) {
      const scale = 3 / Math.sqrt(length);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }
  let d = `M${fmt(first.x)} ${fmt(first.y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const h = (b.x - a.x) / 3;
    d += ` C${fmt(a.x + h)} ${fmt(a.y + tangents[i]! * h)} ${fmt(b.x - h)} ${fmt(
      b.y - tangents[i + 1]! * h,
    )} ${fmt(b.x)} ${fmt(b.y)}`;
  }
  return d;
}

/** Chart coordinates for one series in a `width` × `height` box whose top is `ceiling`. */
export function seriesPoints(
  values: readonly number[],
  width: number,
  height: number,
  ceiling: number,
): Point[] {
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value, i) => ({
    x: i * step,
    y: height - (clamp(value, 0, ceiling) / ceiling) * height,
  }));
}

/** Live providers the runtime reports, split by whether the user has connected them. */
export function usageSources(providers: readonly ProviderDescriptor[]): {
  connected: ProviderDescriptor[];
  disconnected: ProviderDescriptor[];
} {
  const live = providers.filter((provider) => provider.id !== 'mock');
  return {
    connected: live.filter((provider) => provider.enabled),
    disconnected: live.filter((provider) => !provider.enabled),
  };
}

function clamp01(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
