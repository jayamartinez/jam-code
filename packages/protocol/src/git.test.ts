import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/git.json';
import { gitBranchLabel, type GitStatus } from './git';
import { validateRequest, validateResponse } from './validation';
import { BrowserPreviewTransport } from './preview';
const status: GitStatus = {
  projectId: 'project-jam',
  state: 'repository',
  branch: 'main',
  unborn: false,
  detached: false,
  files: [],
  truncated: false,
};
describe('Git contract', () => {
  it('validates the shared structured patch and rejects malformed lines', () => {
    expect(validateResponse('git.diff', fixture)).toEqual(fixture);
    const bad = structuredClone(fixture);
    bad.hunks[0]!.lines[0]!.oldLine = -1;
    expect(() => validateResponse('git.diff', bad)).toThrow();
    expect(() =>
      validateResponse('git.status', { ...status, files: [{ ...fixture.file, staged: 'M' }] }),
    ).toThrow();
  });
  it('requires scoped literal paths and explicit mutations', () => {
    for (const path of ['../a', '/a', 'a/../b'])
      expect(() =>
        validateRequest({
          protocolVersion: 1,
          method: 'git.setStaged',
          params: { projectId: 'project-jam', path, staged: true },
        }),
      ).toThrow();
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'git.setStaged',
        params: { projectId: 'project-jam', path: 'a' },
      }),
    ).toThrow();
    expect(() =>
      validateRequest({
        protocolVersion: 1,
        method: 'git.diff',
        params: { projectId: 'project-jam', path: 'space ü.txt', side: 'staged' },
      }),
    ).not.toThrow();
  });
  it('labels real branch states without invented names', () => {
    expect(gitBranchLabel(status)).toBe('main');
    expect(gitBranchLabel({ ...status, unborn: true })).toBe('main · no commits');
    expect(gitBranchLabel({ ...status, detached: true, head: '0123456789' })).toBe(
      'Detached 0123456',
    );
    expect(gitBranchLabel({ ...status, state: 'not-repository' })).toBe('No Git');
  });
  it('never simulates Git in the browser preview', async () => {
    const preview = new BrowserPreviewTransport();
    expect((await preview.request('git.status', { projectId: 'project-jam' })).state).toBe(
      'unavailable',
    );
    await expect(
      preview.request('git.setStaged', { projectId: 'project-jam', path: 'test', staged: true }),
    ).rejects.toThrow('desktop');
  });
});
