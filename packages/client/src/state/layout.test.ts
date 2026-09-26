import { describe, expect, it } from 'vitest';
import { initialLayout, layoutReducer } from './layout';

describe('resource views', () => {
  it('closing and reopening a view preserves its resource and per-resource draft', () => {
    const resource = { id: 'conversation-1', sessionId: 'session-1' };
    let state = layoutReducer(initialLayout, { type: 'open', resourceId: resource.id });
    state = layoutReducer(state, {
      type: 'draft',
      resourceId: resource.id,
      text: 'Continue after the test',
    });
    state = layoutReducer(state, { type: 'close', viewId: state.views[0]!.id });
    expect(state.views).toHaveLength(0);
    expect(state.drafts[resource.id]).toBe('Continue after the test');
    state = layoutReducer(state, { type: 'open', resourceId: resource.id });
    expect(state.views[0]?.resourceId).toBe(resource.id);
    expect(resource.sessionId).toBe('session-1');
  });

  it('focuses an existing view rather than duplicating a session or view', () => {
    let state = layoutReducer(initialLayout, { type: 'open', resourceId: 'one' });
    state = layoutReducer(state, { type: 'open', resourceId: 'two' });
    state = layoutReducer(state, { type: 'open', resourceId: 'one' });
    expect(state.views).toHaveLength(2);
    expect(state.activeViewId).toBe('view:one');
  });

  it('retains unsent text when a draft becomes a persisted resource', () => {
    let state = layoutReducer(initialLayout, { type: 'open', resourceId: 'draft:one' });
    state = layoutReducer(state, {
      type: 'draft',
      resourceId: 'draft:one',
      text: 'Keep this if Send fails',
    });
    const viewId = state.activeViewId;
    state = layoutReducer(state, {
      type: 'replaceDraft',
      draftId: 'draft:one',
      resourceId: 'conversation-1',
    });
    expect(state.activeViewId).toBe(viewId);
    expect(state.views[0]?.resourceId).toBe('conversation-1');
    expect(state.drafts['conversation-1']).toBe('Keep this if Send fails');
    expect(state.drafts['draft:one']).toBeUndefined();
    state = layoutReducer(state, { type: 'draft', resourceId: 'conversation-1', text: '' });
    expect(state.drafts['conversation-1']).toBe('');
  });
});
