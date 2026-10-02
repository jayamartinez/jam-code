import type { MouseEvent, ReactNode } from 'react';
import { ArrowUpRight, File, Paperclip } from 'lucide-react';
import type { FileReference } from '../markdown/file-refs';

export interface FileLinkActions {
  /** Opens the file beside the chat, at `line` when given. */
  onOpenFile?(path: string, line?: number): void;
  /** Right-click: open in a tab, reveal in the file manager, copy the path. */
  onFileMenu?(file: FileReference, event: MouseEvent): void;
}

/**
 * A project file named in a chat (Paper, "11 · File links"): a file icon,
 * link color and an underline so it reads as clickable; on hover the icon
 * becomes an arrow. Hover never changes its size. Click opens it beside the
 * chat; right-click offers more.
 */
export function FileLink({
  file,
  children,
  actions,
  className = '',
}: {
  file: FileReference;
  children?: ReactNode;
  actions: FileLinkActions;
  className?: string;
}) {
  const where = file.line ? `${file.path} · line ${file.line}` : file.path;
  if (!actions.onOpenFile) return <code>{children ?? file.path}</code>;
  return (
    <button
      type="button"
      className={`file-link ${className}`}
      title={`${where}\nClick to open beside · right-click for more`}
      onClick={(event) => {
        event.stopPropagation();
        actions.onOpenFile?.(file.path, file.line);
      }}
      onContextMenu={(event) => {
        if (!actions.onFileMenu) return;
        event.preventDefault();
        event.stopPropagation();
        actions.onFileMenu(file, event);
      }}
    >
      {/* One fixed slot: hover swaps the icon for the arrow without changing
          the link's width, so the reply never reflows under the pointer. */}
      <span className="file-link-glyph" aria-hidden="true">
        <File className="file-link-icon" size={12} strokeWidth={1.8} />
        <ArrowUpRight className="file-link-arrow" size={12} strokeWidth={1.8} />
      </span>
      <span className="file-link-label">{children ?? file.path}</span>
    </button>
  );
}

/**
 * A file attached in this chat, named in a reply. It looks like a file link
 * with a paperclip, and opens the attachment's preview rather than a pane.
 */
export function AttachmentLink({ name, onOpen }: { name: string; onOpen(): void }) {
  return (
    <button
      type="button"
      className="file-link"
      title={`${name}\nAttached in this chat · click to preview`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      <span className="file-link-glyph" aria-hidden="true">
        <Paperclip className="file-link-icon" size={12} strokeWidth={1.8} />
        <ArrowUpRight className="file-link-arrow" size={12} strokeWidth={1.8} />
      </span>
      <span className="file-link-label">{name}</span>
    </button>
  );
}
