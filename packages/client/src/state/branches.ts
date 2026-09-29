import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitBranch, GitBranches, JamTransport } from '@jam/protocol';

/**
 * A project checkout's branches for a new chat's pickers. Read when the
 * draft appears, when its project changes and when a picker opens; never on
 * a timer. A late answer for an earlier project is dropped.
 */
export function useBranches(transport: JamTransport, projectId: string) {
  const [list, setList] = useState<GitBranches | undefined>();
  const [error, setError] = useState<string | undefined>();
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const current = ++generation.current;
    transport.request('git.branches', { projectId }).then(
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
  }, [projectId, transport]);
  useEffect(() => {
    const answers = generation;
    setList(undefined);
    setError(undefined);
    refresh();
    // An answer that arrives after the project changed is dropped.
    return () => {
      answers.current++;
    };
  }, [refresh]);
  return { list, error, refresh };
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

/** Why the checkout cannot switch branches on Send, or null when it can. */
export function switchProblem(list: GitBranches): string | null {
  if (list.busy)
    return 'A merge, rebase or similar operation is in progress. Finish it before switching branches.';
  if (list.changed > 0)
    return `${list.changed === 1 ? '1 file has' : `${list.changed} files have`} uncommitted changes. Commit or stash them before switching, so nothing is lost.`;
  return null;
}
