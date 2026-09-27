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
export interface GitRequestMap {
  'git.status': { params: { projectId: string }; result: GitStatus };
  'git.diff': {
    params: { projectId: string; path: string; side: GitDiffSide };
    result: GitFileDiff;
  };
  'git.setStaged': {
    params: { projectId: string; path: string; staged: boolean };
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
