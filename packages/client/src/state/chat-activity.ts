import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Session } from '@jam/protocol';

export type ChatEvent = 'finished' | 'input' | 'error';

export interface ChatAttention {
  /** Finished out of sight: a blue dot until the chat is looked at. */
  finished: ReadonlySet<string>;
  /** Failed out of sight, until looked at. */
  failed: ReadonlySet<string>;
}

/**
 * What changed in each chat since the last snapshot. `onEvent` runs once per
 * change: a turn finishing (running → idle), an agent starting to wait for
 * you, or a turn failing. Presentation only: nothing here is stored, and a
 * reload forgets it.
 */
export function useChatAttention(
  sessions: readonly Session[] | undefined,
  visibleSessionIds: readonly string[],
  onEvent: (event: ChatEvent, session: Session) => void,
): ChatAttention {
  const [attention, setAttention] = useState<ChatAttention>(() => ({
    finished: new Set(),
    failed: new Set(),
  }));
  const previous = useRef(new Map<string, Pick<Session, 'status' | 'needsInput'>>());
  const visible = useRef(visibleSessionIds);
  visible.current = visibleSessionIds;
  const notify = useRef(onEvent);
  notify.current = onEvent;

  useEffect(() => {
    if (!sessions) return;
    const finished: string[] = [];
    const failed: string[] = [];
    for (const session of sessions) {
      const before = previous.current.get(session.id);
      previous.current.set(session.id, { status: session.status, needsInput: session.needsInput });
      if (!before) continue;
      if (before.status === 'running' && session.status === 'idle') {
        finished.push(session.id);
        notify.current('finished', session);
      } else if (before.status !== 'failed' && session.status === 'failed') {
        failed.push(session.id);
        notify.current('error', session);
      } else if (!before.needsInput && session.needsInput) {
        notify.current('input', session);
      }
    }
    const unseen = (ids: string[]) => ids.filter((id) => !visible.current.includes(id));
    if (unseen(finished).length || unseen(failed).length)
      setAttention((current) => ({
        finished: new Set([...current.finished, ...unseen(finished)]),
        failed: new Set([...current.failed, ...unseen(failed)]),
      }));
  }, [sessions]);

  const visibleKey = visibleSessionIds.join('\n');
  useEffect(() => {
    const seen = (ids: ReadonlySet<string>) =>
      [...ids].some((id) => visible.current.includes(id))
        ? new Set([...ids].filter((id) => !visible.current.includes(id)))
        : ids;
    setAttention((current) => {
      const finished = seen(current.finished);
      const failed = seen(current.failed);
      return finished === current.finished && failed === current.failed
        ? current
        : { finished, failed };
    });
  }, [visibleKey]);

  return attention;
}

export type BadgeTone = 'input' | 'error' | 'finished';

/** How many chats want you, and the most urgent reason: input, then error, then finished. */
export function attentionBadge(
  sessions: readonly Session[],
  attention: ChatAttention,
): { count: number; tone: BadgeTone } | null {
  const input = sessions.filter((session) => session.needsInput).length;
  const count = input + attention.failed.size + attention.finished.size;
  if (!count) return null;
  const tone = input ? 'input' : attention.failed.size ? 'error' : 'finished';
  return { count, tone };
}

/** Whether JAM's window is the one in use; a chat on screen only counts as seen then. */
export function useWindowFocused() {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('focus', listener);
      window.addEventListener('blur', listener);
      return () => {
        window.removeEventListener('focus', listener);
        window.removeEventListener('blur', listener);
      };
    },
    () => document.hasFocus(),
    () => true,
  );
}
