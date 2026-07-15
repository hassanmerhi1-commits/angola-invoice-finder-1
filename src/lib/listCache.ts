/**
 * Process-lifetime (in-memory) cache for list hooks.
 *
 * Most ERP list hooks (clients, suppliers, categories, sales, …) keep their rows
 * in component-local state and refetch on every mount. On a LAN client that means
 * leaving a tab and coming back triggers a slow re-fetch and a blank screen.
 *
 * This cache lets a hook seed its initial state with the last-known rows (instant
 * render) and then refresh in the background. It is intentionally in-memory only:
 * it survives tab/route navigation within a session but is cleared on a full
 * reload, where the app re-fetches from the server anyway.
 */
const store = new Map<string, unknown>();

export function getCachedList<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCachedList<T>(key: string, value: T): void {
  store.set(key, value);
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
