/**
 * Resolve products by SKU + branch scope (catalog NULL vs filial rows).
 * Shared by products API and transaction engine to avoid UNIQUE(sku, branch_id) clashes.
 */

let mainBranchIdsCache = null;
let mainBranchIdsCacheAt = 0;
const MAIN_BRANCH_CACHE_MS = 60_000;

async function loadMainBranchIds(clientOrDb) {
  const q = clientOrDb || require('../db');
  const now = Date.now();
  if (mainBranchIdsCache && now - mainBranchIdsCacheAt < MAIN_BRANCH_CACHE_MS) {
    return mainBranchIdsCache;
  }
  const result = await q.query(
    `SELECT id FROM branches WHERE COALESCE(is_main, 0) != 0 AND COALESCE(is_active, 1) != 0`,
  );
  mainBranchIdsCache = result.rows.map((row) => String(row.id).trim()).filter(Boolean);
  mainBranchIdsCacheAt = now;
  return mainBranchIdsCache;
}

function isCatalogBranchScope(branchId, mainBranchIds) {
  if (branchId == null || String(branchId).trim() === '') return true;
  return mainBranchIds.includes(String(branchId).trim());
}

/** branch_id stored on products for sede/catalog (UNIQUE with sku). */
function normalizeStoredBranchId(branchId, mainBranchIds) {
  const key = branchId == null ? '' : String(branchId).trim();
  if (!key) return null;
  if (mainBranchIds.includes(key)) return null;
  return key;
}

/**
 * Find any product row for this SKU at the warehouse, including inactive and legacy main ids.
 * @param {object} client - db or transaction client
 * @param {string} sku
 * @param {string} branchId - warehouse / filial id
 */
async function findProductBySkuAndBranch(client, sku, branchId) {
  const skuTrim = String(sku || '').trim();
  const toBranch = String(branchId || '').trim();
  if (!skuTrim || !toBranch) return null;

  const mainBranchIds = await loadMainBranchIds(client);
  const storedBranch = normalizeStoredBranchId(toBranch, mainBranchIds);

  const pick = (rows) => rows[0] || null;

  // Exact stored branch key (filial id or NULL for catalog)
  if (storedBranch == null) {
    const catalog = await client.query(
      `SELECT id, name, sku, branch_id, is_active
       FROM products
       WHERE LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
         AND (branch_id IS NULL OR TRIM(COALESCE(branch_id, '')) = '')
       ORDER BY COALESCE(is_active, 1) DESC, updated_at DESC, created_at DESC
       LIMIT 1`,
      [skuTrim],
    );
    if (catalog.rows.length > 0) return pick(catalog.rows);
  } else {
    const exact = await client.query(
      `SELECT id, name, sku, branch_id, is_active
       FROM products
       WHERE LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
         AND branch_id = $2
       ORDER BY COALESCE(is_active, 1) DESC, updated_at DESC, created_at DESC
       LIMIT 1`,
      [skuTrim, storedBranch],
    );
    if (exact.rows.length > 0) return pick(exact.rows);
  }

  // Legacy: main warehouse rows still keyed with branch_id = sede id instead of NULL
  if (isCatalogBranchScope(toBranch, mainBranchIds)) {
    for (const mainId of mainBranchIds) {
      const legacy = await client.query(
        `SELECT id, name, sku, branch_id, is_active
         FROM products
         WHERE LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
           AND branch_id = $2
         ORDER BY COALESCE(is_active, 1) DESC, updated_at DESC, created_at DESC
         LIMIT 1`,
        [skuTrim, mainId],
      );
      if (legacy.rows.length > 0) return pick(legacy.rows);
    }
  }

  // Raw warehouse id (may differ from stored NULL for sede)
  const byWarehouse = await client.query(
    `SELECT id, name, sku, branch_id, is_active
     FROM products
     WHERE LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
       AND branch_id = $2
     ORDER BY COALESCE(is_active, 1) DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [skuTrim, toBranch],
  );
  return pick(byWarehouse.rows);
}

function isUniqueSkuBranchError(err) {
  const msg = String(err?.message || err || '');
  return /unique|duplicate|UNIQUE constraint/i.test(msg)
    && /sku|branch_id/i.test(msg);
}

module.exports = {
  loadMainBranchIds,
  isCatalogBranchScope,
  normalizeStoredBranchId,
  findProductBySkuAndBranch,
  isUniqueSkuBranchError,
};
