/**
 * Font choices.
 *
 * JAM bundles only Geist and Geist Mono. Every other family is used only when
 * this computer already has it: nothing is downloaded or installed. WebViews
 * cannot list installed fonts, so JAM offers a short list of common families,
 * checks which of them resolve, and also accepts any family name typed in.
 */

export interface FontChoice {
  /** `''` is JAM's bundled default. */
  value: string;
  label: string;
  note?: string;
}

export const UI_FONTS: FontChoice[] = [
  { value: '', label: 'Geist', note: 'Bundled' },
  { value: 'system-ui', label: 'System', note: 'OS default' },
  { value: 'Inter', label: 'Inter' },
  { value: 'IBM Plex Sans', label: 'IBM Plex Sans' },
  { value: 'Segoe UI', label: 'Segoe UI', note: 'Windows' },
  { value: 'Helvetica Neue', label: 'Helvetica Neue', note: 'macOS' },
  { value: 'Source Sans 3', label: 'Source Sans 3' },
  { value: 'Noto Sans', label: 'Noto Sans' },
];

export const MONO_FONTS: FontChoice[] = [
  { value: '', label: 'Geist Mono', note: 'Bundled' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'JetBrainsMono Nerd Font', label: 'JetBrains Mono Nerd Font' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Iosevka', label: 'Iosevka' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { value: 'Berkeley Mono', label: 'Berkeley Mono' },
  { value: 'SF Mono', label: 'SF Mono', note: 'macOS' },
  { value: 'Menlo', label: 'Menlo', note: 'macOS' },
  { value: 'Consolas', label: 'Consolas', note: 'Windows' },
  { value: 'ui-monospace', label: 'System monospace' },
];

const available = new Map<string, boolean>();

/**
 * Whether `family` resolves to an installed face. Text is measured in the
 * family with two different fallbacks; if both widths match their fallback
 * alone, the family itself was never used.
 */
export function isFontAvailable(family: string): boolean {
  if (!family || family === 'system-ui' || family === 'ui-monospace') return true;
  const known = available.get(family);
  if (known !== undefined) return known;
  if (typeof document === 'undefined') return false;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return false;
  const sample = 'mmmmmmmmmwwwwwwwlli10OO@#';
  const width = (font: string) => {
    context.font = `32px ${font}`;
    return context.measureText(sample).width;
  };
  const result = ['monospace', 'serif'].some(
    (fallback) => width(`'${family}', ${fallback}`) !== width(fallback),
  );
  available.set(family, result);
  return result;
}
