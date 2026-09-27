/**
 * Language names and labels, with no grammar attached, so surfaces that only
 * show a language's name (the file header, a code block's label) never load
 * CodeMirror. Grammars live in `languages.ts`, loaded on demand.
 */

export const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  tsx: 'TypeScript JSX',
  javascript: 'JavaScript',
  jsx: 'JavaScript JSX',
  rust: 'Rust',
  python: 'Python',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  markdown: 'Markdown',
  toml: 'TOML',
  sql: 'SQL',
  yaml: 'YAML',
  shell: 'Shell',
  dockerfile: 'Dockerfile',
  dotenv: 'Environment',
  ini: 'INI',
  xml: 'XML',
  ignore: 'Ignore file',
  text: 'Plain text',
};

/** Names a fenced code block may use for each language. */
const FENCE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  node: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  rs: 'rust',
  rust: 'rust',
  py: 'python',
  python: 'python',
  python3: 'python',
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  svelte: 'html',
  vue: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sqlite: 'sql',
  postgres: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  toml: 'toml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  shellsession: 'shell',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  env: 'dotenv',
  dotenv: 'dotenv',
  ini: 'ini',
  xml: 'xml',
  svg: 'xml',
  gitignore: 'ignore',
};

/** The runtime language name for a fence's info string (```ts title="x"), or `null`. */
export function fenceLanguageName(info: string): string | null {
  const name =
    info
      .trim()
      .split(/[\s{,]/, 1)[0]
      ?.toLowerCase() ?? '';
  return FENCE_ALIASES[name] ?? null;
}
