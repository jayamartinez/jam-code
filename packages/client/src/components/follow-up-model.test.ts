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
  it('follows the preference where the agent can be steered', () => {
    expect(followUpPlan('queue', agent('supported'))).toEqual({
      mode: 'queue',
      other: 'steer',
      steerBlocked: null,
    });
    expect(followUpPlan('steer', agent('conditional'))).toEqual({
      mode: 'steer',
      other: 'queue',
      steerBlocked: null,
    });
  });

  it('queues, and says why, where the agent cannot be steered', () => {
    const plan = followUpPlan('steer', agent('unsupported', 'Claude Code queues instead.'));
    expect(plan).toEqual({
      mode: 'queue',
      other: null,
      steerBlocked: 'Claude Code queues instead.',
    });
    // Unknown is not supported: nothing is promised before a check.
    expect(followUpPlan('steer', agent('unknown')).mode).toBe('queue');
    expect(followUpPlan('steer', undefined).steerBlocked).toBe(
      'This agent cannot be steered from JAM.',
    );
  });

  it('names what each key does', () => {
    expect(followUpHint(followUpPlan('queue', agent('supported')), 'Enter', 'Ctrl Enter')).toBe(
      'Enter queues · Ctrl Enter steers',
    );
    expect(followUpHint(followUpPlan('steer', agent('supported')), 'Return', '⌘ ↵')).toBe(
      'Return steers · ⌘ ↵ queues',
    );
    expect(followUpHint(followUpPlan('steer', agent('unsupported')), 'Enter', 'Ctrl Enter')).toBe(
      'Enter queues · Steering unavailable',
    );
    // A shortcut the reader removed is not offered.
    expect(followUpHint(followUpPlan('queue', agent('supported')), 'Enter', '')).toBe(
      'Enter queues',
    );
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
