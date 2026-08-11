/** Short in-memory cache so rapid Sede↔filial switches reuse a warm grid. */
const inventoryGridResultCache = new Map();
const INVENTORY_GRID_RESULT_TTL_MS = 30_000;
const INVENTORY_GRID_HQ_TTL_MS = 30_000;

function inventoryGridResultCacheKey(branchId, consolidated) {
  return consolidated ? 'hq' : `b:${String(branchId || '').trim()}`;
}

function inventoryGridResultTtlMs(consolidated) {
  return consolidated ? INVENTORY_GRID_HQ_TTL_MS : INVENTORY_GRID_RESULT_TTL_MS;
}

function readInventoryGridResultCache(branchId, consolidated) {
  const key = inventoryGridResultCacheKey(branchId, consolidated);
  const hit = inventoryGridResultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > inventoryGridResultTtlMs(consolidated)) {
    inventoryGridResultCache.delete(key);
    return null;
  }
  return hit.rows;
}

function writeInventoryGridResultCache(branchId, consolidated, rows) {
  const key = inventoryGridResultCacheKey(branchId, consolidated);
  inventoryGridResultCache.set(key, { at: Date.now(), rows });
  if (inventoryGridResultCache.size > 40) {
    const oldest = inventoryGridResultCache.keys().next().value;
    if (oldest != null) inventoryGridResultCache.delete(oldest);
  }
}

function invalidateInventoryGridResultCache() {
  inventoryGridResultCache.clear();
}

module.exports = {
  readInventoryGridResultCache,
  writeInventoryGridResultCache,
  invalidateInventoryGridResultCache,
};
