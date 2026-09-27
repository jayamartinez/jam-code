/**
 * Path classification, shared by every icon theme.
 *
 * Both themes resolve the same key for the same path, so switching themes
 * changes artwork only — never which files are distinguished from which.
 */

export type IconKey =
  | 'folder'
  | 'folder-open'
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'rust'
  | 'python'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'yaml'
  | 'shell'
  | 'image'
  | 'git'
  | 'manifest'
  | 'lockfile'
  | 'config'
  | 'file';

/** Whole filenames that mean more than their extension does. */
const BY_NAME: Record<string, IconKey> = {
  'package.json': 'manifest',
  'package-lock.json': 'lockfile',
  'pnpm-lock.yaml': 'lockfile',
  'yarn.lock': 'lockfile',
  'bun.lockb': 'lockfile',
  'cargo.toml': 'rust',
  'cargo.lock': 'lockfile',
  'pyproject.toml': 'python',
  'poetry.lock': 'lockfile',
  'requirements.txt': 'python',
  'go.mod': 'manifest',
  'go.sum': 'lockfile',
  'gemfile.lock': 'lockfile',
  'composer.lock': 'lockfile',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.git': 'git',
  dockerfile: 'config',
  makefile: 'config',
  '.editorconfig': 'config',
  '.npmrc': 'config',
  '.nvmrc': 'config',
  '.prettierrc': 'config',
  '.prettierrc.json': 'config',
  '.env': 'config',
};

const BY_EXTENSION: Record<string, IconKey> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  rs: 'rust',
  py: 'python',
  pyi: 'python',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  ico: 'image',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'config',
  ini: 'config',
  conf: 'config',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'shell',
};

export function iconKeyForFile(path: string): IconKey {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (name.startsWith('.git')) return 'git';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'file';
  // `registry.test.ts` should read as TypeScript, not as an unknown suffix.
  return BY_EXTENSION[name.slice(dot + 1)] ?? 'file';
}

export const iconKeyForFolder = (expanded: boolean): IconKey =>
  expanded ? 'folder-open' : 'folder';
