import { describe, expect, it } from 'vitest';
import { validateRequest, validateResponse } from './validation';
import { BrowserPreviewTransport } from './preview';

const create = (workspace: unknown, extra: Record<string, unknown> = {}) =>
  validateRequest({
    protocolVersion: 1,
    method: 'conversation.create',
    params: {
      projectId: 'project-jam',
      presentation: 'claude',
      providerId: 'claude',
      workspace,
      ...extra,
    },
  });

describe('new chat workspaces', () => {
  it('accepts a checkout, a branch switch and a new worktree with a retry ID', () => {
    expect(() => create({ kind: 'checkout' })).not.toThrow();
    expect(() => create({ kind: 'checkout', branch: 'feat/x' })).not.toThrow();
    expect(() =>
      create({ kind: 'worktree', nameHint: 'Fix it' }, { requestId: 'r1' }),
    ).not.toThrow();
    expect(() =>
      create({ kind: 'worktree', baseBranch: 'origin/main', nameHint: '' }),
    ).not.toThrow();
  });

  it.each([
    '-b',
    '--upload-pack=x',
    'a..b',
    'a b',
    'x@{1}',
    'a~1',
    'a:b',
    'HEAD',
    'a.lock',
    'a\nb',
    '',
  ])('rejects the branch name %j before it reaches Git', (branch) => {
    expect(() => create({ kind: 'checkout', branch })).toThrow();
    expect(() => create({ kind: 'worktree', baseBranch: branch, nameHint: 'x' })).toThrow();
  });

  it('never lets a client choose a worktree folder or branch name', () => {
    expect(() => create({ kind: 'worktree', nameHint: 'x', path: 'C:/' })).toThrow();
    expect(() => create({ kind: 'worktree', nameHint: 'x', branch: 'jam/mine' })).toThrow();
    expect(() => create({ kind: 'elsewhere' })).toThrow();
  });

  it('addresses worktrees by ID in Git, file and resource requests, never for a browser', () => {
    for (const [method, params] of [
      ['git.status', {}],
      ['git.branches', {}],
      ['git.diff', { path: 'a.ts', side: 'unstaged' }],
      ['git.setStaged', { path: 'a.ts', staged: true }],
      ['file.read', { path: 'a.ts' }],
      ['file.reveal', { path: 'a.ts' }],
      ['resource.open', { kind: 'diff' }],
      ['terminal.create', {}],
    ] as const)
      expect(() =>
        validateRequest({
          protocolVersion: 1,
          method,
          params: { projectId: 'project-jam', worktreeId: 'worktree-1', ...params },
        }),
      ).not.toThrow();
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'resource.open',
        params: { projectId: 'project-jam', kind: 'browser', worktreeId: 'worktree-1' },
      }),
    ).toThrow();
  });

  it('validates branch lists', () => {
    const list = {
      projectId: 'project-jam',
      state: 'repository',
      current: 'main',
      detached: false,
      changed: 2,
      busy: false,
      truncated: false,
      branches: [
        { name: 'main', remote: false, current: true },
        { name: 'feat/x', remote: false, current: false, worktree: '/work/x' },
      ],
    };
    expect(validateResponse('git.branches', list)).toEqual(list);
    expect(() => validateResponse('git.branches', { ...list, changed: -1 })).toThrow();
  });

  it('keeps the browser preview away from branches and worktrees', async () => {
    const preview = new BrowserPreviewTransport();
    await expect(
      preview.request('git.branches', { projectId: 'project-jam' }),
    ).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(
      preview.request('conversation.create', {
        projectId: 'project-jam',
        presentation: 'claude',
        workspace: { kind: 'worktree', nameHint: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const created = await preview.request('conversation.create', {
      projectId: 'project-jam',
      presentation: 'claude',
      workspace: { kind: 'checkout' },
    });
    expect(created.resource.worktreeId).toBeUndefined();
  });
});
