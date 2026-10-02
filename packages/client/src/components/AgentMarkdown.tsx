import { useCallback, useMemo, useRef } from 'react';
import { renderMarkdown } from '../markdown/render';
import type { LinkTarget } from '../markdown/links';
import type { FileReference } from '../markdown/file-refs';
import { CodeBlock } from './MarkdownPreview';
import type { ContextItem } from '@jam/protocol';
import { AttachmentLink, FileLink, type FileLinkActions } from './FileLink';
import { attachmentNamed } from './attachment-model';

/**
 * An agent's reply rendered as Markdown through JAM's one renderer: no HTML,
 * no `innerHTML`, and links classified exactly as in repository Markdown.
 * Project files it names, as links or in inline code, become file links, and
 * a file attached in the chat, named in inline code, opens its preview.
 * Loaded on demand, so a transcript with no agent text loads no parser.
 */
export default function AgentMarkdown({
  text,
  onOpenUrl,
  onOpenFile,
  onFileMenu,
  attachments,
  onPreviewAttachment,
}: {
  text: string;
  onOpenUrl?(url: string): void;
  /** Files sent in this conversation. Keep the array stable between renders. */
  attachments?: readonly ContextItem[];
  onPreviewAttachment?(item: ContextItem): void;
} & FileLinkActions) {
  const handlers = useRef({ onOpenUrl, onOpenFile, onFileMenu, onPreviewAttachment });
  handlers.current = { onOpenUrl, onOpenFile, onFileMenu, onPreviewAttachment };
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
  const linked = onPreviewAttachment && attachments?.length ? attachments : undefined;
  const content = useMemo(
    () =>
      renderMarkdown(text, {
        // Agent replies refer to paths from the project root.
        directory: '',
        onLink,
        code: (code, info, key) => <CodeBlock key={key} code={code} info={info} />,
        ...(linked && {
          inlineCode: (code: string, key: number) => {
            const item = attachmentNamed(code, linked);
            return item ? (
              <AttachmentLink
                key={key}
                name={item.label}
                onOpen={() => handlers.current.onPreviewAttachment?.(item)}
              />
            ) : undefined;
          },
        }),
        ...(linksFiles && {
          fileLink: (file: FileReference, label, key) => (
            <FileLink key={key} file={file} actions={actions}>
              {label}
            </FileLink>
          ),
        }),
      }),
    [actions, linked, linksFiles, onLink, text],
  );
  return <div className="markdown-body agent-markdown">{content}</div>;
}
