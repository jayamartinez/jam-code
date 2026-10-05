-- Follow-ups the reader sent while an agent was working. Each row holds what
-- a Send would carry (text, context, options), captured when it was queued,
-- and waits until the running turn finishes or the reader sends it now.
-- `position` is the explicit order within a conversation; it is never
-- inferred from timestamps. Queued text is not a search document: it joins
-- the transcript, and the index, only when it is sent.
CREATE TABLE queued_turns (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id),
    position INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX queued_turns_order ON queued_turns(resource_id, position);
-- A staged attachment or snapshot a queued follow-up carries belongs to that
-- follow-up: staged-file expiry, the cleanup at start and the snapshot inbox
-- leave it alone until it is sent or the follow-up is removed.
ALTER TABLE attachments ADD COLUMN queued_id TEXT REFERENCES queued_turns(id);
ALTER TABLE snapshots ADD COLUMN queued_id TEXT REFERENCES queued_turns(id);
CREATE INDEX attachments_queued ON attachments(queued_id);
CREATE INDEX snapshots_queued ON snapshots(queued_id);
