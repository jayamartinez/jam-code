-- Snapshot records. Their preferences live in the `settings` table under the
-- `snapshots` key, beside Appearance.
--
-- A database created by the pre-integration Snapshots branch recorded this
-- migration as schema version 3, so it skipped 003-settings and already has
-- the snapshots table. The IF NOT EXISTS clauses let such a database reach
-- version 4 without losing captures, and its earlier preference record moves
-- out of runtime metadata. Neither statement changes a database that
-- followed the numbered path.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    captured_at INTEGER NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS snapshots_retention ON snapshots(sent, captured_at);
INSERT OR IGNORE INTO settings(key, value, updated_at)
    SELECT 'snapshots', value, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    FROM metadata WHERE key = 'snapshot_settings';
DELETE FROM metadata WHERE key = 'snapshot_settings';
