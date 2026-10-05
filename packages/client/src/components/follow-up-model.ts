import type { ProviderDescriptor, QueuedTurn, Session } from '@jam/protocol';

/** Queue a message for after the turn, or steer it into the running turn. */
export type FollowUp = 'queue' | 'steer';

/** What the composer does with a message while the agent works. */
export interface FollowUpPlan {
  /** What Send (Enter) does. */
  mode: FollowUp;
  /** What the other shortcut does, or null when only one action is possible. */
  other: FollowUp | null;
  /** Why this agent cannot be steered right now, when it cannot. */
  steerBlocked: string | null;
}

/**
 * Send (Enter) queues and the other shortcut steers (Paper, Core flows "29 ·
 * Queue & steer on every agent"). Steering needs the provider's own
 * mechanism (its `steering` capability); without one every follow-up is
 * queued, and the composer says why rather than pretending. `conditional`
 * may still be refused by the agent at the moment, and the runtime says so
 * then.
 */
export function followUpPlan(descriptor: ProviderDescriptor | undefined): FollowUpPlan {
  const capability = descriptor?.capabilities?.steering;
  const steerable = capability?.status === 'supported' || capability?.status === 'conditional';
  if (!steerable)
    return {
      mode: 'queue',
      other: null,
      steerBlocked:
        capability?.reason ?? `${descriptor?.name ?? 'This agent'} cannot be steered from JAM.`,
    };
  return { mode: 'queue', other: 'steer', steerBlocked: null };
}

/** The verb a follow-up action shows. */
export const followUpVerb = (mode: FollowUp) => (mode === 'queue' ? 'Queue' : 'Steer');

/** What the action does, for its tooltip. */
export function followUpEffect(mode: FollowUp, name: string) {
  return mode === 'queue'
    ? `sends after ${name} finishes this turn`
    : `sends it into ${name}’s running turn now`;
}

/**
 * The line under a working chat's composer: what Enter does, what the other
 * shortcut does, or why steering is not offered.
 */
export function followUpHint(plan: FollowUpPlan, enter: string, otherKeys: string): string {
  const main = `${enter} ${plan.mode === 'queue' ? 'queues' : 'steers'}`;
  if (!plan.other) return `${main} · Steering unavailable`;
  if (!otherKeys) return main;
  return `${main} · ${otherKeys} ${plan.other === 'queue' ? 'queues' : 'steers'}`;
}

/**
 * Why queued follow-ups are not going on their own, or null while they will:
 * they go one at a time as turns complete, and wait after a stop, a failure,
 * a restart or a follow-up that could not be sent.
 */
export function queueWaiting(
  queued: readonly QueuedTurn[],
  session: Session | undefined,
): string | null {
  if (!queued.length) return null;
  if (queued[0]?.error) return 'The next message could not be sent. Edit, send or remove it.';
  if (session?.status === 'running') return null;
  return 'Waiting for you. These send after the next turn finishes, or send one now.';
}
