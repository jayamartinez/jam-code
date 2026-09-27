import type { ReactNode } from 'react';
import {
  monotonePath,
  niceCeiling,
  seriesPoints,
  type LiveProviderId,
  type Measure,
} from './usage-model';

/** Drawing units; the SVG stretches to its box, strokes stay 1.5px. */
const WIDTH = 600;
const HEIGHT = 160;
const TICKS = 4;

export const PROVIDER_COLOR: Record<LiveProviderId, string> = {
  claude: 'var(--color-provider-claude)',
  codex: 'var(--color-provider-codex)',
};

/**
 * Daily usage as one smooth, overlapping area per provider: a thin line with
 * a faint fill beneath it, over quiet gridlines. With no data it still draws
 * the frame so the page keeps its shape, and says so.
 */
export function UsageAreaChart({
  series,
  dates,
  measure,
  formatValue,
  empty,
}: {
  series: Map<LiveProviderId, number[]>;
  dates: readonly string[];
  measure: Measure;
  formatValue(value: number): string;
  empty?: ReactNode;
}) {
  const peak = Math.max(0, ...[...series.values()].flat());
  const ceiling = niceCeiling(peak);
  const hasData = peak > 0;
  const ticks = Array.from({ length: TICKS }, (_, i) => (ceiling * (TICKS - 1 - i)) / (TICKS - 1));
  const labels = axisDates(dates);
  return (
    <figure className="usage-chart" aria-label={measure === 'cost' ? 'Daily cost' : 'Daily tokens'}>
      <figcaption>{measure === 'cost' ? 'Daily cost' : 'Daily tokens'}</figcaption>
      <div className="usage-chart-plot">
        <div className="usage-chart-grid" aria-hidden="true">
          {ticks.map((tick, i) => (
            <div key={i}>
              <span>{hasData || tick === 0 ? formatValue(tick) : ''}</span>
              <i />
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {[...series.entries()].map(([providerId, values]) => {
            const line = monotonePath(seriesPoints(values, WIDTH, HEIGHT, ceiling));
            if (!line) return null;
            return (
              <g key={providerId} style={{ color: PROVIDER_COLOR[providerId] }}>
                <path
                  className="usage-chart-fill"
                  d={`${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`}
                />
                <path className="usage-chart-line" d={line} />
              </g>
            );
          })}
        </svg>
        {!hasData && empty && <div className="usage-chart-empty">{empty}</div>}
      </div>
      <div className="usage-chart-dates" aria-hidden="true">
        {labels.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>
    </figure>
  );
}

/** First, middle and last dates as "AUG 29". */
function axisDates(dates: readonly string[]): string[] {
  if (dates.length === 0) return [];
  const picks = [dates[0]!, dates[Math.floor((dates.length - 1) / 2)]!, dates[dates.length - 1]!];
  return picks.map((date) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Date(year!, month! - 1, day!)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      .toUpperCase();
  });
}
