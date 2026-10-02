-- Files the reader attached to a chat. Each row is one copy JAM made in its
-- own `attachments` folder; the file the reader chose is never referenced
-- again, and its original location is not recorded.
--
-- An attachment is staged (`sent = 0`, no conversation yet: a new chat has
-- none until its first Send) and then belongs to exactly one conversation
-- once it is sent. Unsent rows are temporary and are cleaned up; sent rows
-- live as long as the conversation that sent them.
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    resource_id TEXT REFERENCES resources(id),
    data TEXT NOT NULL
);
CREATE INDEX attachments_unsent ON attachments(sent, created_at);
CREATE INDEX attachments_resource ON attachments(resource_id);
