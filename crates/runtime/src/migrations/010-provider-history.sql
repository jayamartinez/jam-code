-- Provider history: conversations that live in a provider's own history
-- (Claude Code sessions, Codex threads), as JAM discovered them. The
-- provider's record stays canonical. A row here is JAM's index entry for one
-- of them; a JAM conversation (resource, session, binding) is created for it
-- only when it is synced, and is then its local, searchable projection.
--
-- Identity is the provider, the provider instance and the provider's own ID,
-- never a title, folder or timestamp. Every provider has one instance,
-- 'default', until JAM can tell several accounts or homes apart.
ALTER TABLE provider_bindings ADD COLUMN instance_id TEXT NOT NULL DEFAULT 'default';
DROP INDEX provider_bindings_native;
CREATE INDEX provider_bindings_native ON provider_bindings(provider_id, instance_id, native_id);

CREATE TABLE provider_history (
    -- JAM's own ID. The client addresses an entry by it, never by the
    -- provider's ID, which does not leave the runtime.
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    instance_id TEXT NOT NULL DEFAULT 'default',
    native_id TEXT NOT NULL,
    -- Who created the provider's conversation: 'jam' or 'external'.
    origin TEXT NOT NULL,
    -- The JAM session projecting it, once synced (or JAM's own session).
    session_id TEXT UNIQUE REFERENCES sessions(id),
    -- A trusted project it belongs to: matched from the folder the provider
    -- reported ('folder') or chosen by the reader ('reader').
    project_id TEXT REFERENCES projects(id),
    worktree_id TEXT REFERENCES worktrees(id),
    project_source TEXT,
    -- What the provider last reported. Untrusted, bounded display metadata.
    title TEXT,
    preview TEXT,
    cwd TEXT,
    created_at TEXT,
    updated_at TEXT,
    -- An opaque token that changes when the provider's conversation does.
    revision TEXT,
    resumable INTEGER NOT NULL DEFAULT 0,
    discovered_at TEXT NOT NULL,
    -- The scan that last listed it; a complete scan that did not list it
    -- sets `missing_since`.
    seen_scan TEXT,
    missing_since TEXT,
    synced_at TEXT,
    synced_revision TEXT,
    -- The adapter's token for reading on from where the last sync ended.
    sync_checkpoint TEXT,
    -- A tombstone: removed from JAM by the reader. Scans keep it hidden
    -- until it is restored. The provider's history is never touched.
    ignored_at TEXT,
    -- The provider's last update, or discovery when it reports none.
    sort_at TEXT NOT NULL,
    UNIQUE (provider_id, instance_id, native_id)
);
CREATE INDEX provider_history_order ON provider_history(sort_at DESC, id DESC);
