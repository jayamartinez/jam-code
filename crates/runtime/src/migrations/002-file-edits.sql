-- Saved file edits. The demo tree ships read-only content; a save records the
-- working copy here so it survives restart without mutating the fixture.
CREATE TABLE file_edits (
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, path)
);
