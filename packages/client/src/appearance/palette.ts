import { fromHsl, toHex, toHsl, type Rgb } from './color';

/**
 * Colors taken from a wallpaper, for "Match colors to image".
 *
 * The image is sampled once at a few dozen pixels a side, so extraction is a
 * few thousand pixels of arithmetic whatever the wallpaper's size. The accent
 * is the most vivid hue family the image actually uses, weighted by how much
 * of it there is; the grounds are the image's own darkest and lightest tones,
 * pulled close to black and white so they only tint JAM's surfaces.
 */
export interface WallpaperPalette {
  /** Accent for dark and light themes. */
  accentDark: string;
  accentLight: string;
  /** Surface tints for dark and light themes. */
  groundDark: string;
  groundLight: string;
}

const BUCKETS = 12;

function average(pixels: Rgb[]): string {
  if (!pixels.length) return '#808080';
  const sum = pixels.reduce<Rgb>(
    (total, [r, g, b]) => [total[0] + r, total[1] + g, total[2] + b],
    [0, 0, 0],
  );
  return toHex(sum.map((channel) => channel / pixels.length) as Rgb);
}

/** `rgba` is canvas image data: four bytes per pixel. */
export function extractPalette(rgba: ArrayLike<number>): WallpaperPalette {
  const pixels: Rgb[] = [];
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    if ((rgba[index + 3] ?? 0) < 128) continue;
    pixels.push([rgba[index]!, rgba[index + 1]!, rgba[index + 2]!]);
  }
  const scores = new Array<number>(BUCKETS).fill(0);
  const members: Rgb[][] = Array.from({ length: BUCKETS }, () => []);
  for (const pixel of pixels) {
    const [h, s, l] = toHsl(toHex(pixel));
    if (s < 0.3 || l < 0.18 || l > 0.85) continue;
    const bucket = Math.floor(h / (360 / BUCKETS)) % BUCKETS;
    scores[bucket]! += s * (1 - Math.abs(l - 0.55));
    members[bucket]!.push(pixel);
  }
  const best = scores.indexOf(Math.max(...scores));
  const vivid = scores[best]! > pixels.length * 0.01 ? average(members[best]!) : '#6f9bff';
  const [hue, saturation] = toHsl(vivid);
  const byLight = [...pixels].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  const quarter = Math.max(1, Math.floor(byLight.length / 4));
  const [darkHue, darkSaturation] = toHsl(average(byLight.slice(0, quarter)));
  const [lightHue, lightSaturation] = toHsl(average(byLight.slice(-quarter)));
  return {
    accentDark: fromHsl(hue, Math.max(saturation, 0.55), 0.66),
    accentLight: fromHsl(hue, Math.max(saturation, 0.6), 0.42),
    groundDark: fromHsl(darkHue, Math.min(darkSaturation, 0.45), 0.09),
    groundLight: fromHsl(lightHue, Math.min(lightSaturation, 0.4), 0.95),
  };
}

/** Samples a wallpaper in the browser. Returns undefined where there is no canvas. */
export async function paletteFromImage(dataUrl: string): Promise<WallpaperPalette | undefined> {
  if (typeof document === 'undefined') return undefined;
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(image, 0, 0, size, size);
  return extractPalette(context.getImageData(0, 0, size, size).data);
}
