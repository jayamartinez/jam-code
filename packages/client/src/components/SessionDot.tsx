import type { Session } from '@jam/protocol';

/**
 * A chat's activity at a glance: green and pulsing while its agent works,
 * yellow when it waits for you (a permission or a question), blue when it
 * finished out of sight, red when it failed. Nothing for a settled chat.
 */
export function SessionDot({ session, finished }: { session?: Session; finished?: boolean }) {
  if (session?.needsInput)
    return <span className="status-dot needs-input" role="img" aria-label="Needs your input" />;
  if (session?.status === 'running')
    return <span className="status-dot running" role="img" aria-label="Working" />;
  if (session?.status === 'failed')
    return <span className="status-dot failed" role="img" aria-label="Failed" />;
  if (finished) return <span className="status-dot finished" role="img" aria-label="Finished" />;
  return null;
}
