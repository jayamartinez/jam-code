import type { BadgeTone } from '../state/chat-activity';

/**
 * The colours of the badge the OS draws over JAM's icon. They are brighter
 * than the in-app status roles on purpose: the badge sits on the taskbar,
 * outside any theme, and has to read at a glance.
 */
const COLOURS: Record<BadgeTone, string> = {
  input: '#F5A524',
  error: '#F2555A',
  finished: '#3DCB84',
};

/** The icon's size in device pixels: a 16-point taskbar or tray icon at this display's scale. */
export function badgeIconSize() {
  return Math.min(64, Math.max(16, Math.round(16 * (window.devicePixelRatio || 1))));
}

/** The tray badge's side for an icon of `size` pixels; the host uses the same rule. */
export const trayBadgeSize = (size: number) => Math.floor(size / 2);

/**
 * A coloured dot with a thin dark ring, drawn at exactly `size` device pixels
 * so the OS never rescales it; the dot fills `fill` of the square. Returns
 * RGBA pixels.
 */
export function drawBadge(tone: BadgeTone, size: number, fill = 1): number[] | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const radius = (size * fill) / 2;
    const ring = Math.max(1, size / 16);
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.beginPath();
    context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = COLOURS[tone];
    context.beginPath();
    context.arc(size / 2, size / 2, radius - ring, 0, Math.PI * 2);
    context.fill();
    return Array.from(context.getImageData(0, 0, size, size).data);
  } catch {
    return null;
  }
}
