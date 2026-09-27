import { useEffect, useState, useSyncExternalStore } from 'react';
import { gitBranchLabel, type GitDiffSide, type GitFileDiff, type Resource } from '@jam/protocol';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { ResourceIcon } from './icons';
import type { GitClient } from '../state/git-client';
import '../styles/review.css';
import { ReviewPatch } from './ReviewPatch';

type Chrome = Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
>;
export default function ReviewResource({
  git,
  resource,
  chrome,
  onOpenFile,
}: {
  git: GitClient;
  resource: Resource;
  chrome: Chrome;
  onOpenFile(path: string): void;
}) {
  useSyncExternalStore(git.subscribe, git.getSnapshot, git.getSnapshot);
  const projectId = resource.projectId ?? '';
  const state = git.get(projectId);
  const status = state.status;
  const [selected, setSelected] = useState(() => git.selection(resource.id)?.path ?? '');
  const [side, setSide] = useState<GitDiffSide>(
    () => git.selection(resource.id)?.side ?? 'unstaged',
  );
  const [loadedDiff, setDiff] = useState<GitFileDiff>();
  const [error, setError] = useState<string>();
  const [mutationError, setMutationError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const files = status?.files ?? [];
  const file = files.find((item) => item.path === selected) ?? files[0];
  const path = file?.path;
  const effectiveSide =
    file && (side === 'staged' ? file.staged === 'none' : file.workingTree === 'none')
      ? side === 'staged'
        ? 'unstaged'
        : 'staged'
      : side;
  const diff =
    loadedDiff && loadedDiff.path === path && loadedDiff.side === effectiveSide
      ? loadedDiff
      : undefined;
  useEffect(() => {
    void git.refresh(projectId);
  }, [git, projectId]);
  useEffect(() => {
    let current = true;
    setDiff(undefined);
    setError(undefined);
    if (!path || state.loading) {
      setLoading(state.loading);
      return;
    }
    setLoading(true);
    git.transport
      .request('git.diff', { projectId, path, side: effectiveSide })
      .then(
        (result) => {
          if (current) setDiff(result);
        },
        (cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : 'Diff unavailable.');
        },
      )
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [git, projectId, path, effectiveSide, state.revision, state.loading]);
  const mutate = async () => {
    if (!file) return;
    setBusy(true);
    setMutationError(undefined);
    try {
      await git.setStaged(projectId, file.path, effectiveSide !== 'staged');
    } catch (cause) {
      setMutationError(cause instanceof Error ? cause.message : 'Git operation failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <PaneChrome
      {...chrome}
      className="diff-pane"
      label="Review changes"
      heading={
        <>
          <ResourceIcon kind="diff" />
          <strong>Review changes</strong>
          <span className="mono subtle">
            {state.error ? 'Git unavailable' : gitBranchLabel(status)}
          </span>
        </>
      }
      status={
        <button
          className="button"
          disabled={state.loading || busy}
          onClick={() => void git.refresh(projectId)}
        >
          {state.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      {mutationError && (
        <p className="pane-footnote error" role="alert">
          {mutationError}
        </p>
      )}
      {state.error && (
        <p className="pane-footnote error" role="alert">
          {state.error}
        </p>
      )}
      {status?.state !== 'repository' ? (
        <div className="pane-state" role="status">
          {status?.state === 'no-folder'
            ? 'Add a local folder in project details to review its changes.'
            : status?.state === 'not-repository'
              ? 'This project folder is not a Git repository.'
              : status?.state === 'unavailable'
                ? 'Git review is available in the jam desktop app.'
                : state.loading
                  ? 'Reading repository…'
                  : 'Repository unavailable.'}
        </div>
      ) : (
        <>
          <div className="review-summary">
            <span>
              {files.length}
              {status.truncated ? '+' : ''} changed files · uncommitted
            </span>
            <span className="mono truncate" title={status.repositoryRoot}>
              {status.repositoryRoot}
            </span>
          </div>
          {!files.length ? (
            <div className="pane-state" role="status">
              Working tree clean. No changes to review.
            </div>
          ) : (
            <div className="review-body">
              <nav className="review-files" aria-label="Changed files">
                <div className="review-files-label">Files</div>
                {files.map((item) => (
                  <button
                    key={item.path}
                    className={`review-file ${item.path === path ? 'selected' : ''}`}
                    aria-current={item.path === path ? 'true' : undefined}
                    title={item.previousPath ? `${item.previousPath} → ${item.path}` : item.path}
                    onClick={() => {
                      git.select(
                        resource.id,
                        item.path,
                        item.workingTree !== 'none' ? 'unstaged' : 'staged',
                      );
                      setSelected(item.path);
                      setSide(item.workingTree !== 'none' ? 'unstaged' : 'staged');
                    }}
                  >
                    <span className="review-file-title">
                      <span className="mono truncate">{item.path.split('/').at(-1)}</span>
                      {item.path === path && diff && !diff.binary && (
                        <small className="mono">
                          +{diff.additions} −{diff.deletions}
                          {diff.truncated ? '…' : ''}
                        </small>
                      )}
                    </span>
                    <small className="truncate">
                      {item.path.slice(0, item.path.lastIndexOf('/') + 1) || './'} ·{' '}
                      {item.conflict
                        ? 'Conflict'
                        : item.untracked
                          ? 'Untracked'
                          : [
                              item.staged !== 'none' ? `Staged ${item.staged}` : '',
                              item.workingTree !== 'none' ? `Unstaged ${item.workingTree}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                    </small>
                  </button>
                ))}
                {status.truncated && (
                  <p className="pane-footnote">Showing the first 2,000 files.</p>
                )}
              </nav>
              <section className="review-diff" aria-label="Selected file diff">
                <div className="review-file-header">
                  <span className="mono truncate" title={path}>
                    {path}
                  </span>
                  {diff && !diff.binary && (
                    <span className="review-counts">
                      <span className="success">+{diff.additions}</span>{' '}
                      <span className="danger">−{diff.deletions}</span>
                      {diff.truncated && ' (shown)'}
                    </span>
                  )}
                  <button
                    className="button"
                    disabled={!file?.filePath || file.workingTree === 'deleted' || busy}
                    onClick={() => {
                      if (file?.filePath) onOpenFile(file.filePath);
                    }}
                  >
                    Open file
                  </button>
                </div>
                <div className="review-actions">
                  <div role="group" aria-label="Diff version">
                    {(['unstaged', 'staged'] as const).map((value) => (
                      <button
                        key={value}
                        className={`button ${effectiveSide === value ? 'active' : ''}`}
                        aria-pressed={effectiveSide === value}
                        disabled={
                          busy ||
                          (value === 'staged'
                            ? file?.staged === 'none'
                            : file?.workingTree === 'none')
                        }
                        onClick={() => {
                          setSide(value);
                          if (path) git.select(resource.id, path, value);
                        }}
                      >
                        {value === 'staged' ? 'Staged' : 'Unstaged'}
                      </button>
                    ))}
                  </div>
                  <button
                    className="button"
                    disabled={busy || loading || !diff || file?.conflict || file?.submodule}
                    onClick={() => void mutate()}
                  >
                    {busy
                      ? 'Updating…'
                      : effectiveSide === 'staged'
                        ? 'Unstage file'
                        : 'Stage file'}
                  </button>
                </div>
                {error && (
                  <p className="pane-footnote error" role="alert">
                    {error}
                  </p>
                )}
                {loading && (
                  <div className="pane-state" role="status">
                    Reading diff…
                  </div>
                )}
                {diff && <ReviewPatch diff={diff} />}
              </section>
            </div>
          )}
        </>
      )}
    </PaneChrome>
  );
}
