import { useEffect, useSyncExternalStore } from 'react';

/**
 * A native Browser view always paints above JAM's own interface: no HTML,
 * z-index or backdrop can cover it. Anything JAM floats over the workspace —
 * menus, dialogs, the launcher — registers here while open, and native views
 * hide until the last one closes. The page keeps running while hidden.
 */

let open = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function occludeNativeViews(): () => void {
  open += 1;
  if (open === 1) notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open -= 1;
    if (open === 0) notify();
  };
}

/** Register an overlay for as long as `active` is true and it is mounted. */
export function useOccludesNativeViews(active = true) {
  useEffect(() => (active ? occludeNativeViews() : undefined), [active]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
/** Whether any overlay currently covers the workspace. */
export const nativeViewsOccluded = () => open > 0;

export function useNativeViewsOccluded() {
  return useSyncExternalStore(subscribe, nativeViewsOccluded, nativeViewsOccluded);
}
