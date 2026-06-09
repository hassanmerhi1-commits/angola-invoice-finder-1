/**
 * Filial stock repair — reconcile only (no new product rows / no SKU renames).
 */

const db = require('../db');
const { coalesceActiveNotZero } = require('./sqlDialect');
const {
  isCatalogBranchScope,
  loadMainBranchIds,
  sqlMovementSkuKey,
} = require('./productSkuResolve');

/** Any product that received stock movements at this warehouse (incl. wrongly keyed branch-main / -DUP- rows). */
async function reactivateFilialProductsWithMovements(warehouseId, clientOrDb = null) {
  const wh = String(warehouseId || '').trim();
  if (!wh) return 0;
  const q = clientOrDb || db;
  const result = await q.query(
    `UPDATE products
     SET is_active = true, updated_at = CURRENT_TIMESTAMP
     WHERE ${db.engine === 'postgres' ? 'is_active IS FALSE' : 'COALESCE(is_active, 0) = 0'}
       AND id IN (
         SELECT DISTINCT sm.product_id
         FROM stock_movements sm
         WHERE sm.warehouse_id = $1
       )`,
    [wh],
  );
  return result.rowCount || 0;
}

/** Move ledger lines from *-DUP-* rows onto the canonical SKU product at this warehouse. */
async function mergeDupProductMovementsAtWarehouse(warehouseId, clientOrDb = null) {
  const wh = String(warehouseId || '').trim();
  if (!wh) return { merged: 0 };
  const q = clientOrDb || db;
  const dupRows = await q.query(
    `SELECT p.id, p.sku
     FROM products p
     WHERE p.sku LIKE '%-DUP-%'
       AND id IN (
         SELECT DISTINCT sm.product_id FROM stock_movements sm WHERE sm.warehouse_id = $1
       )`,
    [wh],
  );
  let merged = 0;
  for (const row of dupRows.rows || []) {
    const baseSku = String(row.sku || '').replace(/-DUP-[a-f0-9]+$/i, '').trim();
    if (!baseSku) continue;
    const canonical = await q.query(
      `SELECT id FROM products
       WHERE id != $1
         AND ${coalesceActiveNotZero(db, 'is_active')}
         AND LOWER(TRIM(sku)) = LOWER($2)
       ORDER BY
         CASE WHEN branch_id = $3 THEN 0
              WHEN branch_id IS NULL OR TRIM(COALESCE(branch_id, '')) = '' THEN 1
              ELSE 2 END,
         updated_at DESC
       LIMIT 1`,
      [row.id, baseSku, wh],
    );
    const targetId = canonical.rows[0]?.id;
    if (!targetId) continue;
    const moved = await q.query(
      `UPDATE stock_movements SET product_id = $1 WHERE product_id = $2 AND warehouse_id = $3`,
      [targetId, row.id, wh],
    );
    if ((moved.rowCount || 0) > 0) {
      await q.query(
        `UPDATE products SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.id],
      );
      merged += moved.rowCount || 0;
    }
  }
  return { merged };
}

async function listSkusWithLedgerAtWarehouse(client, warehouseId) {
  const result = await client.query(
    `SELECT ${sqlMovementSkuKey('pm')} AS sku_key
     FROM stock_movements sm
     INNER JOIN products pm ON pm.id = sm.product_id
     WHERE sm.warehouse_id = $1
     GROUP BY ${sqlMovementSkuKey('pm')}
     HAVING COALESCE(SUM(
         CASE
           WHEN sm.movement_type = 'IN' THEN sm.quantity
           WHEN sm.movement_type = 'OUT' THEN -sm.quantity
           ELSE 0
         END
       ), 0) > 0.0001`,
    [warehouseId],
  );
  return result.rows || [];
}

/**
 * Sync products.stock from movement ledger for this warehouse (no clones).
 */
async function ensureFilialProductsForWarehouse(warehouseId, clientOrDb = null) {
  const wh = String(warehouseId || '').trim();
  if (!wh) return { reactivated: 0, merged: 0, reconciled: 0 };

  const q = clientOrDb || db;
  const mainBranchIds = await loadMainBranchIds(q);
  const isCatalog = isCatalogBranchScope(wh, mainBranchIds);

  const { reconcileSkuStockAtWarehouse } = require('../transactionEngine');
  const reactivated = await reactivateFilialProductsWithMovements(wh, q);
  const { merged } = isCatalog
    ? { merged: 0 }
    : await mergeDupProductMovementsAtWarehouse(wh, q);
  const skus = await listSkusWithLedgerAtWarehouse(q, wh);
  let reconciled = 0;

  for (const row of skus) {
    const skuKey = String(row.sku_key || '').trim();
    if (!skuKey) continue;
    try {
      await reconcileSkuStockAtWarehouse(q, skuKey, wh);
      reconciled += 1;
    } catch (err) {
      console.warn(`[filialStockRepair] reconcile ${skuKey} @ ${wh}:`, err.message);
    }
  }

  return { reactivated, merged, reconciled };
}

async function ensureFilialProductsFromAllMovements() {
  const warehouses = await db.query(
    `SELECT DISTINCT sm.warehouse_id AS id
     FROM stock_movements sm
     WHERE sm.warehouse_id IS NOT NULL
       AND TRIM(sm.warehouse_id) != ''`,
  );

  let reactivated = 0;
  let merged = 0;
  let reconciled = 0;
  for (const row of warehouses.rows || []) {
    const stats = await ensureFilialProductsForWarehouse(row.id);
    reactivated += stats.reactivated;
    merged += stats.merged || 0;
    reconciled += stats.reconciled;
  }
  return { reactivated, merged, reconciled };
}

module.exports = {
  ensureFilialProductsForWarehouse,
  ensureFilialProductsFromAllMovements,
  reactivateFilialProductsWithMovements,
};
