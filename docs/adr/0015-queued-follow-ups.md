# 0015 — Queued follow-ups

Status: accepted (2026-10-04). Amends ADR 0002's lifecycle and ADR 0011's
deferral of queueing.

## Context

While an agent works, the reader often knows what comes next ("then run the
tests"). The composer kept such a draft, but it was client state: it could not
be sent until the turn ended, it was lost with a reload, and it carried no
attachments or snapshots safely across a restart. A follow-up is a Send that
waits, so it has to be as durable and as exactly-once as a Send.

## Decision

**The runtime owns the queue.** `queue.add` takes what `turn.start` takes
(text, context, the chat's options as chosen now) and stores it in
`queued_turns` with an explicit `position`. Order is never inferred from time;
`queue.move` rewrites positions. `queue.update` edits the text, `queue.remove`
drops one, `queue.send` sends one now. Every change publishes the whole queue
as `queue.updated`, so every view of the chat shows the same queue, and
`conversation.get` returns it. At most 20 wait per conversation.

**A queued follow-up owns what it carries.** Its staged snapshots and
attachments are marked with its ID (`queued_id`). Staged-file expiry, the
cleanup at start, the snapshot inbox and retention leave them alone, and they
cannot be sent, staged elsewhere or removed as chips meanwhile. Sending moves
them to the conversation exactly as a Send does (an attachment's copy moves
into the conversation's folder; nothing is copied again). Removing the
follow-up deletes its attachments' copies and returns its snapshots to the
inbox; deleting the conversation does the same for all of them.

**Options are captured at queue time.** A queued follow-up keeps the complete
options the composer had when it was queued, so a later change in the composer
does not change what it means. A change of workspace (branch or worktree) is
not part of a queued follow-up: the client refuses to queue while one is
staged, because moving a chat under its running agent is not safe.

**Dispatch is narrow and supervised.** Only one provider turn runs per
session. When a turn finishes `completed` and the first follow-up has not
failed, the runtime keeps the session `running`, lets the finished turn's task
end, and starts that follow-up as a turn whose request ID is the follow-up's
ID; the transaction that starts it removes it from the queue. The chat never
reports finishing in between, so no "finished" notification fires before the
next turn. Nothing else dispatches automatically:

- a pending approval or question keeps the turn running, so it holds the queue;
- a failed or interrupted turn, Stop, and Stop during the handoff leave the
  queue waiting for the reader;
- a follow-up that cannot start (a provider turned off, a missing folder, an
  image the model refuses) records why on itself and holds the queue;
- a follow-up queued while the chat is already idle after a completed turn
  (the turn finished while the request was on its way) starts at once.

**Restart starts nothing.** Running sessions become interrupted as before, and
their queues wait. JAM never begins agent work at launch.

**Queued text is not history.** It is not a message or a search document until
it is sent.

## Consequences

- A follow-up is sent at most once: as a turn its receipt is its ID; a retried
  `queue.add` returns its first receipt.
- `turn.interrupt` still never cancels queued input.
- The queue is per conversation. Several chats can each have one; each runs
  only after its own turns.
- Steering a running turn is a separate, provider-dependent capability; see
  PROVIDERS.md.
