/**
 * What a Markdown link or image may do.
 *
 * Repository Markdown is untrusted, so every destination is classified before
 * anything is rendered, and only four outcomes exist:
 *
 * - `anchor`: a heading in the same document, scrolled to in place.
 * - `web`: an http(s) page, opened in a JAM Browser resource — the isolated
 *   native view with its own profile — never in JAM's own window.
 * - `file`: a path inside the same project, opened as a File resource. The
 *   path is resolved against the document and may not climb out of the
 *   project root.
 * - `none`: everything else (`javascript:`, `data:` documents, `file:`,
 *   `tauri:`, custom schemes, malformed input) is shown as text only.
 *
 * Images are stricter: only inline raster `data:` images load. Remote images
 * are not fetched (they would load from the reader's machine, which is how
 * tracking pixels work, and the content policy blocks them anyway) and
 * project images wait for a binary file service; both render as a labelled
 * placeholder.
 */

export type LinkTarget =
  | { kind: 'anchor'; id: string }
  | { kind: 'web'; url: string }
  | { kind: 'file'; path: string; hash?: string }
  | { kind: 'none' };

export type ImageSource =
  | { kind: 'inline'; src: string }
  | { kind: 'web'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'none' };

const SCHEME = /^[a-z][a-z\d+.-]*:/i;
const INLINE_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z\d+/]+=*$/i;
/** Drops control characters and whitespace, which a browser would strip from a scheme. */
const visible = (value: string) =>
  [...value]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
    .join('');

/** GitHub-style heading slugs, prefixed so they never collide with JAM's own IDs. */
export function headingId(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return `md-${count ? `${base}-${count}` : base}`;
}

/** Resolves `relative` against the directory `base` (project-relative), refusing to leave the project. */
export function resolveProjectPath(base: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.length ? segments.join('/') : null;
}

function web(href: string): string | null {
  try {
    const url = new URL(href);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** `directory` is the Markdown file's own folder, project-relative, without a trailing slash. */
export function classifyLink(href: string, directory: string): LinkTarget {
  const target = href.trim();
  if (!target) return { kind: 'none' };
  if (target.startsWith('#')) {
    const id = target.slice(1);
    return id ? { kind: 'anchor', id: `md-${decodeSafely(id).toLowerCase()}` } : { kind: 'none' };
  }
  if (target.startsWith('//')) return { kind: 'none' };
  if (SCHEME.test(visible(target))) {
    const url = web(target);
    return url ? { kind: 'web', url } : { kind: 'none' };
  }
  const [pathPart = '', hash] = target.split('#', 2);
  const [pathOnly = ''] = pathPart.split('?', 1);
  const path = resolveProjectPath(directory, pathOnly);
  if (!path) return { kind: 'none' };
  return hash ? { kind: 'file', path, hash } : { kind: 'file', path };
}

export function classifyImage(src: string, directory: string): ImageSource {
  const target = src.trim();
  if (INLINE_IMAGE.test(target)) return { kind: 'inline', src: target };
  if (SCHEME.test(visible(target)) || target.startsWith('//')) {
    const url = web(target.startsWith('//') ? `https:${target}` : target);
    return url ? { kind: 'web', url } : { kind: 'none' };
  }
  const path = resolveProjectPath(directory, target.split(/[?#]/, 1)[0] ?? '');
  return path ? { kind: 'file', path } : { kind: 'none' };
}

function decodeSafely(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
