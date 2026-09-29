import { useEffect, useRef, useState } from 'react';
import type { Session } from '@jam/protocol';

/**
 * Chats whose agent finished while they were out of sight, so their dot
 * turns blue until they are looked at. `onFinished` runs once per finished
 * turn (running → idle), wherever the chat is. Presentation only: nothing
 * here is stored, and a reload forgets it.
 */
export function useFinishedChats(
  sessions: readonly Session[] | undefined,
  visibleSessionIds: readonly string[],
  onFinished: () => void,
): ReadonlySet<string> {
  const [finished, setFinished] = useState<ReadonlySet<string>>(() => new Set());
  const previous = useRef(new Map<string, Session['status']>());
  const visible = useRef(visibleSessionIds);
  visible.current = visibleSessionIds;
  const notify = useRef(onFinished);
  notify.current = onFinished;

  useEffect(() => {
    if (!sessions) return;
    const done: string[] = [];
    for (const session of sessions) {
      const before = previous.current.get(session.id);
      if (before === 'running' && session.status === 'idle') done.push(session.id);
      previous.current.set(session.id, session.status);
    }
    if (!done.length) return;
    notify.current();
    const unseen = done.filter((id) => !visible.current.includes(id));
    if (unseen.length) setFinished((current) => new Set([...current, ...unseen]));
  }, [sessions]);

  const visibleKey = visibleSessionIds.join('\n');
  useEffect(() => {
    setFinished((current) => {
      const next = new Set([...current].filter((id) => !visible.current.includes(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleKey]);

  return finished;
}
