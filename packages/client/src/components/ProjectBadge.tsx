import {
  Anchor,
  BookOpen,
  Bot,
  Box,
  Boxes,
  Brain,
  Bug,
  Camera,
  Cloud,
  Code,
  Coffee,
  Compass,
  Cpu,
  Database,
  Feather,
  Flame,
  FlaskConical,
  Gamepad2,
  GitBranch,
  Globe,
  Hammer,
  Heart,
  Key,
  Layers,
  Leaf,
  Moon,
  Mountain,
  Music,
  Palette,
  Puzzle,
  Rocket,
  Server,
  Shield,
  Sparkles,
  Sprout,
  SquareTerminal,
  Star,
  Sun,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Project } from '@jam/protocol';

/**
 * A project's badge.
 *
 * The default draws the project's initials exactly as the design's sidebar
 * row does: an 18px square at radius 5, a soft tint behind 9.5px semibold mono
 * on a 12px line. A project can instead show a preset glyph, an emoji, or an
 * image it supplies, in any of the shared tones. The square is fixed whatever
 * it holds, so repeated rows keep one lane.
 *
 * Preset names and tones come from the protocol's shared fixture, which the
 * runtime validates against too.
 */

export const PRESET_GLYPHS: Record<string, LucideIcon> = {
  rocket: Rocket,
  zap: Zap,
  flame: Flame,
  sparkles: Sparkles,
  star: Star,
  heart: Heart,
  leaf: Leaf,
  sprout: Sprout,
  mountain: Mountain,
  sun: Sun,
  moon: Moon,
  cloud: Cloud,
  globe: Globe,
  compass: Compass,
  anchor: Anchor,
  box: Box,
  boxes: Boxes,
  layers: Layers,
  code: Code,
  terminal: SquareTerminal,
  cpu: Cpu,
  database: Database,
  server: Server,
  'git-branch': GitBranch,
  bug: Bug,
  puzzle: Puzzle,
  shield: Shield,
  key: Key,
  wrench: Wrench,
  hammer: Hammer,
  flask: FlaskConical,
  palette: Palette,
  music: Music,
  camera: Camera,
  gamepad: Gamepad2,
  book: BookOpen,
  coffee: Coffee,
  bot: Bot,
  brain: Brain,
  feather: Feather,
};

/** Tone names map to CSS classes; every tone is built from semantic roles. */
export const TONE_LABELS: Record<string, string> = {
  blue: 'Blue',
  sky: 'Sky',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  clay: 'Clay',
  violet: 'Violet',
  silver: 'Silver',
};

export function ProjectBadge({
  project,
  size = 18,
  className = '',
}: {
  project?: Project;
  /** Fixed outer square so repeated rows keep one vertical lane. */
  size?: number;
  className?: string;
}) {
  const icon = project?.icon;
  const tone = icon?.tone ?? 'blue';
  const style = { '--badge-size': `${size}px` } as React.CSSProperties;

  if (icon?.kind === 'image' && icon.value)
    return (
      <span className={`project-badge image ${className}`} style={style} aria-hidden="true">
        {/* Already squared by the client before it was stored. */}
        <img src={icon.value} alt="" draggable={false} />
      </span>
    );

  if (icon?.kind === 'emoji' && icon.value)
    return (
      <span
        className={`project-badge emoji tone-${tone} ${className}`}
        style={{ ...style, fontSize: Math.round(size * 0.66) }}
        aria-hidden="true"
      >
        {icon.value}
      </span>
    );

  const Glyph = icon?.kind === 'preset' && icon.value ? PRESET_GLYPHS[icon.value] : undefined;
  if (Glyph)
    return (
      <span
        className={`project-badge preset tone-${tone} ${className}`}
        style={style}
        aria-hidden="true"
      >
        <Glyph size={Math.round(size * 0.64)} strokeWidth={2} />
      </span>
    );

  return (
    <span className={`project-badge tone-${tone} ${className}`} style={style} aria-hidden="true">
      {project?.initials ?? '—'}
    </span>
  );
}

/**
 * Square an arbitrary image in the browser before it is stored.
 *
 * The centre is cropped to a square and drawn at a fixed size, so a tall or
 * wide picture is never stretched and the stored record stays small.
 */
export async function squareProjectImage(file: File, size = 64): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is larger than 8 MB.');
  // Read as a data URL, not an object URL: the desktop content security
  // policy permits `data:` images and deliberately does not permit `blob:`,
  // so an object URL is refused by the WebView and the image never loads.
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('That image format could not be decoded.'));
    element.src = source;
  });
  // An SVG without intrinsic dimensions reports zero; draw it at the target size.
  const width = image.naturalWidth || size;
  const height = image.naturalHeight || size;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This window cannot resize the image.');
  const edge = Math.min(width, height);
  const draw = () =>
    context.drawImage(image, (width - edge) / 2, (height - edge) / 2, edge, edge, 0, 0, size, size);
  draw();
  // A dark mark on a transparent background (a monochrome logo, say) would
  // vanish on JAM's dark badges, so it is redrawn on a light backing.
  const pixels = context.getImageData(0, 0, size, size).data;
  let transparent = 0;
  let opaque = 0;
  let light = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 200) transparent += 1;
    else {
      opaque += 1;
      light += (0.2126 * pixels[i]! + 0.7152 * pixels[i + 1]! + 0.0722 * pixels[i + 2]!) / 255;
    }
  }
  if (transparent > size && opaque && light / opaque < 0.3) {
    context.clearRect(0, 0, size, size);
    context.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--color-text-body').trim() ||
      'white';
    context.fillRect(0, 0, size, size);
    draw();
  }
  return canvas.toDataURL('image/png');
}
