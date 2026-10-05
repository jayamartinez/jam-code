import { ArrowDown, ArrowUp, Pencil, Send, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import type { QueuedTurn, Session } from '@jam/protocol';
import { IconButton } from './Controls';
import { ContextIcon } from './ContextChip';
import { attachmentDetail } from './attachment-model';
import { queueWaiting } from './follow-up-model';

export interface QueueActions {
  onEdit(id: string, text: string): Promise<void>;
  onRemove(id: string): void;
  onMove(id: string, position: number): void;
  onSendNow(id: string): void;
}

/**
 * Follow-ups waiting to be sent, at the end of the thread in the order they
 * will go. They are runtime state, so every view of the chat shows the same
 * queue, and they read as not yet sent: no bubble, a dashed edge, a number.
 */
export function QueuedTurns({
  queued,
  session,
  steerBlocked,
  busy,
  actions,
}: {
  queued: readonly QueuedTurn[];
  session?: Session;
  /** Why the running turn cannot take a message now, when it cannot. */
  steerBlocked: string | null;
  busy: boolean;
  actions: QueueActions;
}) {
  const waiting = queueWaiting(queued, session);
  if (!queued.length) return null;
  const running = session?.status === 'running';
  return (
    <section className="queued-turns" aria-label="Queued messages">
      {queued.map((turn, index) => (
        <QueuedCard
          key={turn.id}
          turn={turn}
          index={index}
          last={index === queued.length - 1}
          running={running}
          steerBlocked={steerBlocked}
          busy={busy}
          actions={actions}
        />
      ))}
      {waiting && <p className="queued-waiting">{waiting}</p>}
    </section>
  );
}

function QueuedCard({
  turn,
  index,
  last,
  running,
  steerBlocked,
  busy,
  actions,
}: {
  turn: QueuedTurn;
  index: number;
  last: boolean;
  running: boolean;
  steerBlocked: string | null;
  busy: boolean;
  actions: QueueActions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (editing === null) return;
    setSaving(true);
    try {
      await actions.onEdit(turn.id, editing);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };
  const sendLabel = running
    ? steerBlocked
      ? `Steering unavailable: ${steerBlocked}`
      : 'Steer now: send it into the running turn'
    : 'Send now';
  const empty = editing !== null && !editing.trim() && !turn.context.length;
  return (
    <article className={`queued-turn ${turn.error ? 'failed' : ''}`}>
      <header className="queued-heading">
        <span className="queued-label">Queued · {index + 1}</span>
        {editing === null && (
          <span className="queued-actions">
            <IconButton
              label="Move up"
              disabled={busy || index === 0}
              onClick={() => actions.onMove(turn.id, index - 1)}
            >
              <ArrowUp size={12} />
            </IconButton>
            <IconButton
              label="Move down"
              disabled={busy || last}
              onClick={() => actions.onMove(turn.id, index + 1)}
            >
              <ArrowDown size={12} />
            </IconButton>
            <IconButton label="Edit" disabled={busy} onClick={() => setEditing(turn.text)}>
              <Pencil size={11} />
            </IconButton>
            <IconButton
              label={sendLabel}
              disabled={busy || (running && !!steerBlocked)}
              onClick={() => actions.onSendNow(turn.id)}
            >
              <Send size={11} />
            </IconButton>
            <IconButton label="Remove" disabled={busy} onClick={() => actions.onRemove(turn.id)}>
              <X size={12} />
            </IconButton>
          </span>
        )}
      </header>
      {editing === null ? (
        turn.text && <p className="queued-text">{turn.text}</p>
      ) : (
        <div className="queued-edit">
          <textarea
            aria-label="Edit queued message"
            value={editing}
            maxLength={20000}
            autoFocus
            onChange={(event) => setEditing(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setEditing(null);
              } else if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!empty) void save();
              }
            }}
          />
          <span className="queued-edit-actions">
            <button type="button" className="queued-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="queued-button primary"
              disabled={saving || empty}
              onClick={() => void save()}
            >
              Save
            </button>
          </span>
        </div>
      )}
      {!!turn.context.length && (
        <div className="sent-context">
          {turn.context.map((item) => (
            <span key={item.id} title={item.label}>
              <ContextIcon item={item} />
              <span className="truncate">{item.label}</span>
              {item.attachment && <small>{attachmentDetail(item)}</small>}
            </span>
          ))}
        </div>
      )}
      {turn.error && (
        <p className="queued-error">
          <TriangleAlert size={11} /> Not sent: {turn.error}
        </p>
      )}
    </article>
  );
}
