import { describe, expect, it } from 'vitest';
import { BrowserPreviewTransport } from './preview';
import { listPreviewDirectory, readPreviewFile, writePreviewFile } from './preview-files';
import { validateRequest } from './validation';

describe('project file service', () => {
  it('resolves one directory level so a large tree is never shipped at once', () => {
    const root = listPreviewDirectory('project-jam', '');
    expect(root.entries.map((entry) => entry.name)).toEqual([
      'docs',
      'src',
      'src-tauri',
      'README.md',
      'package.json',
      'tsconfig.json',
    ]);
    expect(root.entries.every((entry) => !entry.name.includes('/'))).toBe(true);
    expect(root.entries.find((entry) => entry.name === 'src')).toMatchObject({
      kind: 'directory',
      hasChildren: true,
    });

    const nested = listPreviewDirectory('project-jam', 'src/session');
    expect(nested.entries.map((entry) => entry.path)).toEqual([
      'src/session/registry.test.ts',
      'src/session/registry.ts',
    ]);
    expect(nested.entries[0]?.status).toBe('added');
  });

  it('is explicit that the tree is a demo, and is writable', () => {
    expect(listPreviewDirectory('project-jam', '').demo).toBe(true);
    const file = readPreviewFile('project-jam', 'src/session/registry.ts');
    expect(file.demo).toBe(true);
    expect(file.writable).toBe(true);
    expect(file.language).toBe('typescript');
    expect(file.text).toContain('export function attach');
  });

  it('reads back a saved working copy and leaves other files alone', () => {
    const before = readPreviewFile('project-jam', 'src/panes/layout.ts');
    writePreviewFile('project-jam', 'src/session/registry.ts', 'edited contents');
    expect(readPreviewFile('project-jam', 'src/session/registry.ts').text).toBe('edited contents');
    expect(readPreviewFile('project-jam', 'src/panes/layout.ts').text).toBe(before.text);
    // A write must address a path the project actually contains.
    expect(() => writePreviewFile('project-jam', 'does/not/exist.ts', 'x')).toThrow();
    expect(() => writePreviewFile('project-jam', '../escape.ts', 'x')).toThrow();
  });

  it('refuses paths that would address anything outside the project', () => {
    for (const path of ['../secrets', '/etc/passwd', 'src/../../etc', 'src//a', './x']) {
      expect(() => readPreviewFile('project-jam', path)).toThrow();
      expect(() =>
        validateRequest({
          protocolVersion: 1,
          method: 'file.read',
          params: { projectId: 'project-jam', path },
        }),
      ).toThrow();
    }
  });

  it('fails loudly for unknown projects, folders and files', () => {
    expect(() => listPreviewDirectory('project-missing', '')).toThrow();
    expect(() => listPreviewDirectory('project-jam', 'src/nope')).toThrow();
    // A prefix that is not a folder boundary must not match.
    expect(() => listPreviewDirectory('project-jam', 'src/sess')).toThrow();
    expect(() => readPreviewFile('project-jam', 'src/session')).toThrow();
  });

  it('rejects resource.open requests that mix kind and path incorrectly', () => {
    const open = (params: unknown) =>
      validateRequest({ protocolVersion: 1, method: 'resource.open', params });
    expect(() => open({ projectId: 'project-jam', kind: 'file' })).toThrow();
    expect(() => open({ projectId: 'project-jam', kind: 'terminal', path: 'a.ts' })).toThrow();
    expect(() => open({ projectId: 'project-jam', kind: 'settings' })).toThrow();
    expect(() => open({ projectId: 'project-jam', kind: 'file', path: 'a.ts' })).not.toThrow();
    expect(() => open({ projectId: 'project-jam', kind: 'file-browser' })).not.toThrow();
  });
});

describe('opening resources through the preview transport', () => {
  it('returns one resource identity per target and validates its response', async () => {
    const transport = new BrowserPreviewTransport();
    const first = await transport.request('resource.open', {
      projectId: 'project-jam',
      kind: 'file',
      path: 'src/session/registry.ts',
    });
    const again = await transport.request('resource.open', {
      projectId: 'project-jam',
      kind: 'file',
      path: 'src/session/registry.ts',
    });
    expect(first.resource.id).toBe(again.resource.id);
    expect(first.resource.title).toBe('registry.ts');
    expect(first.resource.path).toBe('src/session/registry.ts');

    const other = await transport.request('resource.open', {
      projectId: 'project-jam',
      kind: 'file',
      path: 'src/panes/layout.ts',
    });
    expect(other.resource.id).not.toBe(first.resource.id);

    // A file browser is a distinct resource kind from the review surface.
    const browser = await transport.request('resource.open', {
      projectId: 'project-jam',
      kind: 'file-browser',
    });
    const review = await transport.request('resource.open', {
      projectId: 'project-jam',
      kind: 'diff',
    });
    expect(browser.resource.kind).toBe('file-browser');
    expect(review.resource.kind).toBe('diff');
    expect(browser.resource.id).not.toBe(review.resource.id);

    const workspace = await transport.request('workspace.get', {});
    expect(
      workspace.resources.filter((item) => item.path === 'src/session/registry.ts'),
    ).toHaveLength(1);
  });

  it('refuses to open a file that cannot be read', async () => {
    const transport = new BrowserPreviewTransport();
    await expect(
      transport.request('resource.open', {
        projectId: 'project-jam',
        kind: 'file',
        path: 'does/not/exist.ts',
      }),
    ).rejects.toThrow();
    const workspace = await transport.request('workspace.get', {});
    expect(workspace.resources.some((item) => item.path === 'does/not/exist.ts')).toBe(false);
  });

  it('lists and reads through the validated transport boundary', async () => {
    const transport = new BrowserPreviewTransport();
    const listing = await transport.request('directory.list', {
      projectId: 'project-jam',
      path: 'src',
    });
    expect(listing.entries.map((entry) => entry.name)).toContain('session');
    await expect(
      transport.request('directory.list', { projectId: 'project-nope', path: '' }),
    ).rejects.toThrow();
    const file = await transport.request('file.read', {
      projectId: 'project-jam',
      path: 'package.json',
    });
    expect(file.language).toBe('json');
  });
});
