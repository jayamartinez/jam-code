import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { highlightCode } from '@lezer/highlight';
import { jamHighlighter } from '../code/highlight';
import { loadLanguage } from '../code/languages';
import { LANGUAGE_LABELS, fenceLanguageName } from '../code/names';
import { renderMarkdown } from '../markdown/render';
import type { LinkTarget } from '../markdown/links';

/**
 * The rendered view of a Markdown file.
 *
 * Loaded only when a Markdown file is shown in Preview, so markdown-it never
 * reaches a session that opens no Markdown. Prose uses the interface font at
 * reading size; code uses the reader's code font and the same highlighter and
 * `--syntax-*` roles as the editor.
 */

/** Longer blocks stay plain rather than hold up the preview. */
const HIGHLIGHT_LIMIT = 200_000;

type Span = [text: string, className: string];

function CodeBlock({ code, info }: { code: string; info: string }) {
  const language = fenceLanguageName(info);
  const [spans, setSpans] = useState<Span[] | null>(null);
  const [copied, setCopied] = useState(false);
  const text = code.endsWith('\n') ? code.slice(0, -1) : code;

  useEffect(() => {
    setSpans(null);
    if (!language || text.length > HIGHLIGHT_LIMIT) return;
    let live = true;
    void loadLanguage(language).then((support) => {
      if (!live || !support) return;
      const tree = support.language.parser.parse(text);
      const output: Span[] = [];
      highlightCode(
        text,
        tree,
        jamHighlighter,
        (piece, classes) => output.push([piece, classes]),
        () => output.push(['\n', '']),
      );
      setSpans(output);
    });
    return () => {
      live = false;
    };
  }, [language, text]);

  const label = language ? (LANGUAGE_LABELS[language] ?? language) : info.trim().split(/\s/, 1)[0];
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{label || 'Text'}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              })
              .catch(() => {});
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>
          {spans
            ? spans.map(([piece, className], index) =>
                className ? (
                  <span key={index} className={className}>
                    {piece}
                  </span>
                ) : (
                  piece
                ),
              )
            : text}
        </code>
      </pre>
    </div>
  );
}

export interface MarkdownPreviewProps {
  text: string;
  /** The file's project-relative path, for resolving relative links. */
  path: string;
  onOpenUrl?(url: string): void;
  onOpenFile?(path: string): void;
}

export default function MarkdownPreview({
  text,
  path,
  onOpenUrl,
  onOpenFile,
}: MarkdownPreviewProps) {
  const article = useRef<HTMLElement>(null);
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const handlers = useRef({ onOpenUrl, onOpenFile });
  handlers.current = { onOpenUrl, onOpenFile };

  const onLink = useCallback((target: LinkTarget) => {
    if (target.kind === 'anchor') {
      const heading = article.current?.querySelector(`#${CSS.escape(target.id)}`);
      heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else if (target.kind === 'web') handlers.current.onOpenUrl?.(target.url);
    else if (target.kind === 'file') handlers.current.onOpenFile?.(target.path);
  }, []);

  const content = useMemo(
    () =>
      renderMarkdown(text, {
        directory,
        onLink,
        code: (code, info, key) => <CodeBlock key={key} code={code} info={info} />,
      }),
    [directory, onLink, text],
  );

  return (
    <div className="markdown-scroll">
      <article className="markdown-body" ref={article}>
        {content}
      </article>
    </div>
  );
}
