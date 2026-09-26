export interface ResourceView {
  id: string;
  resourceId: string;
}

export interface LayoutState {
  views: ResourceView[];
  activeViewId: string | null;
  mode: 'single' | 'tiles';
  collapsed: boolean;
  focus: boolean;
  drafts: Record<string, string>;
}

export const initialLayout: LayoutState = {
  views: [],
  activeViewId: null,
  mode: 'single',
  collapsed: false,
  focus: false,
  drafts: {},
};

export type LayoutAction =
  | { type: 'open'; resourceId: string }
  | { type: 'close'; viewId: string }
  | { type: 'mode'; mode: LayoutState['mode'] }
  | { type: 'collapse' }
  | { type: 'focus' }
  | { type: 'draft'; resourceId: string; text: string }
  | { type: 'replaceDraft'; draftId: string; resourceId: string };

// This reducer knows only view identities and draft text. No session lifecycle
// operation can be emitted by closing/unmounting a view.
export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
  switch (action.type) {
    case 'open': {
      const existing = state.views.find((view) => view.resourceId === action.resourceId);
      const view = existing ?? { id: `view:${action.resourceId}`, resourceId: action.resourceId };
      return {
        ...state,
        views: existing ? state.views : [...state.views, view],
        activeViewId: view.id,
      };
    }
    case 'close': {
      const index = state.views.findIndex((view) => view.id === action.viewId);
      const views = state.views.filter((view) => view.id !== action.viewId);
      return {
        ...state,
        views,
        activeViewId:
          state.activeViewId === action.viewId
            ? (views[Math.min(index, views.length - 1)]?.id ?? null)
            : state.activeViewId,
      };
    }
    case 'mode':
      return { ...state, mode: action.mode };
    case 'collapse':
      return { ...state, collapsed: !state.collapsed };
    case 'focus':
      return { ...state, focus: !state.focus };
    case 'draft':
      return { ...state, drafts: { ...state.drafts, [action.resourceId]: action.text } };
    case 'replaceDraft': {
      const drafts = { ...state.drafts };
      drafts[action.resourceId] = drafts[action.draftId] ?? '';
      delete drafts[action.draftId];
      return {
        ...state,
        drafts,
        views: state.views.map((view) =>
          view.resourceId === action.draftId ? { ...view, resourceId: action.resourceId } : view,
        ),
      };
    }
  }
}
