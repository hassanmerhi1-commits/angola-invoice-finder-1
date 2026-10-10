/**
 * In-memory inventory-grid result cache (branch + HQ) with in-flight request sharing.
 *
 * Entries are dropped on every ledger/product write, so the TTL only bounds staleness from
 * writes that bypass the invalidation hooks. A read that started before an invalidation for
 * its scope never writes its (possibly pre-commit) rows back into the cache.
 */
const inventoryGridResultCache = new Map();
const inflight = new Map();
const INVENTORY_GRID_RESULT_TTL_MS = 120_000;
const MAX_ENTRIES = 40;
/** Ledger writes invalidate inside the transaction; repeat after commit has likely landed. */
const POST_COMMIT_REINVALIDATE_MS = 1_500;

let seq = 0;
let globalInvalidatedSeq = 0;
const keyInvalidatedSeq = new Map();

function normalizeScopeId(id) {
  return String(id || '').trim().toLowerCase().replace(/-/g, '');
}

function inventoryGridResultCacheKey(branchId, consolidated) {
  return consolidated ? 'hq' : `b:${normalizeScopeId(branchId)}`;
}

function lastInvalidationFor(key) {
  return Math.max(globalInvalidatedSeq, keyInvalidatedSeq.get(key) || 0);
}

function readInventoryGridResultCache(branchId, consolidated) {
  const key = inventoryGridResultCacheKey(branchId, consolidated);
  const hit = inventoryGridResultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > INVENTORY_GRID_RESULT_TTL_MS) {
    inventoryGridResultCache.delete(key);
    return null;
  }
  return hit.rows;
}

function writeInventoryGridResultCache(branchId, consolidated, rows, ticket = seq) {
  const key = inventoryGridResultCacheKey(branchId, consolidated);
  if (lastInvalidationFor(key) > ticket) return;
  inventoryGridResultCache.delete(key);
  inventoryGridResultCache.set(key, { at: Date.now(), rows });
  while (inventoryGridResultCache.size > MAX_ENTRIES) {
    const oldest = inventoryGridResultCache.keys().next().value;
    if (oldest == null) break;
    inventoryGridResultCache.delete(oldest);
  }
}

function invalidateNow(warehouseIds) {
  seq += 1;
  if (!warehouseIds) {
    globalInvalidatedSeq = seq;
    inventoryGridResultCache.clear();
    return;
  }
  for (const key of ['hq', ...warehouseIds.map((id) => `b:${normalizeScopeId(id)}`)]) {
    keyInvalidatedSeq.set(key, seq);
    inventoryGridResultCache.delete(key);
  }
}

/**
 * Drop cached grids. With warehouse ids, only those branches + HQ (a sale at one shop does
 * not change another shop's grid); without, everything.
 */
function invalidateInventoryGridResultCache(warehouseIds) {
  const ids = Array.isArray(warehouseIds)
    ? warehouseIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null;
  const scoped = ids && ids.length > 0 ? ids : null;
  invalidateNow(scoped);
  const timer = setTimeout(() => invalidateNow(scoped), POST_COMMIT_REINVALIDATE_MS);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * Cached rows, or one shared load per scope. Concurrent callers (every till refreshing after
 * the same socket event) reuse the same query instead of each running the full grid SQL.
 * `loader` resolves `{ rows, cacheable }`; degraded fallback rows are shared but not cached.
 */
async function loadInventoryGridRowsShared(branchId, consolidated, loader, { skipCache = false } = {}) {
  const key = inventoryGridResultCacheKey(branchId, consolidated);
  if (!skipCache) {
    const cached = readInventoryGridResultCache(branchId, consolidated);
    if (cached) return cached;
  }
  const running = inflight.get(key);
  if (running && running.ticket >= lastInvalidationFor(key)) {
    return running.promise;
  }
  const ticket = seq;
  const promise = (async () => {
    try {
      const { rows, cacheable = true } = await Promise.resolve().then(loader);
      if (cacheable) writeInventoryGridResultCache(branchId, consolidated, rows, ticket);
      return rows;
    } finally {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    }
  })();
  inflight.set(key, { ticket, promise });
  return promise;
}

module.exports = {
  readInventoryGridResultCache,
  writeInventoryGridResultCache,
  invalidateInventoryGridResultCache,
  loadInventoryGridRowsShared,
};
