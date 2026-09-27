import { describe, expect, it } from 'vitest';
import { highlightCode } from '@lezer/highlight';
import languageCases from '../../../protocol/fixtures/languages.json';
import { jamHighlighter } from './highlight';
import { loadLanguage } from './languages';
import { LANGUAGE_LABELS, fenceLanguageName } from './names';

const SAMPLES: Record<string, string> = {
  typescript: 'export const answer: number = 42; // done',
  tsx: 'const view = <Pane title="x">{count}</Pane>;',
  javascript: 'function add(a, b) { return a + b; }',
  jsx: 'const b = <button onClick={go}>Go</button>;',
  rust: 'fn main() { let x: u32 = 1; println!("{x}"); }',
  python: 'def greet(name: str) -> str:\n    return f"hi {name}"  # comment',
  json: '{ "name": "jam", "private": true, "version": 1 }',
  css: '.pane { color: var(--color-text-body); padding: 4px; }',
  html: '<main class="app"><h1>jam</h1></main>',
  yaml: 'name: ci\non:\n  push: [main]',
  sql: 'SELECT id, title FROM resources WHERE pinned = 1;',
  markdown: '# Title\n\nSome *emphasis* and `code`.\n\n```ts\nconst a = 1;\n```',
  toml: '[package]\nname = "jam"\nversion = "0.1.0"',
  shell: 'if [ -n "$HOME" ]; then echo "$HOME"; fi # home',
  dockerfile: 'FROM node:22\nRUN pnpm install\nCMD ["pnpm", "dev"]',
  dotenv: '# secrets stay local\nAPI_URL=http://localhost:3000',
  ini: '[core]\n  autocrlf = false',
  xml: '<svg viewBox="0 0 16 16"><path d="M0 0"/></svg>',
  ignore: '# build output\ndist/\n!dist/keep',
};

describe('language support', () => {
  it('has a grammar and a label for every language the runtime can name', async () => {
    const names = new Set((languageCases.cases as [string, string][]).map(([, name]) => name));
    for (const name of names) {
      expect(LANGUAGE_LABELS[name], name).toBeTruthy();
      if (name === 'text') {
        expect(await loadLanguage(name)).toBeNull();
        continue;
      }
      const support = await loadLanguage(name);
      expect(support, name).not.toBeNull();
      const sample = SAMPLES[name]!;
      const tree = support!.language.parser.parse(sample);
      const classes = new Set<string>();
      highlightCode(
        sample,
        tree,
        jamHighlighter,
        (_, kind) => kind && classes.add(kind),
        () => {},
      );
      // Every grammar produces semantic classes, not a single plain run.
      expect(
        [...classes].some((kind) => kind.startsWith('syntax-')),
        name,
      ).toBe(true);
    }
  });

  it('returns plain text for an unknown language instead of guessing', async () => {
    expect(await loadLanguage('brainfuck')).toBeNull();
  });

  it('reads fence info strings, including aliases and attributes', () => {
    expect(fenceLanguageName('ts')).toBe('typescript');
    expect(fenceLanguageName('TSX')).toBe('tsx');
    expect(fenceLanguageName('bash title="install"')).toBe('shell');
    expect(fenceLanguageName('rust,ignore')).toBe('rust');
    expect(fenceLanguageName('py{linenos}')).toBe('python');
    expect(fenceLanguageName('mermaid')).toBeNull();
    expect(fenceLanguageName('')).toBeNull();
  });
});
