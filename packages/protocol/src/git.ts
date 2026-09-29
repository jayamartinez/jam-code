/** Git paths are repository-relative; filePath is scoped to the project folder. */
export type GitChange =
  | 'none'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked';
export type GitDiffSide = 'staged' | 'unstaged';
export interface GitFileStatus {
  path: string;
  previousPath?: string;
  filePath?: string;
  staged: GitChange;
  workingTree: GitChange;
  untracked: boolean;
  conflict: boolean;
  submodule: boolean;
}
export interface GitStatus {
  projectId: string;
  /** Present when the status is of one of the project's JAM worktrees. */
  worktreeId?: string;
  state: 'repository' | 'not-repository' | 'no-folder' | 'unavailable';
  repositoryRoot?: string;
  branch?: string;
  head?: string;
  detached: boolean;
  unborn: boolean;
  files: GitFileStatus[];
  truncated: boolean;
}
export interface GitDiffLine {
  kind: 'context' | 'addition' | 'deletion' | 'notice';
  text: string;
  oldLine?: number;
  newLine?: number;
}
export interface GitDiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitDiffLine[];
}
export interface GitFileDiff {
  projectId: string;
  path: string;
  side: GitDiffSide;
  file: GitFileStatus;
  binary: boolean;
  truncated: boolean;
  additions: number;
  deletions: number;
  hunks: GitDiffHunk[];
  metadata: string[];
}
export interface GitBranch {
  /** Short name: `main`, or `origin/main` for a remote-tracking branch. */
  name: string;
  remote: boolean;
  current: boolean;
  /** The folder of another worktree that has this branch checked out. */
  worktree?: string;
}
/**
 * A checkout's local and remote-tracking branches as Git last knew them.
 * JAM does not fetch.
 */
export interface GitBranches {
  projectId: string;
  worktreeId?: string;
  state: 'repository' | 'not-repository' | 'no-folder';
  current?: string;
  detached: boolean;
  /** Tracked files with uncommitted changes; a branch switch waits for none. */
  changed: number;
  /** A merge, rebase, cherry-pick, revert or bisect is under way. */
  busy: boolean;
  branches: GitBranch[];
  truncated: boolean;
}
/** Every Git request may name one of the project's JAM worktrees instead of its folder. */
interface GitTarget {
  projectId: string;
  worktreeId?: string;
}
export interface GitRequestMap {
  'git.status': { params: GitTarget; result: GitStatus };
  'git.branches': { params: GitTarget; result: GitBranches };
  'git.diff': {
    params: GitTarget & { path: string; side: GitDiffSide };
    result: GitFileDiff;
  };
  'git.setStaged': {
    params: GitTarget & { path: string; staged: boolean };
    result: GitStatus;
  };
}
export function gitBranchLabel(status?: GitStatus): string {
  if (!status) return 'Git…';
  if (status.state === 'no-folder') return 'No folder';
  if (status.state === 'not-repository') return 'No Git';
  if (status.state === 'unavailable') return 'Git unavailable';
  if (status.detached) return `Detached ${status.head?.slice(0, 7) ?? 'HEAD'}`;
  return `${status.branch ?? 'HEAD'}${status.unborn ? ' · no commits' : ''}`;
}
