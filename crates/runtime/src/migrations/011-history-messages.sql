-- The provider's own ID for a message JAM synced from its history, so a
-- repeated sync updates that message instead of adding it again. Messages
-- JAM recorded itself have none.
ALTER TABLE messages ADD COLUMN source_id TEXT;
CREATE UNIQUE INDEX messages_source ON messages(conversation_id, source_id)
    WHERE source_id IS NOT NULL;
