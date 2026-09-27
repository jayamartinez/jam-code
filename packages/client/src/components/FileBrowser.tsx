import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { DirectoryEntry, JamTransport, Project } from '@jam/protocol';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import {
  FILE_ICON_THEMES,
  FILE_ICON_THEME_LABELS,
  FileIcon,
  FolderIcon,
  type FileIconTheme,
} from './file-icons';

/**
 * Project file tree.
 *
 * Directories are read one level at a time and only when they are expanded, so
 * opening this pane on a large repository never loads or renders the whole
 * tree. The runtime resolves every path; this component only ever holds
 * project-relative strings.
 */

type Listing =
  | { state: 'loading' }
  | { state: 'ready'; entries: DirectoryEntry[]; truncated: boolean }
  | { state: 'error'; message: string };

interface Row {
  entry: DirectoryEntry;
  depth: number;
  expanded: boolean;
}

const STATUS_MARK: Record<string, { letter: string; className: string; title: string }> = {
  added: { letter: 'A', className: 'status-added', title: 'Added' },
  modified: { letter: 'M', className: 'status-modified', title: 'Modified' },
  deleted: { letter: 'D', className: 'status-deleted', title: 'Deleted' },
  untracked: { letter: 'U', className: 'status-untracked', title: 'Untracked' },
};

/**
 * Directory listings are cached per project outside the component. A pane
 * remounts whenever the arrangement changes shape, and a repository tree must
 * not collapse or refetch just because a file opened beside it.
 */
const listingCache = new Map<string, Record<string, Listing>>();

export interface FileBrowserProps extends Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
> {
  transport: JamTransport;
  project?: Project;
  /** Project-relative path of the file currently open in the workspace. */
  selectedPath?: string;
  /** Expanded folders, owned by the client outside this pane's lifetime. */
  expanded: string[];
  /** Temporary icon-theme comparison, not a persisted product setting. */
  iconTheme: FileIconTheme;
  onIconTheme(next: FileIconTheme): void;
  onExpandedChange(next: string[]): void;
  onOpenFile(path: string): void;
}

export function FileBrowser({
  transport,
  project,
  selectedPath,
  expanded,
  onExpandedChange,
  iconTheme,
  onIconTheme,
  onOpenFile,
  ...chrome
}: FileBrowserProps) {
  const projectId = project?.id ?? '';
  const [listings, setListings] = useState<Record<string, Listing>>(
    () => listingCache.get(projectId) ?? {},
  );
  const [demo, setDemo] = useState(true);

  const load = useCallback(
    (path: string) => {
      setListings((current) => {
        if (current[path]?.state === 'ready') return current;
        const next = { ...current, [path]: { state: 'loading' as const } };
        listingCache.set(projectId, next);
        return next;
      });
      transport.request('directory.list', { projectId, path }).then(
        (listing) => {
          setDemo(listing.demo);
          setListings((current) => {
            const next = {
              ...current,
              [path]: {
                state: 'ready' as const,
                entries: listing.entries,
                truncated: listing.truncated,
              },
            };
            listingCache.set(projectId, next);
            return next;
          });
        },
        (error: unknown) => {
          setListings((current) => {
            const next = {
              ...current,
              [path]: {
                state: 'error' as const,
                message:
                  error instanceof Error ? error.message : 'This folder could not be listed.',
              },
            };
            listingCache.set(projectId, next);
            return next;
          });
        },
      );
    },
    [projectId, transport],
  );

  // Each project keeps its own cached tree; switching never shows stale paths.
  useEffect(() => {
    const cached = listingCache.get(projectId) ?? {};
    setListings(cached);
    if (projectId && cached['']?.state !== 'ready') load('');
    // Re-expanded folders that were never cached still need their listing.
    for (const path of expanded) if (!cached[path]) load(path);
    // `expanded` is client-owned and intentionally not a trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, load]);

  const toggle = (path: string) => {
    if (expanded.includes(path)) {
      onExpandedChange(expanded.filter((item) => item !== path));
      return;
    }
    if (!listings[path]) load(path);
    onExpandedChange([...expanded, path]);
  };

  /** Flatten only what is expanded: unexpanded folders cost nothing. */
  const rows = useMemo(() => {
    const output: Row[] = [];
    const walk = (path: string, depth: number) => {
      const listing = listings[path];
      if (listing?.state !== 'ready') return;
      for (const entry of listing.entries) {
        const isExpanded = expanded.includes(entry.path);
        output.push({ entry, depth, expanded: isExpanded });
        if (entry.kind === 'directory' && isExpanded) walk(entry.path, depth + 1);
      }
    };
    walk('', 0);
    return output;
  }, [expanded, listings]);

  const root = listings[''];
  // Only what has actually been listed can be counted, so this stays quiet
  // rather than claiming a repository-wide number it does not have.
  const changed = Object.values(listings)
    .flatMap((listing) => (listing.state === 'ready' ? listing.entries : []))
    .filter((entry) => entry.status).length;

  return (
    <PaneChrome
      {...chrome}
      className="file-browser-pane"
      label={`${project?.name ?? 'Project'} files`}
      heading={<strong className="file-browser-title">{project?.name ?? 'No project'}</strong>}
      status={
        <>
          <button
            type="button"
            className="icon-theme-switch"
            title={`File icon theme: ${FILE_ICON_THEME_LABELS[iconTheme]}. Click to compare the others.`}
            onClick={() =>
              onIconTheme(
                FILE_ICON_THEMES[
                  (FILE_ICON_THEMES.indexOf(iconTheme) + 1) % FILE_ICON_THEMES.length
                ]!,
              )
            }
          >
            {FILE_ICON_THEME_LABELS[iconTheme]}
          </button>
          {demo && <span className="demo-label">Demo tree</span>}
        </>
      }
    >
      <div className="file-tree" role="tree" aria-label={`${project?.name ?? 'Project'} files`}>
        {root?.state === 'loading' && (
          <p className="pane-state" role="status">
            Reading the project…
          </p>
        )}
        {root?.state === 'error' && (
          <p className="pane-state error" role="alert">
            {root.message}
          </p>
        )}
        {root?.state === 'ready' && !root.entries.length && (
          <p className="pane-state">This project has no files to show.</p>
        )}
        {rows.map((row) => {
          const { entry, depth } = row;
          const status = entry.status ? STATUS_MARK[entry.status] : undefined;
          const selected = entry.kind === 'file' && entry.path === selectedPath;
          const childListing = listings[entry.path];
          return (
            <div key={entry.path} className="file-tree-item">
              <button
                type="button"
                role="treeitem"
                aria-level={depth + 1}
                aria-selected={selected}
                aria-expanded={entry.kind === 'directory' ? row.expanded : undefined}
                className={`file-row ${entry.kind} ${selected ? 'selected' : ''} ${row.expanded ? 'expanded' : ''}`}
                style={{ paddingLeft: 8 + depth * 16 }}
                title={entry.path}
                onClick={() =>
                  entry.kind === 'directory' ? toggle(entry.path) : onOpenFile(entry.path)
                }
              >
                <span className="file-chevron" aria-hidden>
                  {entry.kind === 'directory' ? (row.expanded ? '▾' : '▸') : ''}
                </span>
                {entry.kind === 'directory' ? (
                  <FolderIcon name={entry.name} expanded={row.expanded} />
                ) : (
                  <FileIcon path={entry.path} />
                )}
                <span className="file-name truncate">{entry.name}</span>
                {status && (
                  <span className={`file-status mono ${status.className}`} title={status.title}>
                    {status.letter}
                  </span>
                )}
              </button>
              {row.expanded && childListing?.state === 'loading' && (
                <p className="file-row-note" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
                  Loading…
                </p>
              )}
              {row.expanded && childListing?.state === 'error' && (
                <p
                  className="file-row-note error"
                  role="alert"
                  style={{ paddingLeft: 8 + (depth + 1) * 16 }}
                >
                  {childListing.message}
                </p>
              )}
            </div>
          );
        })}
        {root?.state === 'ready' && root.truncated && (
          <p className="file-row-note">Only the first 500 entries of this folder are listed.</p>
        )}
      </div>
      <footer className="file-browser-footer" title={project?.branch}>
        <GitBranch size={11} aria-hidden />
        <span className="mono truncate">{project?.branch ?? '—'}</span>
        {changed > 0 && <span className="subtle">· {changed} changed</span>}
      </footer>
    </PaneChrome>
  );
}
