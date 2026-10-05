import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor, QueuedTurn, Session } from '@jam/protocol';
import { followUpHint, followUpPlan, queueWaiting } from './follow-up-model';

const agent = (status: string, reason?: string) =>
  ({
    id: 'codex',
    name: 'Codex',
    capabilities: { steering: { status, ...(reason ? { reason } : {}) } },
  }) as unknown as ProviderDescriptor;

describe('follow-up plan', () => {
  it('queues on Send and steers with the other shortcut where the agent can be steered', () => {
    for (const status of ['supported', 'conditional'])
      expect(followUpPlan(agent(status))).toEqual({
        mode: 'queue',
        other: 'steer',
        steerBlocked: null,
      });
  });

  it('queues, and says why, where the agent cannot be steered', () => {
    const plan = followUpPlan(agent('unsupported', 'This agent queues instead.'));
    expect(plan).toEqual({
      mode: 'queue',
      other: null,
      steerBlocked: 'This agent queues instead.',
    });
    // Unknown is not supported: nothing is promised before a check.
    expect(followUpPlan(agent('unknown')).other).toBeNull();
    expect(followUpPlan(undefined).steerBlocked).toBe('This agent cannot be steered from JAM.');
  });

  it('names what each key does', () => {
    expect(followUpHint(followUpPlan(agent('supported')), 'Enter', 'Ctrl Enter')).toBe(
      'Enter queues · Ctrl Enter steers',
    );
    expect(followUpHint(followUpPlan(agent('supported')), 'Return', '⌘ ↵')).toBe(
      'Return queues · ⌘ ↵ steers',
    );
    expect(followUpHint(followUpPlan(agent('unsupported')), 'Enter', 'Ctrl Enter')).toBe(
      'Enter queues · Steering unavailable',
    );
    // A shortcut the reader removed is not offered.
    expect(followUpHint(followUpPlan(agent('supported')), 'Enter', '')).toBe('Enter queues');
  });
});

describe('queue waiting', () => {
  const turn = (error?: string): QueuedTurn => ({
    id: 'q1',
    resourceId: 'conv-1',
    text: 'next',
    context: [],
    createdAt: '2026-10-04T10:00:00Z',
    ...(error ? { error } : {}),
  });
  const session = (status: Session['status']) => ({ status }) as Session;

  it('is quiet while follow-ups will go on their own', () => {
    expect(queueWaiting([], session('idle'))).toBeNull();
    expect(queueWaiting([turn()], session('running'))).toBeNull();
  });

  it('says when they wait for the reader', () => {
    expect(queueWaiting([turn()], session('interrupted'))).toMatch(/^Waiting for you/);
    expect(queueWaiting([turn('Codex is turned off.')], session('running'))).toMatch(
      /could not be sent/,
    );
  });
});
