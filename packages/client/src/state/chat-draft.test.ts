import { describe, expect, it } from 'vitest';
import { type ChatDraft, inProject } from './chat-draft';

const draft: ChatDraft = {
  projectId: 'project-a',
  providerId: 'claude',
  presentation: 'claude',
  options: { model: 'fast', access: 'edits' },
};

describe('switching a new chat’s project', () => {
  it('keeps the agent and its options', () => {
    expect(inProject(draft, 'project-b')).toEqual({ ...draft, projectId: 'project-b' });
    expect(inProject(draft, 'project-a')).toBe(draft);
  });
});
