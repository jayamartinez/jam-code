import type { MouseEvent, ReactNode } from 'react';
import { ArrowUpRight, File } from 'lucide-react';
import type { FileReference } from '../markdown/file-refs';

export interface FileLinkActions {
  /** Opens the file beside the chat, at `line` when given. */
  onOpenFile?(path: string, line?: number): void;
  /** Right-click: open in a tab, reveal in the file manager, copy the path. */
  onFileMenu?(file: FileReference, event: MouseEvent): void;
}

/**
 * A project file named in a chat (Paper, "11 · File links"): a file icon,
 * link colour and an underline so it reads as clickable, with an arrow on
 * hover. Click opens it beside the chat; right-click offers more.
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
      <File className="file-link-icon" size={12} strokeWidth={1.8} aria-hidden="true" />
      <span className="file-link-label">{children ?? file.path}</span>
      <ArrowUpRight className="file-link-arrow" size={11} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
