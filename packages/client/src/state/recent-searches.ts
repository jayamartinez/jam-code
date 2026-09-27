/**
 * Recent search queries, kept in this browser profile only. They are a
 * convenience for the reader, never sent to the runtime or synchronized.
 */

export const RECENT_SEARCH_LIMIT = 6;
const KEY = 'jam.recentSearches';

/** Most recent first, case-insensitively unique, bounded. */
export function rememberSearch(list: string[], query: string): string[] {
  const trimmed = query.trim().slice(0, 256);
  if (!trimmed) return list;
  const key = trimmed.toLowerCase();
  return [trimmed, ...list.filter((item) => item.toLowerCase() !== key)].slice(
    0,
    RECENT_SEARCH_LIMIT,
  );
}

export function loadRecentSearches(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string' && item.length <= 256)
          .slice(0, RECENT_SEARCH_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function saveRecentSearches(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Blocked storage only loses the convenience.
  }
}
