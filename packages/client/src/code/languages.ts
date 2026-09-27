import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import type { StreamParser } from '@codemirror/language';
import { fenceLanguageName } from './names';

/**
 * Language support, loaded on demand.
 *
 * The runtime names a file's language from its name (see `language_for`);
 * this module turns that name into a CodeMirror grammar. Each grammar is its
 * own chunk, imported the first time a file of that kind is shown, so opening
 * one TypeScript file never downloads Python or SQL. Unknown names are plain
 * text rather than a guess.
 */

const legacy = <T>(parser: StreamParser<T>) => new LanguageSupport(StreamLanguage.define(parser));

/** `.gitignore` and friends: comments, negations and patterns. */
const ignoreFile: StreamParser<null> = {
  name: 'ignore',
  token(stream) {
    if (stream.sol() && stream.match(/^\s*#.*/)) return 'comment';
    if (stream.sol() && stream.eat('!')) return 'operator';
    stream.skipToEnd();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

const loaders: Record<string, () => Promise<LanguageSupport>> = {
  typescript: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript: true }),
  tsx: async () =>
    (await import('@codemirror/lang-javascript')).javascript({ typescript: true, jsx: true }),
  javascript: async () => (await import('@codemirror/lang-javascript')).javascript(),
  jsx: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  json: async () => (await import('@codemirror/lang-json')).json(),
  rust: async () => (await import('@codemirror/lang-rust')).rust(),
  python: async () => (await import('@codemirror/lang-python')).python(),
  css: async () => (await import('@codemirror/lang-css')).css(),
  html: async () => (await import('@codemirror/lang-html')).html(),
  yaml: async () => (await import('@codemirror/lang-yaml')).yaml(),
  sql: async () => (await import('@codemirror/lang-sql')).sql(),
  markdown: async () => {
    const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown');
    // GitHub-flavoured (tables, task lists, strikethrough), with fenced code
    // highlighted through these same lazy loaders.
    return markdown({ base: markdownLanguage, codeLanguages: fenceLanguage });
  },
  toml: async () => legacy((await import('@codemirror/legacy-modes/mode/toml')).toml),
  shell: async () => legacy((await import('@codemirror/legacy-modes/mode/shell')).shell),
  dockerfile: async () =>
    legacy((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile),
  dotenv: async () => legacy((await import('@codemirror/legacy-modes/mode/properties')).properties),
  ini: async () => legacy((await import('@codemirror/legacy-modes/mode/properties')).properties),
  xml: async () => legacy((await import('@codemirror/legacy-modes/mode/xml')).xml),
  ignore: async () => legacy(ignoreFile),
};

const cache = new Map<string, Promise<LanguageSupport | null>>();

/** The grammar for a runtime language name, or `null` for plain text. */
export function loadLanguage(language: string): Promise<LanguageSupport | null> {
  const loader = loaders[language];
  if (!loader) return Promise.resolve(null);
  let pending = cache.get(language);
  if (!pending) {
    pending = loader().catch(() => {
      // A chunk that failed to load may succeed next time.
      cache.delete(language);
      return null;
    });
    cache.set(language, pending);
  }
  return pending;
}

const descriptions = new Map<string, LanguageDescription>();

/** CodeMirror's hook for fenced code in Markdown source. */
function fenceLanguage(info: string): LanguageDescription | null {
  const language = fenceLanguageName(info);
  if (!language || language === 'markdown') return null;
  let description = descriptions.get(language);
  if (!description) {
    description = LanguageDescription.of({
      name: language,
      load: async () => (await loadLanguage(language)) ?? Promise.reject(new Error(language)),
    });
    descriptions.set(language, description);
  }
  return description;
}
