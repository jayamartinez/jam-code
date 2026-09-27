import type { ReactNode } from 'react';
import type { IconKey } from './classify';

/**
 * The JAM file glyph set.
 *
 * A first attempt drew every file as a page outline with a small type mark
 * inside it. At the 14px the tree actually uses, the outline dominated and the
 * marks were illegible, so the page is gone: the mark *is* the icon and fills
 * the box. "File-ness" is already obvious from position in the tree, so the
 * icon spends all of its space on the one thing the outline could not say.
 *
 * Types separate by silhouette first and tone second. Five tones across the
 * whole set keeps a deep tree calm rather than turning it into a colour chart;
 * anything JAM has no opinion about stays grey.
 *
 * Drawn on the same 16-unit grid as every other icon in the interface.
 */

const BLUE = 'var(--color-accent)';
const SKY = 'var(--color-accent-secondary)';
const WARM = 'var(--color-warning)';
const GREEN = 'var(--color-success)';
const QUIET = 'var(--color-text-subtle)';
const FAINT = 'var(--color-text-ghost)';

const line = (d: string, color: string, width = 1.35) => (
  <path
    d={d}
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
);

/** A filled tile: compiled, first-class source in a known language. */
const tile = (color: string, mark: ReactNode) => (
  <>
    <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.6" fill={color} opacity="0.16" />
    <rect
      x="2.2"
      y="2.2"
      width="11.6"
      height="11.6"
      rx="2.6"
      fill="none"
      stroke={color}
      strokeWidth="1.15"
    />
    {mark}
  </>
);

/** The orbiting ring that marks a component file. */
const orbit = (color: string) => (
  <>
    <ellipse
      cx="8"
      cy="8"
      rx="5.4"
      ry="2.3"
      fill="none"
      stroke={color}
      strokeWidth="1.15"
      transform="rotate(-28 8 8)"
    />
    <circle cx="8" cy="8" r="1.35" fill={color} />
  </>
);

export const JAM_GLYPHS: Record<IconKey, ReactNode> = {
  folder: line(
    'M2.1 4.6a1.1 1.1 0 0 1 1.1-1.1h2.9l1.5 1.6h5.3a1.1 1.1 0 0 1 1.1 1.1v6.2a1.1 1.1 0 0 1-1.1 1.1H3.2a1.1 1.1 0 0 1-1.1-1.1z',
    'var(--color-text-muted)',
    1.2,
  ),
  'folder-open': (
    <>
      {line(
        'M2.1 12.6V4.6a1.1 1.1 0 0 1 1.1-1.1h2.9l1.5 1.6h5.3a1.1 1.1 0 0 1 1.1 1.1v1',
        'var(--color-text-secondary)',
        1.2,
      )}
      {line('M3.3 13.4 5 7.9h9.9l-1.7 5.5z', 'var(--color-text-secondary)', 1.2)}
    </>
  ),

  // A tile with the crossbar of a T: typed source.
  typescript: tile(BLUE, line('M5.4 6.2h5.2M8 6.2v4.4', BLUE, 1.5)),
  // The same tile language, carrying a component's orbit.
  tsx: tile(BLUE, orbit(BLUE)),
  javascript: tile(WARM, line('M9.8 5.6v3.9a1.4 1.4 0 0 1-2.8 0', WARM, 1.5)),
  jsx: tile(WARM, orbit(WARM)),

  // A hexagon: systems source.
  rust: line('M8 1.9l5.3 3.05v6.1L8 14.1 2.7 11.05v-6.1z', WARM, 1.25),
  // Two interlocking loops.
  python: (
    <>
      {line('M4.6 11.3V6.4a2 2 0 0 1 2-2H8v3.1H4.6', BLUE, 1.25)}
      {line('M11.4 4.7v4.9a2 2 0 0 1-2 2H8V8.5h3.4', WARM, 1.25)}
    </>
  ),

  // Braces, at full size so they are unmistakable.
  json: line(
    'M6.3 2.9C4.5 2.9 5 7.2 3.4 8c1.6.8 1.1 5.1 2.9 5.1M9.7 2.9c1.8 0 1.3 4.3 2.9 5.1-1.6.8-1.1 5.1-2.9 5.1',
    WARM,
    1.3,
  ),
  // A rule above lines of prose.
  markdown: (
    <>
      {line('M2.6 4.4h10.8', GREEN, 1.5)}
      {line('M2.6 7.6h10.8M2.6 10.4h7.6M2.6 13.1h5', QUIET, 1.2)}
    </>
  ),
  // A hash: selectors.
  css: line('M6.3 2.9 5 13.1M11 2.9 9.7 13.1M2.9 6.1h10.6M2.5 10.1h10.6', SKY, 1.25),
  // Angle brackets around a slash.
  html: line('M5.7 4.6 2.5 8l3.2 3.4M10.3 4.6 13.5 8l-3.2 3.4M9.3 3.6 6.7 12.4', WARM, 1.3),
  // Keys and their values.
  yaml: (
    <>
      {line('M3 4.6h3.4M3 8h3.4M3 11.4h3.4', QUIET, 1.3)}
      {line('M9 4.6h4M9 8h4M9 11.4h2.6', GREEN, 1.3)}
    </>
  ),
  // A prompt.
  shell: line('M3.2 4.6 6.9 8l-3.7 3.4M8.6 11.8h4.3', GREEN, 1.35),
  // A frame holding a sun and a horizon.
  image: (
    <>
      <rect
        x="2.2"
        y="3.2"
        width="11.6"
        height="9.6"
        rx="1.8"
        fill="none"
        stroke={SKY}
        strokeWidth="1.2"
      />
      <circle cx="5.7" cy="6.5" r="1.1" fill={SKY} />
      {line('M2.6 12.2 6.6 8.4l2 2 2.2-2.1 2.6 2.5', SKY, 1.2)}
    </>
  ),
  // Two commits and the branch between them.
  git: (
    <>
      <circle cx="5" cy="4.4" r="1.7" fill="none" stroke={WARM} strokeWidth="1.25" />
      <circle cx="5" cy="11.8" r="1.7" fill="none" stroke={WARM} strokeWidth="1.25" />
      <circle cx="11.4" cy="6.4" r="1.7" fill="none" stroke={WARM} strokeWidth="1.25" />
      {line('M5 6.1v4M11.4 8.1c0 2.5-3.4 2.2-6.4 3.7', WARM, 1.25)}
    </>
  ),
  // A sealed carton: what the project declares it is.
  manifest: (
    <>
      {line('M8 2.4 13.6 5v6L8 13.6 2.4 11V5z', GREEN, 1.25)}
      {line('M2.4 5 8 7.7 13.6 5M8 7.7v5.9', GREEN, 1.15)}
    </>
  ),
  // A padlock: resolved and pinned.
  lockfile: (
    <>
      {line('M5.4 7V5.7a2.6 2.6 0 0 1 5.2 0V7', QUIET, 1.25)}
      <rect
        x="3.6"
        y="7"
        width="8.8"
        height="6.4"
        rx="1.5"
        fill="none"
        stroke={QUIET}
        strokeWidth="1.25"
      />
    </>
  ),
  // Sliders.
  config: (
    <>
      {line('M2.6 5.4h10.8M2.6 10.6h10.8', QUIET, 1.25)}
      <circle
        cx="6"
        cy="5.4"
        r="1.7"
        fill="var(--color-bg-base)"
        stroke={QUIET}
        strokeWidth="1.25"
      />
      <circle
        cx="10"
        cy="10.6"
        r="1.7"
        fill="var(--color-bg-base)"
        stroke={QUIET}
        strokeWidth="1.25"
      />
    </>
  ),
  // Only the file JAM has no opinion about keeps the page outline.
  file: (
    <>
      {line('M3.9 2.4h5l3.2 3.2v8H3.9z', FAINT, 1.2)}
      {line('M8.9 2.6v3h3.1', FAINT, 1.2)}
    </>
  ),
};
