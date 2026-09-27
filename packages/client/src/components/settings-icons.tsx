import type { ReactNode } from 'react';

/**
 * Settings navigation icons.
 *
 * These are the Paper Settings frames' own vectors, not a library's: each is
 * drawn on a 16-unit grid and rendered at 14px inside a 16px slot, as Paper
 * places them. Strokes are 1.3 units for glyph lines and 1.2 for the large
 * enclosing shapes (globe, terminal frame, keyboard, drum, info circle), an
 * optical correction Paper makes so a full outline does not read heavier than
 * a short stroke. Colour comes from `currentColor`, so the row decides muted
 * versus accent and no icon carries its own state.
 */

export type SettingsIconName =
  | 'general'
  | 'appearance'
  | 'providers'
  | 'agent-defaults'
  | 'permissions'
  | 'browser'
  | 'terminal'
  | 'snapshots'
  | 'skills'
  | 'keybindings'
  | 'storage'
  | 'advanced'
  | 'about';

const line = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.3,
  strokeLinecap: 'round',
} as const;
const outline = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 } as const;

const GLYPHS: Record<SettingsIconName, ReactNode> = {
  general: (
    <>
      <path d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6" {...line} />
      <circle cx="10" cy="5" r="1.5" {...line} />
      <circle cx="6" cy="11" r="1.5" {...line} />
    </>
  ),
  appearance: (
    <>
      <circle cx="8" cy="8" r="5.5" {...line} />
      <path d="M8 2.5v11a5.5 5.5 0 000-11z" fill="currentColor" />
    </>
  ),
  providers: (
    <path
      d="M6 2v3M10 2v3M4.5 5h7v2.5a3.5 3.5 0 01-7 0V5zM8 11v3"
      {...line}
      strokeLinejoin="round"
    />
  ),
  'agent-defaults': (
    <>
      <rect x="2.5" y="5" width="11" height="8" rx="2.5" {...line} />
      <path d="M8 2.5V5" {...line} />
      <circle cx="6" cy="9" r="0.9" fill="currentColor" />
      <circle cx="10" cy="9" r="0.9" fill="currentColor" />
    </>
  ),
  permissions: (
    <path
      d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4l5-2z"
      {...line}
      strokeLinejoin="round"
    />
  ),
  browser: (
    <>
      <circle cx="8" cy="8" r="5.8" {...outline} />
      <path
        d="M2.2 8h11.6M8 2.2c1.8 1.7 2.6 3.6 2.6 5.8S9.8 12.1 8 13.8C6.2 12.1 5.4 10.2 5.4 8S6.2 3.9 8 2.2z"
        {...outline}
      />
    </>
  ),
  terminal: (
    <>
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" {...outline} />
      <path d="M4.5 6l2 2-2 2M8 10.5h3.5" {...line} strokeLinejoin="round" />
    </>
  ),
  snapshots: (
    <>
      <rect x="1.5" y="3.8" width="13" height="9.7" rx="2" {...line} />
      <circle cx="8" cy="8.7" r="2.3" {...line} />
      <path d="M5.5 3.8l1-1.5h3l1 1.5" {...line} strokeLinejoin="round" />
    </>
  ),
  skills: <path d="M9 1.8L3.8 9h4l-1 5.2L12.2 7h-4L9 1.8z" {...line} strokeLinejoin="round" />,
  keybindings: (
    <>
      <rect x="1.5" y="4" width="13" height="8.5" rx="2" {...outline} />
      <path d="M4.3 6.7h.1M7 6.7h.1M9.7 6.7h.1M12 6.7h.1M5.5 9.8h5" {...line} />
    </>
  ),
  storage: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="2" {...outline} />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" {...outline} />
    </>
  ),
  advanced: (
    <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" {...line} strokeLinejoin="round" />
  ),
  about: (
    <>
      <circle cx="8" cy="8" r="5.8" {...outline} />
      <path d="M8 7.3v3.7" {...line} />
      <circle cx="8" cy="5.2" r="0.8" fill="currentColor" />
    </>
  ),
};

/** A 16px slot holding the 14px glyph; the slot, never the artwork, sets the row's geometry. */
export function SettingsIcon({ name }: { name: SettingsIconName }) {
  return (
    <span className="settings-icon" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 16 16">
        {GLYPHS[name]}
      </svg>
    </span>
  );
}
