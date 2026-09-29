/**
 * Presentation state only.
 *
 * A tab is one open resource and owns its own arrangement. A pane is one
 * visible slot inside the active tab's arrangement. Selecting a tab switches
 * the whole workspace to that tab's layout; it never loads a resource into
 * whichever pane happens to be focused.
 *
 * Panes are therefore local to the tab you are in, not app-wide: a terminal or
 * file opened beside a conversation belongs to that conversation's workspace
 * and does not appear in the tab bar.
 *
 * Nothing here owns a session. Closing a pane or a tab changes presentation
 * only; ending work is always an explicit runtime command.
 *
 * The tree is resource-agnostic: a leaf holds a resource ID and knows nothing
 * about conversations, terminals, files or reviews.
 */

export interface ResourceTab {
  id: string;
  resourceId: string;
}

export interface LeafNode {
  type: 'leaf';
  id: string;
  /** An empty pane is a real state: it is waiting for a resource choice. */
  resourceId: string | null;
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: 'row' | 'column';
  /** Fraction of the split occupied by `first`. */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;
export type SplitDirection = SplitNode['direction'];

export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;
const clampRatio = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));

export interface LayoutState {
  tabs: ResourceTab[];
  activeTabId: string | null;
  /** One arrangement per tab, keyed by tab ID. */
  trees: Record<string, LayoutNode>;
  /** Focused pane per tab, so switching tabs restores its focus. */
  focused: Record<string, string>;
  mode: 'single' | 'tiles';
  collapsed: boolean;
  focus: boolean;
  drafts: Record<string, string>;
  /** Recently closed tabs, newest last, so Reopen closed tab can restore them. */
  closed: ClosedTab[];
}

/** A closed tab with its arrangement and where it stood in the tab bar. */
export interface ClosedTab {
  tab: ResourceTab;
  tree?: LayoutNode;
  focusedPaneId?: string;
  index: number;
}

/** How many closed tabs Reopen closed tab remembers. */
export const CLOSED_TAB_LIMIT = 20;

export const initialLayout: LayoutState = {
  tabs: [],
  activeTabId: null,
  trees: {},
  focused: {},
  mode: 'single',
  collapsed: false,
  focus: false,
  drafts: {},
  closed: [],
};

export const tabIdFor = (resourceId: string) => `tab:${resourceId}`;
export const rootPaneFor = (tabId: string) => `${tabId}/root`;
export const leaf = (id: string, resourceId: string | null = null): LeafNode => ({
  type: 'leaf',
  id,
  resourceId,
});

export function leaves(node: LayoutNode | null | undefined): LeafNode[] {
  if (!node) return [];
  return node.type === 'leaf' ? [node] : [...leaves(node.first), ...leaves(node.second)];
}

export function findLeaf(node: LayoutNode | null | undefined, paneId: string) {
  return leaves(node).find((item) => item.id === paneId);
}

/** The tab's arrangement, created on demand around its own resource. */
export function treeOf(state: LayoutState, tabId: string | null): LayoutNode | null {
  if (!tabId) return null;
  const existing = state.trees[tabId];
  if (existing) return existing;
  const tab = state.tabs.find((item) => item.id === tabId);
  return tab ? leaf(rootPaneFor(tabId), tab.resourceId) : null;
}

export const activeTree = (state: LayoutState) => treeOf(state, state.activeTabId);

export function focusedPane(state: LayoutState): LeafNode | undefined {
  const panes = leaves(activeTree(state));
  const wanted = state.activeTabId ? state.focused[state.activeTabId] : undefined;
  return panes.find((pane) => pane.id === wanted) ?? panes[0];
}

/** The resource a single-pane surface should render. */
export function activeResourceId(state: LayoutState): string {
  const tab = state.tabs.find((item) => item.id === state.activeTabId);
  if (!tab) return '';
  // Single presents the tab's own resource; Tiles presents its focused pane.
  if (state.mode !== 'tiles' || state.focus) return tab.resourceId;
  return focusedPane(state)?.resourceId ?? tab.resourceId;
}

function replaceLeaf(
  node: LayoutNode,
  paneId: string,
  replace: (target: LeafNode) => LayoutNode,
): LayoutNode {
  if (node.type === 'leaf') return node.id === paneId ? replace(node) : node;
  const first = replaceLeaf(node.first, paneId, replace);
  const second = replaceLeaf(node.second, paneId, replace);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

/** Remove a leaf and collapse the split that held it. */
function removeLeaf(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === paneId ? null : node;
  const first = removeLeaf(node.first, paneId);
  const second = removeLeaf(node.second, paneId);
  if (!first) return second;
  if (!second) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function mapLeaves(node: LayoutNode, map: (target: LeafNode) => LeafNode): LayoutNode {
  if (node.type === 'leaf') return map(node);
  const first = mapLeaves(node.first, map);
  const second = mapLeaves(node.second, map);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'leaf') return node;
  if (node.id === splitId) return { ...node, ratio: clampRatio(ratio) };
  const first = setRatio(node.first, splitId, ratio);
  const second = setRatio(node.second, splitId, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export type LayoutAction =
  /** Open or select a tab. Never loads a resource into a pane. */
  | { type: 'openTab'; resourceId: string; activate?: boolean }
  | { type: 'closeTab'; tabId: string }
  /** Restores the most recently closed tab, with its panes. */
  | { type: 'reopenTab' }
  | { type: 'moveTab'; from: number; to: number }
  | { type: 'replaceDraft'; draftId: string; resourceId: string }
  /** Load a resource into a pane of the active tab. */
  | { type: 'assignPane'; resourceId: string; paneId?: string }
  | {
      type: 'split';
      paneId?: string;
      direction: SplitDirection;
      splitId: string;
      newPaneId: string;
      resourceId?: string;
      /** Initial split ratio; defaults to an even split. */
      ratio?: number;
    }
  | { type: 'closePane'; paneId: string }
  | { type: 'focusPane'; paneId: string }
  | { type: 'resize'; splitId: string; ratio: number }
  | { type: 'setTree'; tree: LayoutNode; focusedPaneId?: string }
  | { type: 'mode'; mode: LayoutState['mode'] }
  | { type: 'collapse' }
  | { type: 'focus' }
  | { type: 'draft'; resourceId: string; text: string };

/** Apply a change to the active tab's tree, materializing it if needed. */
function withTree(
  state: LayoutState,
  update: (tree: LayoutNode) => { tree: LayoutNode; focusedPaneId?: string },
): LayoutState {
  const tabId = state.activeTabId;
  const tree = treeOf(state, tabId);
  if (!tabId || !tree) return state;
  const next = update(tree);
  if (next.tree === tree && next.focusedPaneId === undefined) return state;
  return {
    ...state,
    trees: { ...state.trees, [tabId]: next.tree },
    focused: next.focusedPaneId ? { ...state.focused, [tabId]: next.focusedPaneId } : state.focused,
  };
}

export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'openTab': {
      const existing = state.tabs.find((tab) => tab.resourceId === action.resourceId);
      const tab = existing ?? { id: tabIdFor(action.resourceId), resourceId: action.resourceId };
      return {
        ...state,
        tabs: existing ? state.tabs : [...state.tabs, tab],
        activeTabId: action.activate === false ? state.activeTabId : tab.id,
      };
    }
    case 'closeTab': {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      // The tab's arrangement goes with it; every resource it showed remains
      // in history and can be reopened.
      const trees = { ...state.trees };
      const focused = { ...state.focused };
      const remembered: ClosedTab = {
        tab: state.tabs[index]!,
        index,
        ...(trees[action.tabId] ? { tree: trees[action.tabId] } : {}),
        ...(focused[action.tabId] ? { focusedPaneId: focused[action.tabId] } : {}),
      };
      delete trees[action.tabId];
      delete focused[action.tabId];
      return {
        ...state,
        tabs,
        trees,
        focused,
        closed: [...state.closed, remembered].slice(-CLOSED_TAB_LIMIT),
        activeTabId:
          state.activeTabId === action.tabId
            ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
            : state.activeTabId,
      };
    }
    case 'reopenTab': {
      const last = state.closed.at(-1);
      if (!last) return state;
      const closed = state.closed.slice(0, -1);
      // Reopening a resource that is already in a tab just shows that tab.
      const open = state.tabs.find((tab) => tab.resourceId === last.tab.resourceId);
      if (open) return { ...state, closed, activeTabId: open.id };
      const tabs = [...state.tabs];
      tabs.splice(Math.min(last.index, tabs.length), 0, last.tab);
      return {
        ...state,
        tabs,
        closed,
        activeTabId: last.tab.id,
        trees: last.tree ? { ...state.trees, [last.tab.id]: last.tree } : state.trees,
        focused: last.focusedPaneId
          ? { ...state.focused, [last.tab.id]: last.focusedPaneId }
          : state.focused,
      };
    }
    case 'moveTab': {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(action.from, 1);
      if (!moved) return state;
      tabs.splice(Math.max(0, Math.min(action.to, tabs.length)), 0, moved);
      return { ...state, tabs };
    }
    case 'replaceDraft': {
      const drafts = { ...state.drafts };
      drafts[action.resourceId] = drafts[action.draftId] ?? '';
      delete drafts[action.draftId];
      const oldTabId = tabIdFor(action.draftId);
      const newTabId = tabIdFor(action.resourceId);
      const trees: Record<string, LayoutNode> = {};
      for (const [tabId, tree] of Object.entries(state.trees)) {
        trees[tabId === oldTabId ? newTabId : tabId] = mapLeaves(tree, (target) =>
          target.resourceId === action.draftId
            ? { ...target, resourceId: action.resourceId }
            : target,
        );
      }
      const focused = { ...state.focused };
      if (focused[oldTabId]) {
        focused[newTabId] = focused[oldTabId];
        delete focused[oldTabId];
      }
      return {
        ...state,
        drafts,
        trees,
        focused,
        tabs: state.tabs.map((tab) =>
          tab.resourceId === action.draftId
            ? { ...tab, id: newTabId, resourceId: action.resourceId }
            : tab,
        ),
        activeTabId: state.activeTabId === oldTabId ? newTabId : state.activeTabId,
      };
    }
    case 'assignPane':
      return withTree(state, (tree) => {
        const pane =
          (action.paneId ? findLeaf(tree, action.paneId) : undefined) ?? focusedPane(state);
        if (!pane) return { tree };
        return {
          tree: replaceLeaf(tree, pane.id, (target) => ({
            ...target,
            resourceId: action.resourceId,
          })),
          focusedPaneId: pane.id,
        };
      });
    case 'split':
      return withTree(state, (tree) => {
        const pane =
          (action.paneId ? findLeaf(tree, action.paneId) : undefined) ?? focusedPane(state);
        if (!pane) return { tree };
        const created = leaf(action.newPaneId, action.resourceId ?? null);
        return {
          tree: replaceLeaf(tree, pane.id, (target) => ({
            type: 'split',
            id: action.splitId,
            direction: action.direction,
            ratio: clampRatio(action.ratio ?? 0.5),
            first: target,
            second: created,
          })),
          focusedPaneId: created.id,
        };
      });
    case 'closePane':
      return withTree(state, (tree) => {
        const panes = leaves(tree);
        if (panes.length <= 1)
          // The last pane empties instead of leaving no workspace at all.
          return { tree: mapLeaves(tree, (target) => ({ ...target, resourceId: null })) };
        const next = removeLeaf(tree, action.paneId);
        if (!next) return { tree };
        return { tree: next, focusedPaneId: leaves(next)[0]?.id };
      });
    case 'focusPane': {
      const tabId = state.activeTabId;
      if (!tabId || !findLeaf(treeOf(state, tabId), action.paneId)) return state;
      return { ...state, focused: { ...state.focused, [tabId]: action.paneId } };
    }
    case 'resize':
      return withTree(state, (tree) => ({ tree: setRatio(tree, action.splitId, action.ratio) }));
    case 'setTree':
      return withTree(state, () => ({
        tree: action.tree,
        focusedPaneId: action.focusedPaneId ?? leaves(action.tree)[0]?.id,
      }));
    case 'mode':
      // Leaving Tiles keeps every tab's tree so returning restores them.
      return { ...state, mode: action.mode };
    case 'collapse':
      return { ...state, collapsed: !state.collapsed };
    case 'focus':
      return { ...state, focus: !state.focus };
    case 'draft':
      return { ...state, drafts: { ...state.drafts, [action.resourceId]: action.text } };
  }
}
