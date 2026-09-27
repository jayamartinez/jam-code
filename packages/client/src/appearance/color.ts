/**
 * The little colour arithmetic themes need: mixing, alpha and contrast.
 * Everything works on `#rrggbb` so values stay exact and testable; alpha is
 * expressed as CSS `rgb(r g b / a%)`, the form tokens.css already uses.
 */

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

export function toHex([r, g, b]: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** `amount` of `other` mixed into `base`, in sRGB like `color-mix(in srgb …)`. */
export function mix(base: string, other: string, amount: number): string {
  const a = parseHex(base);
  const b = parseHex(other);
  return toHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as Rgb);
}

/** `rgb(r g b / n%)` with the percentage kept to at most one decimal place. */
export function alpha(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const value = Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
  return `rgb(${r} ${g} ${b} / ${value}%)`;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colours. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
