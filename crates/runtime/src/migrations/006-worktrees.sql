-- Worktrees JAM created for new chats. A chat, and the Review, files and
-- terminals opened from it, reference one by ID; the runtime alone resolves
-- its folder. JAM never deletes a worktree, so rows are never removed here.
CREATE TABLE worktrees (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    data TEXT NOT NULL
);
CREATE INDEX worktrees_project ON worktrees(project_id);
