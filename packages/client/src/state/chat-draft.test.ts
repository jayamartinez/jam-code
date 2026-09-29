import { describe, expect, it } from 'vitest';
import type { GitBranches } from '@jam/protocol';
import { type ChatDraft, inProject, workspaceProblem, workspaceRequest } from './chat-draft';
import { filterBranches, switchProblem } from './branches';

const draft: ChatDraft = {
  projectId: 'project-a',
  providerId: 'claude',
  presentation: 'claude',
  options: { model: 'fast', access: 'edits' },
  workspace: { kind: 'worktree', branch: 'feat/base' },
};

describe('where a new chat works', () => {
  it('asks the runtime for nothing when the checkout stays as it is', () => {
    expect(workspaceRequest({ kind: 'checkout' }, 'hi')).toBeUndefined();
    expect(workspaceRequest({ kind: 'checkout', branch: 'main' }, 'hi', 'main')).toBeUndefined();
  });

  it('switches the checkout only to another branch, on Send', () => {
    expect(workspaceRequest({ kind: 'checkout', branch: 'feat/x' }, 'hi', 'main')).toEqual({
      kind: 'checkout',
      branch: 'feat/x',
    });
  });

  it('names a new worktree from the first message and its chosen base', () => {
    expect(workspaceRequest({ kind: 'worktree' }, 'Fix the test')).toEqual({
      kind: 'worktree',
      nameHint: 'Fix the test',
    });
    expect(workspaceRequest(draft.workspace, 'Fix the test')).toEqual({
      kind: 'worktree',
      nameHint: 'Fix the test',
      baseBranch: 'feat/base',
    });
  });

  it('waits for a choice when Settings asks each time', () => {
    expect(workspaceProblem({})).toMatch(/Choose Current checkout or New worktree/);
    expect(workspaceProblem({ kind: 'checkout' })).toBeNull();
  });

  it('keeps the agent and workspace kind when the project changes, not its branch', () => {
    const moved = inProject(draft, 'project-b');
    expect(moved).toEqual({ ...draft, projectId: 'project-b', workspace: { kind: 'worktree' } });
    expect(inProject(draft, 'project-a')).toBe(draft);
    expect(inProject({ ...draft, workspace: {} }, 'project-b').workspace).toEqual({});
  });
});

const branches: GitBranches = {
  projectId: 'project-a',
  state: 'repository',
  current: 'main',
  detached: false,
  changed: 0,
  busy: false,
  truncated: false,
  branches: [
    { name: 'feat/chat', remote: false, current: false, worktree: '/work/chat' },
    { name: 'main', remote: false, current: true },
    { name: 'origin/main', remote: true, current: false },
  ],
};

describe('branch picker', () => {
  it('searches local branches first, then remote ones', () => {
    const all = filterBranches(branches.branches, '');
    expect(all.local.map((b) => b.name)).toEqual(['feat/chat', 'main']);
    expect(all.remote.map((b) => b.name)).toEqual(['origin/main']);
    const found = filterBranches(branches.branches, ' MAIN ');
    expect(found.local.map((b) => b.name)).toEqual(['main']);
    expect(found.remote.map((b) => b.name)).toEqual(['origin/main']);
  });

  it('refuses a checkout switch that could lose work', () => {
    expect(switchProblem(branches)).toBeNull();
    expect(switchProblem({ ...branches, changed: 1 })).toMatch(/^1 file has uncommitted changes/);
    expect(switchProblem({ ...branches, changed: 3 })).toMatch(/^3 files have/);
    expect(switchProblem({ ...branches, busy: true })).toMatch(/in progress/);
  });
});
