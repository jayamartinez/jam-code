-- Persistent product settings, one JSON record per key. Appearance lives here
-- so it survives restart and belongs to the runtime rather than to whichever
-- client happened to draw it. Ephemeral view state never belongs here.
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
