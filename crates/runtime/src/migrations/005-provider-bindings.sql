-- The link between a JAM session and the provider's own session or thread.
-- JAM IDs stay the primary keys; the provider's ID is opaque provenance used
-- to resume, and later to recognize history created outside JAM.
CREATE TABLE provider_bindings (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id),
    provider_id TEXT NOT NULL,
    native_id TEXT NOT NULL,
    -- 'jam' when JAM started it; a future import records where it came from.
    origin TEXT NOT NULL DEFAULT 'jam',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- Provider version and other provenance, as JSON.
    data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX provider_bindings_native ON provider_bindings(provider_id, native_id);
