import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type { FileContents, JamTransport, Project, Resource } from '@jam/protocol';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { LANGUAGE_LABELS } from '../code/names';
import { useMarkdownMode } from '../state/markdown-mode';

const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'));
const MarkdownPreview = lazy(() => import('./MarkdownPreview'));

/**
 * A normal file, not a diff.
 *
 * The File resource shows a working copy of one file with its own path
 * metadata and editor surface; Review renders changes between revisions. They
 * are separate resources on purpose and must not look alike.
 *
 * CodeMirror stays behind this component: it is loaded only when a File pane
 * is actually rendered, and everything above it deals in JAM concepts.
 */

type Load =
  | { state: 'loading' }
  | { state: 'ready'; file: FileContents }
  | { state: 'error'; message: string };

export interface FileResourceProps extends Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
> {
  transport: JamTransport;
  resource: Resource;
  project?: Project;
  saveShortcut: string;
  /** A Markdown preview link to a web page; JAM opens it in a Browser resource. */
  onOpenUrl?(url: string): void;
  /** A Markdown preview link to another file in the same project. */
  onOpenFile?(path: string): void;
  /** A line to show, such as one a chat linked to. */
  reveal?: { line: number; key: number };
}

export function FileResource({
  transport,
  resource,
  project,
  saveShortcut,
  onOpenUrl,
  onOpenFile,
  reveal,
  ...chrome
}: FileResourceProps) {
  const [markdownMode, setMarkdownMode] = useMarkdownMode(resource.id);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  draftRef.current = draft;
  const path = resource.path ?? '';
  const projectId = resource.projectId ?? '';
  const worktreeId = resource.worktreeId;

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: 'loading' });
    setDraft(null);
    setSaveError(null);
    transport.request('file.read', { projectId, path, ...(worktreeId ? { worktreeId } : {}) }).then(
      (file) => {
        if (!cancelled) setLoad({ state: 'ready', file });
      },
      (error: unknown) => {
        if (!cancelled)
          setLoad({
            state: 'error',
            message: error instanceof Error ? error.message : 'This file could not be read.',
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, worktreeId, path, transport]);

  const file = load.state === 'ready' ? load.file : undefined;
  const dirty = draft !== null && file !== undefined && draft !== file.text;

  const save = useCallback(async () => {
    const text = draftRef.current;
    if (text === null || !file?.writable || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await transport.request('file.write', { projectId, path, text });
      // The saved copy becomes the baseline, so the pane is clean again.
      setLoad((current) =>
        current.state === 'ready' ? { state: 'ready', file: { ...current.file, text } } : current,
      );
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'This file could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [file?.writable, path, projectId, saving, transport]);

  const directory = path.slice(0, path.lastIndexOf('/') + 1);
  const name = path.slice(path.lastIndexOf('/') + 1);
  const markdown = file?.language === 'markdown';
  const preview = markdown && markdownMode === 'preview';

  return (
    <PaneChrome
      {...chrome}
      className="file-pane"
      label={`${name || resource.title} file`}
      heading={
        <span className="file-path mono">
          <span className="file-path-directory">{directory.replaceAll('/', ' / ')}</span>
          <span className="file-path-name">{name || resource.title}</span>
          {dirty && (
            <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />
          )}
        </span>
      }
      status={
        file ? (
          <span className="file-meta">
            {markdown && (
              <span className="view-capsule" role="group" aria-label="Markdown view">
                {(['preview', 'source'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={markdownMode === mode ? 'active' : ''}
                    aria-pressed={markdownMode === mode}
                    onClick={() => setMarkdownMode(mode)}
                  >
                    {mode === 'preview' ? 'Preview' : 'Source'}
                  </button>
                ))}
              </span>
            )}
            <span>{LANGUAGE_LABELS[file.language] ?? file.language}</span>
            <span className="separator">·</span>
            {file.writable ? (
              <button
                type="button"
                className="file-save"
                disabled={!dirty || saving}
                onClick={() => void save()}
                title={`Save ${name} (${saveShortcut} S)`}
              >
                {saving ? 'Saving…' : dirty ? `Save ${saveShortcut} S` : 'Saved'}
              </button>
            ) : (
              <span>Read-only</span>
            )}
            {file.demo && <span className="demo-label">Demo tree</span>}
          </span>
        ) : null
      }
    >
      {load.state === 'loading' && (
        <div className="pane-state" role="status">
          Reading {name || 'file'}…
        </div>
      )}
      {load.state === 'error' && (
        <div className="pane-state error" role="alert">
          <p>{load.message}</p>
          <p className="subtle">
            {project?.name ?? 'This project'} · <code className="mono">{path}</code>
          </p>
        </div>
      )}
      {saveError && (
        <p className="pane-footnote error" role="alert">
          {saveError}
        </p>
      )}
      {file && !file.text && draft === null && (
        <div className="pane-state" role="status">
          This file is empty.
        </div>
      )}
      {file && preview && (file.text || draft !== null) && (
        <Suspense fallback={<div className="pane-state">Rendering {name}…</div>}>
          <MarkdownPreview
            text={draft ?? file.text}
            path={path}
            {...(onOpenUrl ? { onOpenUrl } : {})}
            {...(onOpenFile ? { onOpenFile } : {})}
          />
        </Suspense>
      )}
      {file && !preview && (file.text || draft !== null) && (
        <Suspense fallback={<div className="pane-state">Loading the editor…</div>}>
          <CodeMirrorEditor
            text={draft ?? file.text}
            language={file.language}
            editable={file.writable}
            onChange={setDraft}
            onSave={() => void save()}
            reveal={reveal}
          />
        </Suspense>
      )}
      {file?.truncated && (
        <p className="pane-footnote">
          Only the first part of this file is shown. Paging large files is not implemented.
        </p>
      )}
    </PaneChrome>
  );
}
