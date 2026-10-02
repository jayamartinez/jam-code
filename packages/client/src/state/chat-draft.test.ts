import { describe, expect, it } from 'vitest';
import type { GitBranches, Resource, Session } from '@jam/protocol';
import {
  type ChatDraft,
  checkoutBusy,
  inProject,
  moveRequest,
  workspaceProblem,
  workspaceRequest,
} from './chat-draft';
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

  it('knows when a chat is running in the checkout, whose branch is then read again', () => {
    const resource = { id: 'chat', projectId: 'project-a', sessionId: 's' } as Resource;
    const session = { id: 's', resourceId: 'chat', status: 'running' } as Session;
    const running = { resources: [resource], sessions: [session] };
    expect(checkoutBusy(running, 'project-a')).toBe(true);
    expect(checkoutBusy(running, 'project-b')).toBe(false);
    expect(
      checkoutBusy({ ...running, sessions: [{ ...session, status: 'idle' }] }, 'project-a'),
    ).toBe(false);
    // A chat in its own worktree is not in the checkout.
    expect(
      checkoutBusy({ ...running, resources: [{ ...resource, worktreeId: 'w' }] }, 'project-a'),
    ).toBe(false);
    expect(checkoutBusy(null, 'project-a')).toBe(false);
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

  it('joins the worktree that has a branch checked out, and leaves it with the project', () => {
    const existing = { kind: 'existing', branch: 'feat/chat' } as const;
    expect(workspaceRequest(existing, 'hi')).toEqual(existing);
    expect(
      inProject({ ...draft, workspace: existing }, 'project-b').workspace,
      'a worktree belongs to one repository',
    ).toEqual({ kind: 'checkout' });
  });

  it('moves a started chat on its next Send only when something was chosen', () => {
    expect(moveRequest({}, 'hi')).toBeUndefined();
    // A branch is worked on wherever it is; the runtime finds the folder.
    expect(moveRequest({ branch: 'feat/x' }, 'hi')).toEqual({ kind: 'branch', branch: 'feat/x' });
    expect(moveRequest({ kind: 'checkout' }, 'hi')).toEqual({ kind: 'checkout' });
    expect(moveRequest({ kind: 'worktree' }, 'Split it')).toEqual({
      kind: 'worktree',
      nameHint: 'Split it',
    });
    expect(moveRequest({ kind: 'worktree', branch: 'main' }, 'Split it')).toEqual({
      kind: 'worktree',
      nameHint: 'Split it',
      baseBranch: 'main',
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

  it('leaves uncommitted changes to Git and refuses only mid-merge or rebase', () => {
    expect(switchProblem(branches)).toBeNull();
    expect(switchProblem({ ...branches, changed: 3 })).toBeNull();
    expect(switchProblem({ ...branches, busy: true })).toMatch(/in progress/);
  });
});
