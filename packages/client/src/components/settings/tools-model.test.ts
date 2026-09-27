import { describe, expect, it } from 'vitest';
import { toggleAgent } from './tools-model';

describe('toggleAgent', () => {
  it('adds and removes agents', () => {
    expect(toggleAgent(['claude'], 'codex')).toEqual(['claude', 'codex']);
    expect(toggleAgent(['claude', 'codex'], 'claude')).toEqual(['codex']);
  });

  it('never leaves a skill with no agent', () => {
    expect(toggleAgent(['codex'], 'codex')).toEqual(['codex']);
  });
});
