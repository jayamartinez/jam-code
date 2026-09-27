import { useCallback, useMemo, useRef } from 'react';
import { renderMarkdown } from '../markdown/render';
import type { LinkTarget } from '../markdown/links';
import { CodeBlock } from './MarkdownPreview';

/**
 * An agent's reply rendered as Markdown through JAM's one renderer: no HTML,
 * no `innerHTML`, and links classified exactly as in repository Markdown.
 * Loaded on demand, so a transcript with no agent text loads no parser.
 */
export default function AgentMarkdown({
  text,
  onOpenUrl,
  onOpenFile,
}: {
  text: string;
  onOpenUrl?(url: string): void;
  onOpenFile?(path: string): void;
}) {
  const handlers = useRef({ onOpenUrl, onOpenFile });
  handlers.current = { onOpenUrl, onOpenFile };
  const onLink = useCallback((target: LinkTarget) => {
    if (target.kind === 'web') handlers.current.onOpenUrl?.(target.url);
    else if (target.kind === 'file') handlers.current.onOpenFile?.(target.path);
  }, []);
  const content = useMemo(
    () =>
      renderMarkdown(text, {
        // Agent replies refer to paths from the project root.
        directory: '',
        onLink,
        code: (code, info, key) => <CodeBlock key={key} code={code} info={info} />,
      }),
    [onLink, text],
  );
  return <div className="markdown-body agent-markdown">{content}</div>;
}
