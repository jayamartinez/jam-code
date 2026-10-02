import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitBranch, GitBranches, JamTransport } from '@jam/protocol';

/**
 * A project checkout's branches for a new chat's pickers. Read when the
 * draft appears, when its project changes, when a picker opens and when the
 * window regains focus; never on a timer. A late answer for an earlier
 * project is dropped.
 */
export function useBranches(transport: JamTransport, projectId: string, worktreeId?: string) {
  const [list, setList] = useState<GitBranches | undefined>();
  const [error, setError] = useState<string | undefined>();
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const current = ++generation.current;
    // A chat in a worktree sees the branches from that worktree's folder.
    const target = worktreeId ? { projectId, worktreeId } : { projectId };
    transport.request('git.branches', target).then(
      (next) => {
        if (current !== generation.current) return;
        setList(next);
        setError(undefined);
      },
      (cause: unknown) => {
        if (current !== generation.current) return;
        setList(undefined);
        setError(cause instanceof Error ? cause.message : 'Git is unavailable.');
      },
    );
  }, [projectId, transport, worktreeId]);
  useEffect(() => {
    const answers = generation;
    setList(undefined);
    setError(undefined);
    refresh();
    // An agent or another tool may have moved the checkout to another branch.
    window.addEventListener('focus', refresh);
    // An answer that arrives after the project changed is dropped.
    return () => {
      window.removeEventListener('focus', refresh);
      answers.current++;
    };
  }, [refresh]);
  return { list, error, refresh };
}

/**
 * Whether two folder paths are the same folder, as far as text can tell: Git
 * writes forward slashes and the project record may not. Only used to say
 * what a folder is, never to decide what happens in one.
 */
export function sameFolder(a: string | undefined, b: string | undefined): boolean {
  const plain = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return !!a && !!b && plain(a) === plain(b);
}

/** Branches matching a search, local ones first, each group in Git's order. */
export function filterBranches(branches: readonly GitBranch[], query: string) {
  const needle = query.trim().toLowerCase();
  const matches = branches.filter(
    (branch) => !needle || branch.name.toLowerCase().includes(needle),
  );
  return {
    local: matches.filter((branch) => !branch.remote),
    remote: matches.filter((branch) => branch.remote),
  };
}

/**
 * Why the checkout cannot switch branches on Send, or null when it can.
 * Uncommitted changes and running chats do not stop a switch: the changes
 * come along, and Git refuses on Send if it would overwrite one.
 */
export function switchProblem(list: GitBranches): string | null {
  return list.busy
    ? 'A merge, rebase or similar operation is in progress. Finish it before switching branches.'
    : null;
}
