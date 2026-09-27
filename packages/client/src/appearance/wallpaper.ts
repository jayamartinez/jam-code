import { APPEARANCE, type Wallpaper } from '@jam/protocol';

/**
 * Turns a chosen image file into the copy JAM stores.
 *
 * The file comes from the platform's own open panel through a file input, so
 * the interface receives the bytes and never a path. The image is decoded
 * once, drawn no larger than a desktop display needs, and re-encoded, so a
 * 40-megapixel photograph becomes a few hundred kilobytes and JAM never holds
 * the original. Only the file name is kept, for display.
 */

const MAX_EDGE = APPEARANCE.limits.wallpaperPixels;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export const WALLPAPER_ACCEPT = ACCEPTED.join(',');

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function decode(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not an image JAM can show.'));
    image.src = source;
  });
}

export async function prepareWallpaper(file: File): Promise<Wallpaper> {
  if (!ACCEPTED.includes(file.type))
    throw new Error('Choose a JPEG, PNG, WebP, GIF or AVIF image.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That image is larger than 40 MB.');
  // Read as a data URL: the desktop content policy allows `data:` images, not `blob:`.
  const image = await decode(await readAsDataUrl(file));
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This window cannot prepare images.');
  context.drawImage(image, 0, 0, width, height);
  // WebP where the WebView can encode it, JPEG otherwise; both are far smaller than PNG.
  let dataUrl = canvas.toDataURL('image/webp', 0.86);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  canvas.width = 0;
  canvas.height = 0;
  if (dataUrl.length > APPEARANCE.limits.wallpaperUtf16)
    throw new Error('That image is too detailed to store as a wallpaper.');
  const name = file.name.replace(/[/\\]/g, '').slice(0, APPEARANCE.limits.wallpaperNameUtf16);
  return { dataUrl, name, width, height };
}
