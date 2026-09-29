import type { BadgeTone } from '../state/chat-activity';

/**
 * The colours of the badge the OS draws over JAM's icon. They are brighter
 * than the in-app status roles on purpose: the badge sits on the taskbar,
 * outside any theme, and has to read at 16 points.
 */
const TONES: Record<BadgeTone, { fill: string; text: string }> = {
  input: { fill: '#F5A524', text: '#FFFFFF' },
  error: { fill: '#F2555A', text: '#FFFFFF' },
  finished: { fill: '#3DCB84', text: '#FFFFFF' },
};

/** The icon's size in device pixels: a 16-point taskbar or tray icon at this display's scale. */
export function badgeIconSize() {
  return Math.min(64, Math.max(16, Math.round(16 * (window.devicePixelRatio || 1))));
}

/** The tray badge's side for an icon of `size` pixels; the host uses the same rule. */
export const trayBadgeSize = (size: number) => Math.floor((size * 5) / 8);

/**
 * A count in a coloured circle with a thin dark ring, drawn at exactly `size`
 * device pixels so the OS never rescales it. Returns RGBA pixels.
 */
export function drawBadge(count: number, tone: BadgeTone, size: number): number[] | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const colours = TONES[tone];
    const half = size / 2;
    const ring = Math.max(1, size / 16);
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.beginPath();
    context.arc(half, half, half, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = colours.fill;
    context.beginPath();
    context.arc(half, half, half - ring, 0, Math.PI * 2);
    context.fill();
    const label = count > 9 ? '9+' : String(count);
    context.fillStyle = colours.text;
    context.font = `700 ${Math.round(size * (label.length > 1 ? 0.4 : 0.5))}px "Segoe UI", system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, half, half + size * 0.03);
    return Array.from(context.getImageData(0, 0, size, size).data);
  } catch {
    return null;
  }
}
