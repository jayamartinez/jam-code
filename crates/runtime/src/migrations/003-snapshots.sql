CREATE TABLE snapshots (
    id TEXT PRIMARY KEY,
    captured_at INTEGER NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
);
CREATE INDEX snapshots_retention ON snapshots(sent, captured_at);
