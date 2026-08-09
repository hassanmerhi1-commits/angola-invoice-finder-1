import { api } from '@/lib/api/client';

export type PrefetchedLedgerRow = Record<string, unknown>;

type CacheEntry = {
  at: number;
  from: string;
  to: string;
  rows: PrefetchedLedgerRow[];
  error?: string;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function cacheKey(accountId: string, from: string, to: string): string {
  return `${accountId}|${from}|${to}`;
}

export function lastDaysBounds(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  const iso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { from: iso(from), to: iso(to) };
}

/** Fire-and-forget warm of leaf ledger so double-click often hits memory. */
export function prefetchAccountLedger(
  accountId: string,
  opts?: { days?: number; limit?: number },
): void {
  const id = String(accountId || '').trim();
  if (!id) return;
  const days = opts?.days ?? 7;
  const limit = opts?.limit ?? 50;
  const { from, to } = lastDaysBounds(days);
  const key = cacheKey(id, from, to);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return;
  if (inflight.has(key)) return;

  const promise = (async (): Promise<CacheEntry> => {
    try {
      let res = await api.chartOfAccounts.getLedger(id, from, to, undefined, { limit });
      if (res.error) {
        const entry: CacheEntry = { at: Date.now(), from, to, rows: [], error: String(res.error) };
        cache.set(key, entry);
        return entry;
      }
      const entry: CacheEntry = {
        at: Date.now(),
        from,
        to,
        rows: (res.data || []) as PrefetchedLedgerRow[],
      };
      cache.set(key, entry);
      return entry;
    } catch (e) {
      const entry: CacheEntry = {
        at: Date.now(),
        from,
        to,
        rows: [],
        error: e instanceof Error ? e.message : String(e),
      };
      cache.set(key, entry);
      return entry;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
}

export function takePrefetchedLedger(
  accountId: string,
  from: string,
  to: string,
): PrefetchedLedgerRow[] | null {
  const key = cacheKey(String(accountId || '').trim(), from, to);
  const hit = cache.get(key);
  if (!hit || hit.error) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.rows;
}

export async function awaitPrefetchedLedger(
  accountId: string,
  from: string,
  to: string,
): Promise<PrefetchedLedgerRow[] | null> {
  const key = cacheKey(String(accountId || '').trim(), from, to);
  const pending = inflight.get(key);
  if (pending) {
    const entry = await pending;
    if (entry.error) return null;
    return entry.rows;
  }
  return takePrefetchedLedger(accountId, from, to);
}
