import { expect, it, vi } from 'vitest';
import type { GitStatus, JamTransport } from '@jam/protocol';
import { GitClient } from './git-client';
const status: GitStatus = {
  projectId: 'p',
  state: 'repository',
  branch: 'main',
  detached: false,
  unborn: false,
  files: [],
  truncated: false,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('coalesces simultaneous status reads and notifies other views', async () => {
  const result = deferred<GitStatus>();
  const request = vi.fn(() => result.promise);
  const client = new GitClient({ request } as unknown as JamTransport);
  const changed = vi.fn();
  const unsubscribe = client.subscribe(changed);
  const a = client.refresh('p');
  const b = client.refresh('p');
  expect(request).toHaveBeenCalledTimes(1);
  result.resolve(status);
  await Promise.all([a, b]);
  expect(client.get('p').status?.branch).toBe('main');
  unsubscribe();
  const count = changed.mock.calls.length;
  await client.refresh('p');
  expect(changed).toHaveBeenCalledTimes(count);
});
it('rejects stale responses after the project folder changes', async () => {
  const old = deferred<GitStatus>();
  const fresh = deferred<GitStatus>();
  const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const client = new GitClient({ request } as unknown as JamTransport);
  const a = client.refresh('p');
  client.invalidate('p');
  const b = client.refresh('p');
  fresh.resolve({ ...status, branch: 'new-folder' });
  await b;
  old.resolve(status);
  await a;
  expect(client.get('p').status?.branch).toBe('new-folder');
});
it('publishes the returned index state after explicit staging and refreshes errors', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(status)
    .mockResolvedValueOnce({ ...status, branch: 'updated' })
    .mockRejectedValueOnce(new Error('index locked'))
    .mockResolvedValueOnce(status);
  const client = new GitClient({ request } as unknown as JamTransport);
  await client.refresh('p');
  await client.setStaged('p', 'space file', true);
  expect(request).toHaveBeenNthCalledWith(2, 'git.setStaged', {
    projectId: 'p',
    path: 'space file',
    staged: true,
  });
  expect(client.get('p').status?.branch).toBe('updated');
  await expect(client.setStaged('p', 'space file', false)).rejects.toThrow('index locked');
  expect(client.get('p').status?.branch).toBe('main');
});

it('keeps a Review selection across pane remounts without making it a File resource', () => {
  const client = new GitClient({} as JamTransport);
  client.select('review-resource', 'file.txt', 'staged');
  expect(client.selection('review-resource')).toEqual({ path: 'file.txt', side: 'staged' });
  expect(client.selection('file-resource')).toBeUndefined();
});
it('keeps a worktree review apart from its project checkout', async () => {
  const request = vi.fn((_method: string, params: { worktreeId?: string }) =>
    Promise.resolve({
      ...status,
      branch: params.worktreeId ? 'jam/fix' : 'main',
      ...(params.worktreeId ? { worktreeId: params.worktreeId } : {}),
    }),
  );
  const client = new GitClient({ request } as unknown as JamTransport);
  await Promise.all([client.refresh('p'), client.refresh('p', 'worktree-1')]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledWith('git.status', { projectId: 'p', worktreeId: 'worktree-1' });
  expect(client.get('p').status?.branch).toBe('main');
  expect(client.get('p', 'worktree-1').status?.branch).toBe('jam/fix');
  await client.setStaged('p', 'a.txt', true, 'worktree-1');
  expect(request).toHaveBeenLastCalledWith('git.setStaged', {
    projectId: 'p',
    path: 'a.txt',
    staged: true,
    worktreeId: 'worktree-1',
  });
  expect(client.get('p').status?.branch).toBe('main');
});
