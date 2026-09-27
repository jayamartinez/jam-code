import { describe, expect, it } from 'vitest';
import { snapshotFocus } from './snapshots';
import { initialLayout, layoutReducer, focusedPane } from './layout';
import type { Resource } from '@jam/protocol';
const resources: Resource[] = [
  {
    id: 'chat-a',
    kind: 'conversation',
    sessionId: 'session-a',
    title: 'A',
    pinned: false,
    updatedAt: '',
  },
  { id: 'file', kind: 'file', title: 'File', pinned: false, updatedAt: '' },
  { id: 'terminal', kind: 'terminal', title: 'Terminal', pinned: false, updatedAt: '' },
];
describe('snapshot destination focus', () => {
  it('tracks a structured conversation and ignores a later file or terminal tab', () => {
    let layout = layoutReducer(initialLayout, { type: 'openTab', resourceId: 'chat-a' });
    expect(snapshotFocus(layout, resources)).toBe('chat-a');
    layout = layoutReducer(layout, { type: 'openTab', resourceId: 'file' });
    expect(snapshotFocus(layout, resources)).toBeNull();
    layout = layoutReducer(layout, { type: 'openTab', resourceId: 'terminal' });
    expect(snapshotFocus(layout, resources)).toBeNull();
  });
  it('does not infer a destination from missing sessions or an empty workspace', () => {
    expect(snapshotFocus(initialLayout, resources)).toBeNull();
    const layout = layoutReducer(initialLayout, { type: 'openTab', resourceId: 'chat-a' });
    expect(focusedPane(layout)?.resourceId).toBe('chat-a');
    expect(
      snapshotFocus(
        layout,
        resources.map((r) => ({ ...r, sessionId: undefined })),
      ),
    ).toBeNull();
  });
});
