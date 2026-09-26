CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE resources (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    data TEXT NOT NULL
);
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL UNIQUE REFERENCES resources(id),
    data TEXT NOT NULL
);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    data TEXT NOT NULL
);
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    ordinal INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX messages_conversation ON messages(conversation_id, ordinal);
CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    receipt TEXT NOT NULL
);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE search_documents (
    id INTEGER PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id),
    message_id TEXT UNIQUE REFERENCES messages(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL
);
CREATE VIRTUAL TABLE search_fts USING fts5(
    title, body, content='search_documents', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER search_insert AFTER INSERT ON search_documents BEGIN
    INSERT INTO search_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER search_delete AFTER DELETE ON search_documents BEGIN
    INSERT INTO search_fts(search_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
END;
CREATE TRIGGER search_update AFTER UPDATE ON search_documents BEGIN
    INSERT INTO search_fts(search_fts, rowid, title, body)
      VALUES ('delete', old.id, old.title, old.body);
    INSERT INTO search_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
