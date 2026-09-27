import { useCallback, useMemo, useRef } from 'react';
import { renderMarkdown } from '../markdown/render';
import type { LinkTarget } from '../markdown/links';
import type { FileReference } from '../markdown/file-refs';
import { CodeBlock } from './MarkdownPreview';
import { FileLink, type FileLinkActions } from './FileLink';

/**
 * An agent's reply rendered as Markdown through JAM's one renderer: no HTML,
 * no `innerHTML`, and links classified exactly as in repository Markdown.
 * Project files it names, as links or in inline code, become file links.
 * Loaded on demand, so a transcript with no agent text loads no parser.
 */
export default function AgentMarkdown({
  text,
  onOpenUrl,
  onOpenFile,
  onFileMenu,
}: {
  text: string;
  onOpenUrl?(url: string): void;
} & FileLinkActions) {
  const handlers = useRef({ onOpenUrl, onOpenFile, onFileMenu });
  handlers.current = { onOpenUrl, onOpenFile, onFileMenu };
  const onLink = useCallback((target: LinkTarget) => {
    if (target.kind === 'web') handlers.current.onOpenUrl?.(target.url);
    else if (target.kind === 'file') handlers.current.onOpenFile?.(target.path);
  }, []);
  // Stable callbacks that always reach the latest handlers.
  const actions = useMemo<FileLinkActions>(
    () => ({
      onOpenFile: (path, line) => handlers.current.onOpenFile?.(path, line),
      onFileMenu: (file, event) => handlers.current.onFileMenu?.(file, event),
    }),
    [],
  );
  const linksFiles = !!onOpenFile;
  const content = useMemo(
    () =>
      renderMarkdown(text, {
        // Agent replies refer to paths from the project root.
        directory: '',
        onLink,
        code: (code, info, key) => <CodeBlock key={key} code={code} info={info} />,
        ...(linksFiles && {
          fileLink: (file: FileReference, label, key) => (
            <FileLink key={key} file={file} actions={actions}>
              {label}
            </FileLink>
          ),
        }),
      }),
    [actions, linksFiles, onLink, text],
  );
  return <div className="markdown-body agent-markdown">{content}</div>;
}
