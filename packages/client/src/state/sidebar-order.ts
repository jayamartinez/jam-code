/**
 * The sidebar's arrangement: which section sits above which, and the order of
 * projects. The reader sets both by dragging and the runtime stores them.
 * Chats are not part of it; their lists sort by latest activity.
 */

/** A list with the item at `from` moved to `to`; out-of-range moves change nothing. */
export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * Moves an item among the ones that are shown. An item that is not shown (the
 * Pinned section while nothing is pinned) keeps its place in the whole order,
 * so it returns where the reader left it.
 */
export function movedAmongShown<T>(
  all: readonly T[],
  shown: readonly T[],
  from: number,
  to: number,
): T[] {
  const arranged = moved(shown, from, to);
  let next = 0;
  return all.map((item) => (shown.includes(item) ? arranged[next++]! : item));
}
