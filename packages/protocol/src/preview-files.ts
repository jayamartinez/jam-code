import filesJson from '../fixtures/files.json';
import { JamError } from './errors';
import type { DirectoryEntry, DirectoryListing, FileContents, FileStatus } from './types';

/**
 * Development-preview mirror of the runtime file service. It reads the same
 * `files.json` fixture as `crates/runtime/src/files.rs`, so the two cannot
 * describe different trees. Like the runtime, it touches no real filesystem
 * and resolves exactly one directory level per call.
 */

interface DemoFile {
  path: string;
  text: string;
  status?: string;
}

const projects = (filesJson as { projects: Record<string, DemoFile[]> }).projects;
const MAX_ENTRIES = 500;

export function validatePreviewPath(path: string): void {
  if (
    path.length > 512 ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    path.includes('\0') ||
    path.includes('//') ||
    path.split('/').some((segment) => segment === '..' || segment === '.')
  ) {
    throw new JamError('invalid_request', 'Paths must be project-relative.');
  }
}

function filesOf(projectId: string): DemoFile[] {
  const files = projects[projectId];
  if (!files)
    throw new JamError('not_found', 'This project has no readable files in the demo workspace.');
  return files;
}

export function listPreviewDirectory(projectId: string, path: string): DirectoryListing {
  validatePreviewPath(path);
  const files = filesOf(projectId);
  const prefix = path ? `${path}/` : '';
  const directories: string[] = [];
  const entries: DirectoryEntry[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const boundary = rest.indexOf('/');
    if (boundary >= 0) {
      const directory = rest.slice(0, boundary);
      if (!directories.includes(directory)) directories.push(directory);
    } else {
      entries.push({
        name: rest,
        path: file.path,
        kind: 'file',
        ...(file.status ? { status: file.status as FileStatus } : {}),
      });
    }
  }
  if (!directories.length && !entries.length && path)
    throw new JamError('not_found', 'That folder is not in this project.');
  entries.sort((left, right) => (left.name < right.name ? -1 : 1));
  const listing: DirectoryEntry[] = directories
    .map((name) => ({
      name,
      path: `${prefix}${name}`,
      kind: 'directory' as const,
      hasChildren: true,
    }))
    .sort((left, right) => (left.name < right.name ? -1 : 1));
  listing.push(...entries);
  return {
    projectId,
    path,
    entries: listing.slice(0, MAX_ENTRIES),
    truncated: listing.length > MAX_ENTRIES,
    demo: true,
  };
}

/** Saved working copies for the development preview, lost on reload. */
const edits = new Map<string, string>();
const editKey = (projectId: string, path: string) => `${projectId}::${path}`;

export function writePreviewFile(projectId: string, path: string, text: string): string {
  validatePreviewPath(path);
  if (!path) throw new JamError('invalid_request', 'A file path is required.');
  // Only a path the project actually contains can be written.
  if (!filesOf(projectId).some((candidate) => candidate.path === path))
    throw new JamError('not_found', 'That file is not in this project.');
  edits.set(editKey(projectId, path), text);
  return new Date().toISOString();
}

export function readPreviewFile(projectId: string, path: string): FileContents {
  validatePreviewPath(path);
  if (!path) throw new JamError('invalid_request', 'A file path is required.');
  const file = filesOf(projectId).find((candidate) => candidate.path === path);
  if (!file) throw new JamError('not_found', 'That file is not in this project.');
  return {
    projectId,
    path,
    language: previewLanguage(path),
    text: edits.get(editKey(projectId, path)) ?? file.text,
    truncated: false,
    writable: true,
    ...(file.status ? { status: file.status as FileStatus } : {}),
    demo: true,
  };
}

/** Mirrors `language_for` in the runtime file service. */
export function previewLanguage(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  switch (dot < 0 ? '' : name.slice(dot + 1)) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'rs':
      return 'rust';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'toml':
      return 'toml';
    case 'sql':
      return 'sql';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    default:
      return 'text';
  }
}
