/**
 * Process-lifetime (in-memory) cache for list hooks.
 *
 * Most ERP list hooks (clients, suppliers, categories, sales, …) keep their rows
 * in component-local state and refetch on every mount. On a LAN client that means
 * leaving a tab and coming back triggers a slow re-fetch and a blank screen.
 *
 * This cache lets a hook seed its initial state with the last-known rows (instant
 * render) and then refresh in the background. Fresh TTL (~60s) skips network on
 * quick revisits. Cleared on full reload.
 */

export const LIST_CACHE_FRESH_MS = 60_000;

type CacheEntry = { at: number; value: unknown };

const store = new Map<string, CacheEntry>();

export function getCachedList<T>(key: string): T | undefined {
  const entry = store.get(key);
  return entry ? (entry.value as T) : undefined;
}

/** True when cache has rows and was written within maxAgeMs. */
export function isCachedListFresh(key: string, maxAgeMs = LIST_CACHE_FRESH_MS): boolean {
  const entry = store.get(key);
  if (!entry) return false;
  const value = entry.value;
  const hasData = Array.isArray(value) ? value.length > 0 : value != null;
  if (!hasData) return false;
  return Date.now() - entry.at <= maxAgeMs;
}

export function setCachedList<T>(key: string, value: T): void {
  store.set(key, { at: Date.now(), value });
}

/** Mark cache stale so the next mount refreshes (keeps rows for warm paint). */
export function markCachedListStale(key: string): void {
  const entry = store.get(key);
  if (!entry) return;
  store.set(key, { at: 0, value: entry.value });
}

/** Stale-mark every cached list whose key starts with prefix (e.g. 'products:'). */
export function markCachedListsStaleByPrefix(prefix: string): void {
  for (const [key, entry] of store) {
    if (key.startsWith(prefix)) store.set(key, { at: 0, value: entry.value });
  }
}

export function clearCachedList(key?: string): void {
  if (key) store.delete(key);
  else store.clear();
}

/** Normalize list API payloads — supports legacy arrays and paginated `{ items, hasMore }`. */
export function unwrapListPayload<T>(data: unknown): {
  items: T[];
  hasMore: boolean;
  limit?: number;
  offset?: number;
} {
  if (Array.isArray(data)) return { items: data as T[], hasMore: false };
  const obj = data as { items?: T[]; hasMore?: boolean; limit?: number; offset?: number } | null;
  if (obj && Array.isArray(obj.items)) {
    return {
      items: obj.items,
      hasMore: !!obj.hasMore,
      limit: obj.limit,
      offset: obj.offset,
    };
  }
  return { items: [], hasMore: false };
}
