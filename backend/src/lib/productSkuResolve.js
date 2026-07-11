/**
 * Resolve products by SKU + branch scope (catalog NULL vs filial rows).
 * Shared by products API and transaction engine to avoid UNIQUE(sku, branch_id) clashes.
 */

const db = require('../db');
const { headOfficeBranchWhere, orderByActiveDesc, emptyBranchIdClause } = require('./sqlDialect');
const { branchKeysEqual, normalizeBranchIdKey } = require('./branchIdMatch');

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
    `SELECT id FROM branches WHERE ${headOfficeBranchWhere(db)}`,
  );
  mainBranchIdsCache = result.rows.map((row) => String(row.id).trim()).filter(Boolean);
  mainBranchIdsCacheAt = now;
  return mainBranchIdsCache;
}

function isCatalogBranchScope(branchId, mainBranchIds) {
  if (branchId == null || String(branchId).trim() === '') return true;
  const key = String(branchId).trim();
  return mainBranchIds.some((mid) => branchKeysEqual(mid, key));
}

/** branch_id stored on products for sede/catalog (UNIQUE with sku). */
function normalizeStoredBranchId(branchId, mainBranchIds) {
  const key = branchId == null ? '' : String(branchId).trim();
  if (!key) return null;
  if (mainBranchIds.some((mid) => branchKeysEqual(mid, key))) return null;
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
         AND ${emptyBranchIdClause(db, 'branch_id')}
       ORDER BY ${orderByActiveDesc(db, 'is_active')} DESC, updated_at DESC, created_at DESC
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
       ORDER BY ${orderByActiveDesc(db, 'is_active')} DESC, updated_at DESC, created_at DESC
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
         ORDER BY ${orderByActiveDesc(db, 'is_active')} DESC, updated_at DESC, created_at DESC
         LIMIT 1`,
        [skuTrim, mainId],
      );
      if (legacy.rows.length > 0) return pick(legacy.rows);
    }
  }

  // Raw warehouse id (may differ from stored NULL for sede) — exact + dashless UUID
  const byWarehouse = await client.query(
    `SELECT id, name, sku, branch_id, is_active
     FROM products
     WHERE LOWER(TRIM(COALESCE(sku, ''))) = LOWER($1)
       AND (
         branch_id = $2
         OR REPLACE(LOWER(TRIM(COALESCE(${db.engine === 'postgres' ? 'branch_id::text' : 'CAST(branch_id AS TEXT)'}, ''))), '-', '') = $3
       )
     ORDER BY ${orderByActiveDesc(db, 'is_active')} DESC, updated_at DESC, created_at DESC
     LIMIT 1`,
    [skuTrim, toBranch, normalizeBranchIdKey(toBranch)],
  );
  if (byWarehouse.rows.length > 0) return pick(byWarehouse.rows);

  return null;
}

function isUniqueSkuBranchError(err) {
  const msg = String(err?.message || err || '');
  return /unique|duplicate|UNIQUE constraint/i.test(msg)
    && /sku|branch_id/i.test(msg);
}

const DUP_SKU_SUFFIX_RE = /-DUP-[a-f0-9]+$/i;

/** Strip legacy repair suffix so ledger qty matches catalog SKU in grids. */
function canonicalSkuString(sku) {
  const raw = String(sku || '').trim();
  if (!raw) return '';
  const base = raw.replace(DUP_SKU_SUFFIX_RE, '').trim();
  return base || raw;
}

/** Canonical SKU text (id fallback when sku empty). */
function sqlCanonicalSkuText(alias = 'pm') {
  const raw = `TRIM(COALESCE(${alias}.sku, ''))`;
  if (db.engine === 'postgres') {
    return `CASE
      WHEN ${raw} = '' THEN ${alias}.id::text
      WHEN POSITION('-dup-' IN LOWER(${raw})) > 0
        THEN TRIM(SUBSTRING(${raw} FROM 1 FOR POSITION('-dup-' IN LOWER(${raw})) - 1))
      ELSE ${raw}
    END`;
  }
  return `CASE
    WHEN ${raw} = '' THEN CAST(${alias}.id AS TEXT)
    WHEN INSTR(LOWER(${raw}), '-dup-') > 0
      THEN TRIM(SUBSTR(${raw}, 1, INSTR(LOWER(${raw}), '-dup-') - 1))
    ELSE ${raw}
  END`;
}

/** Lowercase key for movement ledger / inventory grid (canonical SKU). */
function sqlMovementSkuKey(alias = 'pm') {
  return `LOWER(TRIM(${sqlCanonicalSkuText(alias)}))`;
}

module.exports = {
  loadMainBranchIds,
  isCatalogBranchScope,
  normalizeStoredBranchId,
  findProductBySkuAndBranch,
  isUniqueSkuBranchError,
  canonicalSkuString,
  sqlCanonicalSkuText,
  sqlMovementSkuKey,
};
