import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { gitBranchLabel, type WorkspaceSnapshot } from '@jam/protocol';
import type { GitClient } from './git-client';

export function useGitWorkspace(workspace: WorkspaceSnapshot | null, git: GitClient) {
  const revision = useSyncExternalStore(git.subscribe, git.getSnapshot, git.getSnapshot);
  const targets = JSON.stringify(workspace?.projects.map(({ id, paths }) => ({ id, paths })) ?? []);
  useEffect(() => {
    const projects = JSON.parse(targets) as { id: string }[];
    const refresh = () => {
      for (const project of projects) void git.refresh(project.id);
    };
    for (const project of projects) git.invalidate(project.id);
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [git, targets]);
  return useMemo(() => {
    void revision;
    return workspace
      ? {
          ...workspace,
          projects: workspace.projects.map((project) => {
            const state = git.get(project.id);
            return {
              ...project,
              branch: state.error ? 'Git unavailable' : gitBranchLabel(state.status),
            };
          }),
        }
      : null;
  }, [workspace, git, revision]);
}
