import { useId } from 'react';

/*
 * The jam app mark, drawn from the canonical 512-unit master (Paper's
 * "Brand · jam" board). It is artwork, not themed chrome: its colours are the
 * Nightglass backdrop glows baked into the logo, so it keeps them under every
 * theme, as the app icon does.
 */
const GLOWS = [
  {
    color: '#3269e6',
    opacity: 0.58,
    cx: 433.78,
    cy: -1.53,
    r: 213.58,
    transform: 'translate(0 -.12) scale(1 .92)',
  },
  {
    color: '#2346b4',
    opacity: 0.5,
    cx: 126.37,
    cy: 536.74,
    r: 193.83,
    transform: 'translate(0 48.31) scale(1 .91)',
  },
  { color: '#2896d2', opacity: 0.35, cx: 511.56, cy: 512.05, r: 155.56 },
  { color: '#bed2ff', opacity: 0.07, cx: 254.77, cy: 255.26, r: 361.73 },
];

const LETTERS = [
  'M104.08,311.05h9.33c6.69,0,10.38-2.29,10.38-10.38v-92.57h22.53v93.28c0,19.36-7.92,27.1-28.86,27.1h-13.38v-17.42ZM123.44,175.53h23.41v20.06h-23.41v-20.06Z',
  'M162.16,278.49c0-16.19,10.03-24.81,30.62-28.86l31.15-6.16c0-13.2-6.16-20.06-18.13-20.06-10.91,0-17.07,5.1-19.18,14.61l-22.88-1.06c3.7-19.71,18.83-30.98,42.06-30.98,26.75,0,40.65,14.08,40.65,39.07v34.14c0,5.1,1.76,6.51,5.28,6.51h2.99v16.37c-1.58.35-5.1.7-8.27.7-10.03,0-17.6-3.52-19.54-14.96v-.18c-4.75,10.03-16.72,16.54-32.03,16.54-19.71,0-32.73-9.33-32.73-25.7ZM223.93,264.06v-5.28l-24.29,4.93c-10.03,1.94-14.08,6.16-14.08,12.67,0,7.39,4.93,11.44,13.9,11.44,14.96,0,24.46-9.5,24.46-23.76Z',
  'M267.58,208.09h20.42l.53,15.66c4.75-11.26,14.26-17.78,25.87-17.78,13.73,0,23.23,7.22,27.28,19.36,4.22-12.5,13.9-19.36,26.93-19.36,19.36,0,31.33,12.5,31.33,35.73v60.37h-22.53v-54.56c0-15.49-5.1-23.23-16.02-23.23s-17.25,8.8-17.25,23.94v53.85h-20.94v-53.85c0-15.31-4.22-23.94-15.66-23.94-10.74,0-17.42,8.98-17.42,23.94v53.85h-22.53v-93.98Z',
];

/** The tile at `size` CSS pixels; its edge ring stays one pixel at any size. */
export function BrandMark({ size }: { size: number }) {
  // useId's delimiters are not valid in a bare `url(#…)` fragment everywhere.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ring = 512 / size;
  const inset = ring / 2;
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {GLOWS.map((glow, index) => (
          <radialGradient
            key={glow.color}
            id={`${id}-glow${index}`}
            cx={glow.cx}
            cy={glow.cy}
            r={glow.r}
            gradientTransform={glow.transform}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={glow.color} stopOpacity={glow.opacity} />
            <stop offset="1" stopColor={glow.color} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      <rect width="512" height="512" rx="115" fill="#07080c" />
      {GLOWS.map((glow, index) => (
        <rect
          key={glow.color}
          width="512"
          height="512"
          rx="115"
          fill={`url(#${id}-glow${index})`}
        />
      ))}
      <rect
        x={inset}
        y={inset}
        width={512 - ring}
        height={512 - ring}
        rx={115 - inset}
        fill="none"
        stroke="#c8d2ff"
        strokeOpacity="0.08"
        strokeWidth={ring}
      />
      {LETTERS.map((d) => (
        <path key={d} d={d} fill="#e3e6ee" />
      ))}
    </svg>
  );
}
