/**
 * Recognizes a project file named in an agent's reply, such as
 * `src/math.ts:18` in inline code, so it can be offered as a link.
 *
 * Only names that look like files count: the last segment must have a
 * source-file extension or be a well-known file name. `pty.kill`, `a / b`
 * or `v1.2.3` stay code. A recognized name may still not exist; opening it
 * then reports that, the way any missing file does.
 */

export interface FileReference {
  /** Project-relative, without a leading `./`. */
  path: string;
  line?: number;
}

const EXTENSIONS = new Set(
  (
    'ts tsx mts cts js jsx mjs cjs json jsonc md mdx rs toml yaml yml css scss sass less html htm ' +
    'vue svelte astro py pyi go java kt kts swift m mm c h cc cpp hpp cs fs rb php sh bash zsh fish ' +
    'ps1 sql graphql gql proto txt lock env ini cfg conf xml svg csv tsv lua ex exs erl dart gradle ' +
    'zig nim r jl scala clj tf hcl nix dockerfile'
  ).split(' '),
);
const NAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Justfile',
  'Procfile',
  'Gemfile',
  'Rakefile',
  'README',
  'LICENSE',
  'CHANGELOG',
  'AGENTS.md',
  'CLAUDE.md',
]);

/** `path`, `path:18`, `path:18:4` or `path#L18`, with no spaces. */
const SHAPE = /^(\.\/)?([\w@.\-/+]+?)(?::(\d{1,7})(?::\d{1,5})?|#L(\d{1,7}))?$/;

export function fileReference(code: string): FileReference | null {
  if (code.length > 300 || code.includes('://')) return null;
  const match = SHAPE.exec(code.trim());
  if (!match) return null;
  const path = match[2] ?? '';
  if (path.startsWith('/') || path.endsWith('/') || path.split('/').includes('..')) return null;
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!NAMES.has(name) && !EXTENSIONS.has(extension)) return null;
  const line = Number(match[3] ?? match[4]);
  return line > 0 ? { path, line } : { path };
}

/** A `#L18` fragment on a Markdown file link. */
export function lineFromHash(hash?: string): number | undefined {
  const line = Number(/^L(\d{1,7})$/.exec(hash ?? '')?.[1]);
  return line > 0 ? line : undefined;
}
