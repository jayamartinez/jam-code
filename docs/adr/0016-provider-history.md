# 0016 — Provider history

Status: accepted as a foundation (2026-10-04). Uses ADR 0011's
`provider_bindings` seam; extends ADR 0003's storage and search and ADR
0013's trusted-folder rule. No real provider is scanned yet.

Implemented in stages, one pull request each: this contract and schema;
scanning into the index; project folders; ignore and restore; sync
(projections and message identity, migration 11); tombstones on delete.

## Context

JAM Code persists and resumes the conversations it started. People also work
in Claude Code and Codex directly, and those conversations live in each
provider's own history: Codex threads behind `thread/list` and `thread/read`,
Claude Code sessions in its own records. JAM Code should let a person see,
search, resume and organize them, without pretending its database owns them.

Two later changes will read those histories, one per provider, in parallel.
They need one model for identity, synchronization, deletion and project
association, or each will invent its own.

## Decision

**The provider's history is canonical; JAM keeps a projection.** JAM indexes
what a provider reports and, on request, copies one conversation into an
ordinary JAM conversation (resource, session, binding, messages) that the
transcript, search and resume already understand. The provider's record is
never written or deleted by JAM.

**Words.** _Provider history_ is the provider's record. A _history entry_ is
JAM's index row for one provider conversation (`provider_history`), with its
own JAM ID. A _scan_ lists provider history into the index. A _sync_ reads one
conversation into its _projection_, the JAM conversation that mirrors it. It
is not called an import: JAM keeps following the provider's record rather
than taking a copy once.

**Identity is `(provider, instance, native ID)`.** Never a title, folder,
first message or time. `instance_id` is `default` for every provider today
and is on both `provider_bindings` and `provider_history`, so several accounts
or provider homes need no schema change: they become distinct instance IDs,
chosen by the adapter and carried by the turn.

**Origin is who created the provider's conversation.** `jam` when JAM started
it, `external` when anything else did. It never changes, including when JAM
resumes an external conversation.

**Discovery is separate from materialization.** A scan writes index rows
only: no resource, session, transcript or search document. The workspace
loads every resource row, so creating resources at discovery would make
thousands of past conversations a cost of every workspace read. A sync
creates the projection the first time, then updates it. Listing and reading
are separate adapter calls: `ProviderHistory::list` (pages of cheap metadata)
and `ProviderHistory::read` (pages of one conversation's messages, oldest
first). Neither holds the database lock while the provider answers.

**Synchronization is idempotent reconciliation.** A scan is a complete listing
committed page by page under a scan token. A row the listing reports again is
updated in place; an unchanged one stays unchanged; a renamed one changes its
title but not its identity. Only a scan that reaches the end marks rows it did
not see as missing (`missing_since`, cleared when listed again); an
interrupted scan keeps what it saw and marks nothing. Change is detected from
the adapter's opaque `revision`, or its update time when it has none; no
provider is assumed to have a reliable change cursor. A sync passes back the
adapter's `checkpoint` from the previous complete sync, which an adapter may
use to read only newer messages or ignore.

**Messages keep a provider identity.** `messages.source_id` holds the
provider's message or item ID, or a key the adapter derives from position in
the provider's record, never from text alone. It is unique per conversation,
so a repeated or interrupted sync updates the message with that source ID
(keeping its JAM ID and search document) instead of adding another. Messages
JAM recorded itself have none. Once JAM has recorded a message in a
projection (it was continued in JAM, or JAM started it), later syncs do not
merge the provider's record into it, because those turns would arrive again
under provider IDs. Reconciling them needs adapters to report source IDs for
live turns; until then the JAM transcript is the record of a continued chat.

**JAM's metadata is JAM's.** Pin, archive, project, worktree and layout are
never changed by a scan or a sync. A projection's title follows the provider's
until JAM offers renaming, when a renamed title must become JAM's. Its place
in the inbox (`updatedAt`) is the provider's last activity.

**A reported folder is metadata, never access.** An entry is linked to a
project automatically only when its reported folder is, compared as text,
exactly the folder of a project or recorded worktree JAM already has; the
filesystem is not consulted for it, and `..` or relative paths match nothing.
A folder inside a project is not matched, because agents resume in the folder
they worked in. Anything else stays unlinked: listed, but not synced, until
the reader adds its folder through the normal project flow or links it to an
existing project. A projection then belongs to that trusted project, which is
where it resumes. JAM never creates a project from history.

**Deleting leaves a tombstone.** Deleting a conversation bound to a provider
conversation keeps every existing deletion step and also marks its entry
ignored (creating the entry when none existed), so a later scan does not bring
it back, as an external conversation or at all. This applies to chats JAM
started too, whose threads remain in the provider's history. An entry that
was never synced can be ignored directly. Restoring clears the tombstone;
syncing then makes a new projection. JAM never calls a provider's delete and
never removes its files.

**The client sees JAM IDs only.** `providerHistory.scan`, `.list`, `.sync`,
`.associate`, `.ignore` and `.restore` address entries by JAM ID. Native IDs
stay in the runtime like other provider IDs. The reported folder is returned
for display (`sourcePath`), as worktree paths are.

## Consequences

- Each provider change implements `ProviderHistory` in its adapter and
  returns it from `ProviderAdapter::history`; the runtime's contract tests
  (`crates/runtime/tests/provider_history.rs`) describe the behavior expected
  of it. Resume needs no new adapter method.
- The 500-message conversation read (ARCHITECTURE.md, Current bounds) now
  matters more: a long provider conversation is fully stored and searchable,
  but only its latest 500 messages are shown until transcript pagination.
  Sync itself reads and writes in bounded pages.
- A provider conversation continued both in JAM and outside it diverges: the
  projection keeps JAM's record and later provider changes are not merged.
- Scans run only on request. Nothing scans at launch or on a timer.
