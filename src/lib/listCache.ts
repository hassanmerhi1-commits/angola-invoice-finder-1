/**
 * Process-lifetime + sessionStorage cache for list hooks.
 *
 * Seed instantly from last-known rows, refresh in the background.
 * Survives color-theme reloads (full page reload) via sessionStorage —
 * without that, Invoices/Journals felt "slow again" after every theme switch.
 */

export const LIST_CACHE_FRESH_MS = 180_000; // 3 min — Tailscale revisits stay warm
const SESSION_PREFIX = 'nexor:list-cache:v1:';
/** Bound session payload size (approx) — skip huge dumps. */
const SESSION_MAX_CHARS = 1_800_000;

type CacheEntry = { at: number; value: unknown };

const store = new Map<string, CacheEntry>();

function readSession(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(key: string, entry: CacheEntry): void {
  try {
    const raw = JSON.stringify(entry);
    if (raw.length > SESSION_MAX_CHARS) return;
    sessionStorage.setItem(SESSION_PREFIX + key, raw);
  } catch {
    /* quota / private mode */
  }
}

function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(SESSION_PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function getCachedList<T>(key: string): T | undefined {
  const mem = store.get(key);
  if (mem) return mem.value as T;
  const session = readSession(key);
  if (!session) return undefined;
  store.set(key, session);
  return session.value as T;
}

/** True when cache has rows and was written within maxAgeMs. */
export function isCachedListFresh(key: string, maxAgeMs = LIST_CACHE_FRESH_MS): boolean {
  let entry = store.get(key);
  if (!entry) {
    const session = readSession(key);
    if (session) {
      store.set(key, session);
      entry = session;
    }
  }
  if (!entry) return false;
  const value = entry.value;
  const hasData = Array.isArray(value) ? value.length > 0 : value != null;
  if (!hasData) return false;
  return Date.now() - entry.at <= maxAgeMs;
}

export function setCachedList<T>(key: string, value: T): void {
  const entry: CacheEntry = { at: Date.now(), value };
  store.set(key, entry);
  writeSession(key, entry);
}

/** Mark cache stale so the next mount refreshes (keeps rows for warm paint). */
export function markCachedListStale(key: string): void {
  const mem = store.get(key) ?? readSession(key);
  if (!mem) return;
  const entry: CacheEntry = { at: 0, value: mem.value };
  store.set(key, entry);
  writeSession(key, entry);
}

/** Stale-mark every cached list whose key starts with prefix (e.g. 'products:'). */
export function markCachedListsStaleByPrefix(prefix: string): void {
  for (const [key, entry] of store) {
    if (!key.startsWith(prefix)) continue;
    const next: CacheEntry = { at: 0, value: entry.value };
    store.set(key, next);
    writeSession(key, next);
  }
  // Also stale-mark session keys we may not have in memory yet.
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const full = sessionStorage.key(i);
      if (!full || !full.startsWith(SESSION_PREFIX)) continue;
      const key = full.slice(SESSION_PREFIX.length);
      if (!key.startsWith(prefix)) continue;
      const session = readSession(key);
      if (!session) continue;
      const next: CacheEntry = { at: 0, value: session.value };
      store.set(key, next);
      writeSession(key, next);
    }
  } catch {
    /* ignore */
  }
}

export function clearCachedList(key?: string): void {
  if (key) {
    store.delete(key);
    removeSession(key);
    return;
  }
  store.clear();
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const full = sessionStorage.key(i);
      if (full?.startsWith(SESSION_PREFIX)) toRemove.push(full);
    }
    for (const full of toRemove) sessionStorage.removeItem(full);
  } catch {
    /* ignore */
  }
}

/** Normalize list API payloads — supports legacy arrays and paginated `{ items, hasMore }`. */
export function unwrapListPayload<T>(data: unknown): {
  items: T[];
  hasMore: boolean;
  limit?: number;
  offset?: number;
  total?: number;
  totals?: { debit?: number; credit?: number };
} {
  if (Array.isArray(data)) return { items: data as T[], hasMore: false };
  const obj = data as {
    items?: T[];
    hasMore?: boolean;
    limit?: number;
    offset?: number;
    total?: number;
    totals?: { debit?: number; credit?: number };
  } | null;
  if (obj && Array.isArray(obj.items)) {
    return {
      items: obj.items,
      hasMore: !!obj.hasMore,
      limit: obj.limit,
      offset: obj.offset,
      total: obj.total,
      totals: obj.totals,
    };
  }
  return { items: [], hasMore: false };
}
