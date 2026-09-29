import { describe, expect, it } from 'vitest';
import {
  activeResourceId,
  activeTree,
  findLeaf,
  initialLayout,
  layoutReducer,
  leaves,
  treeOf,
  type LayoutAction,
  type LayoutState,
  type SplitNode,
} from './layout';

const run = (state: LayoutState, ...actions: LayoutAction[]) =>
  actions.reduce(layoutReducer, state);
const openTab = (resourceId: string): LayoutAction => ({ type: 'openTab', resourceId });
const split = (direction: 'row' | 'column', suffix: string, paneId?: string): LayoutAction => ({
  type: 'split',
  ...(paneId ? { paneId } : {}),
  direction,
  splitId: `split:${suffix}`,
  newPaneId: `pane:${suffix}`,
});

/** Two chat tabs, with the first active and presented as tiles. */
const workspace = () =>
  run(initialLayout, openTab('chat-a'), openTab('chat-b'), openTab('chat-a'), {
    type: 'mode',
    mode: 'tiles',
  });

describe('tabs', () => {
  it('selecting a tab switches the workspace instead of filling a pane', () => {
    // The reported bug: with an empty pane focused, clicking another tab
    // assigned that tab into the pane rather than switching to it.
    const state = run(workspace(), split('row', 'a'), openTab('chat-b'));
    expect(state.activeTabId).toBe('tab:chat-b');
    expect(activeResourceId(state)).toBe('chat-b');
    // Tab A's arrangement is untouched, and its new pane is still empty.
    const treeA = treeOf(state, 'tab:chat-a');
    expect(leaves(treeA).map((pane) => pane.resourceId)).toEqual(['chat-a', null]);
    // Tab B has its own single-pane arrangement.
    expect(leaves(activeTree(state)).map((pane) => pane.resourceId)).toEqual(['chat-b']);
  });

  it('gives every tab its own arrangement', () => {
    let state = run(workspace(), split('row', 'a'), {
      type: 'assignPane',
      resourceId: 'terminal-1',
      paneId: 'pane:a',
    });
    expect(leaves(activeTree(state))).toHaveLength(2);
    state = layoutReducer(state, openTab('chat-b'));
    expect(leaves(activeTree(state))).toHaveLength(1);
    state = layoutReducer(state, openTab('chat-a'));
    expect(leaves(activeTree(state)).map((pane) => pane.resourceId)).toEqual([
      'chat-a',
      'terminal-1',
    ]);
  });

  it('keeps pane resources out of the tab bar', () => {
    const state = run(workspace(), split('row', 'a'), {
      type: 'assignPane',
      resourceId: 'terminal-1',
      paneId: 'pane:a',
    });
    expect(state.tabs.map((tab) => tab.resourceId)).toEqual(['chat-a', 'chat-b']);
  });

  it('reorders tabs by index', () => {
    const state = run(initialLayout, openTab('a'), openTab('b'), openTab('c'), {
      type: 'moveTab',
      from: 2,
      to: 0,
    });
    expect(state.tabs.map((tab) => tab.resourceId)).toEqual(['c', 'a', 'b']);
    expect(layoutReducer(state, { type: 'moveTab', from: 9, to: 0 })).toBe(state);
  });

  it('closing a tab discards its arrangement and selects a neighbour', () => {
    const state = run(workspace(), split('row', 'a'), { type: 'closeTab', tabId: 'tab:chat-a' });
    expect(state.tabs.map((tab) => tab.resourceId)).toEqual(['chat-b']);
    expect(state.trees['tab:chat-a']).toBeUndefined();
    expect(state.activeTabId).toBe('tab:chat-b');
  });

  it('opens a tab in the background without stealing the active one', () => {
    const state = run(workspace(), { type: 'openTab', resourceId: 'chat-c', activate: false });
    expect(state.tabs.map((tab) => tab.resourceId)).toEqual(['chat-a', 'chat-b', 'chat-c']);
    expect(state.activeTabId).toBe('tab:chat-a');
  });

  it('carries a promoted draft tab, its tree and its text across', () => {
    let state = run(initialLayout, openTab('draft:one'), {
      type: 'draft',
      resourceId: 'draft:one',
      text: 'Keep this if Send fails',
    });
    state = run(state, { type: 'mode', mode: 'tiles' }, split('column', 'x'), {
      type: 'assignPane',
      resourceId: 'terminal-1',
      paneId: 'pane:x',
    });
    state = layoutReducer(state, {
      type: 'replaceDraft',
      draftId: 'draft:one',
      resourceId: 'conversation-1',
    });
    expect(state.tabs[0]?.resourceId).toBe('conversation-1');
    expect(state.activeTabId).toBe('tab:conversation-1');
    expect(state.drafts['conversation-1']).toBe('Keep this if Send fails');
    expect(state.drafts['draft:one']).toBeUndefined();
    expect(leaves(activeTree(state)).map((pane) => pane.resourceId)).toEqual([
      'conversation-1',
      'terminal-1',
    ]);
  });
});

describe('panes within a tab', () => {
  it('splits the focused pane and leaves the new pane empty', () => {
    const state = layoutReducer(workspace(), split('row', 'a'));
    const root = activeTree(state) as SplitNode;
    expect(root.type).toBe('split');
    expect(root.direction).toBe('row');
    expect(root.ratio).toBe(0.5);
    expect(root.first).toMatchObject({ type: 'leaf', resourceId: 'chat-a' });
    expect(root.second).toMatchObject({ type: 'leaf', id: 'pane:a', resourceId: null });
    expect(state.focused['tab:chat-a']).toBe('pane:a');
  });

  it('nests a downward split inside a right split without special cases', () => {
    const state = run(
      workspace(),
      split('row', 'right'),
      { type: 'assignPane', resourceId: 'file:registry.ts', paneId: 'pane:right' },
      split('column', 'down', 'pane:right'),
      { type: 'assignPane', resourceId: 'terminal-1', paneId: 'pane:down' },
    );
    const root = activeTree(state) as SplitNode;
    expect(root.direction).toBe('row');
    expect((root.second as SplitNode).direction).toBe('column');
    expect(leaves(activeTree(state)).map((pane) => pane.resourceId)).toEqual([
      'chat-a',
      'file:registry.ts',
      'terminal-1',
    ]);
  });

  it('arranges any resource in any pane', () => {
    const state = run(
      workspace(),
      split('row', 'a'),
      { type: 'assignPane', resourceId: 'browser-1', paneId: 'pane:a' },
      split('column', 'b', 'pane:a'),
      { type: 'assignPane', resourceId: 'diff-1', paneId: 'pane:b' },
    );
    expect(leaves(activeTree(state)).map((pane) => pane.resourceId)).toEqual([
      'chat-a',
      'browser-1',
      'diff-1',
    ]);
  });

  it('resizes a split and clamps the ratio', () => {
    let state = run(workspace(), split('row', 'a'), {
      type: 'resize',
      splitId: 'split:a',
      ratio: 0.72,
    });
    expect((activeTree(state) as SplitNode).ratio).toBeCloseTo(0.72);
    state = layoutReducer(state, { type: 'resize', splitId: 'split:a', ratio: 0.01 });
    expect((activeTree(state) as SplitNode).ratio).toBeCloseTo(0.15);
    state = layoutReducer(state, { type: 'resize', splitId: 'split:a', ratio: 3 });
    expect((activeTree(state) as SplitNode).ratio).toBeCloseTo(0.85);
  });

  it('closing a pane collapses its split', () => {
    const state = run(
      workspace(),
      split('row', 'a'),
      { type: 'assignPane', resourceId: 'terminal-1', paneId: 'pane:a' },
      { type: 'closePane', paneId: 'pane:a' },
    );
    expect(leaves(activeTree(state)).map((pane) => pane.resourceId)).toEqual(['chat-a']);
  });

  it('empties the last pane instead of leaving no workspace', () => {
    const state = run(workspace(), { type: 'closePane', paneId: 'tab:chat-a/root' });
    expect(leaves(activeTree(state))).toHaveLength(1);
    expect(leaves(activeTree(state))[0]?.resourceId).toBeNull();
  });

  it('restores each tab arrangement across a single/tiles round trip', () => {
    const before = run(workspace(), split('row', 'a'), {
      type: 'assignPane',
      resourceId: 'terminal-1',
      paneId: 'pane:a',
    });
    const after = run(before, { type: 'mode', mode: 'single' }, { type: 'mode', mode: 'tiles' });
    expect(after.trees).toEqual(before.trees);
    expect(after.tabs).toEqual(before.tabs);
  });

  it('reports the tab resource in Single and the focused pane in Tiles', () => {
    const state = run(workspace(), split('row', 'a'), {
      type: 'assignPane',
      resourceId: 'terminal-1',
      paneId: 'pane:a',
    });
    expect(activeResourceId(state)).toBe('terminal-1');
    expect(activeResourceId({ ...state, mode: 'single' })).toBe('chat-a');
    const refocused = layoutReducer(state, { type: 'focusPane', paneId: 'tab:chat-a/root' });
    expect(activeResourceId(refocused)).toBe('chat-a');
  });

  it('ignores commands aimed at panes that do not exist', () => {
    const state = workspace();
    expect(layoutReducer(state, { type: 'focusPane', paneId: 'pane:missing' })).toBe(state);
    expect(findLeaf(activeTree(state), 'pane:missing')).toBeUndefined();
  });
});

describe('reopening closed tabs', () => {
  it('restores the last closed tab where it was, with its panes', () => {
    const tiled = run(workspace(), split('row', 'x'), {
      type: 'assignPane',
      resourceId: 'terminal-1',
      paneId: 'pane:x',
    });
    const closed = run(tiled, { type: 'closeTab', tabId: 'tab:chat-a' });
    expect(closed.tabs.map((tab) => tab.resourceId)).toEqual(['chat-b']);
    const reopened = run(closed, { type: 'reopenTab' });
    expect(reopened.tabs.map((tab) => tab.resourceId)).toEqual(['chat-a', 'chat-b']);
    expect(reopened.activeTabId).toBe('tab:chat-a');
    // Its focus comes back too: the terminal pane was focused.
    expect(activeResourceId(reopened)).toBe('terminal-1');
    expect(leaves(activeTree(reopened)).map((pane) => pane.resourceId)).toEqual([
      'chat-a',
      'terminal-1',
    ]);
    expect(reopened.closed).toEqual([]);
  });

  it('shows a tab that is already open again instead of duplicating it', () => {
    const state = run(
      workspace(),
      { type: 'closeTab', tabId: 'tab:chat-b' },
      openTab('chat-b'),
      openTab('chat-a'),
      { type: 'reopenTab' },
    );
    expect(state.tabs.map((tab) => tab.resourceId)).toEqual(['chat-a', 'chat-b']);
    expect(activeResourceId(state)).toBe('chat-b');
  });

  it('remembers a bounded number of tabs', () => {
    let state = initialLayout;
    for (let index = 0; index < 30; index++) {
      state = run(state, openTab(`chat-${index}`), {
        type: 'closeTab',
        tabId: `tab:chat-${index}`,
      });
    }
    expect(state.closed).toHaveLength(20);
    expect(run(state, { type: 'reopenTab' }).tabs[0]?.resourceId).toBe('chat-29');
  });
});
