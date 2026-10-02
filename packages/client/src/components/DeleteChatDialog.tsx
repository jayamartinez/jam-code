import { Dialog } from './Controls';

/**
 * Asks before a conversation is permanently deleted (Paper, Core flows
 * "22 · Chats: archive, delete & attach"). Cancel has focus, so Enter and
 * Escape both leave the conversation alone; only pressing Delete removes it.
 */
export function DeleteChatDialog({
  title,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  /** The conversation's title. */
  title: string;
  /** The runtime is deleting it; both buttons wait. */
  busy: boolean;
  /** Why the runtime refused, shown beside the buttons that asked. */
  error?: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog
      title={`Delete ${title}?`}
      className="confirm-dialog"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <h2>Delete “{title}”?</h2>
      <p className="confirm-lead">This permanently removes this conversation from JAM Code.</p>
      <p>Project files, Git branches, worktrees and the agent’s own history are not deleted.</p>
      {error && (
        <p className="confirm-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" className="button quiet" autoFocus disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button danger" disabled={busy} onClick={onConfirm}>
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </footer>
    </Dialog>
  );
}
