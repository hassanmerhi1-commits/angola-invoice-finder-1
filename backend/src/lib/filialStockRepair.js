/**
 * Filial stock repair — reconcile only (no new product rows / no SKU renames).
 */

const db = require('../db');
const { coalesceActiveNotZero, emptyBranchIdClause } = require('./sqlDialect');
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
              WHEN ${emptyBranchIdClause(db, 'branch_id')} THEN 1
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
  let merged = 0;
  if (!isCatalog) {
    try {
      ({ merged } = await mergeDupProductMovementsAtWarehouse(wh, q));
    } catch (err) {
      console.warn(`[filialStockRepair] merge DUP @ ${wh}:`, err.message);
    }
  }
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

  // Backfill *missing* selling price / cost on filial rows that have stock or movements.
  // The row filter below also matches rows that only miss a cost, so the price assignment must
  // guard itself: it used to overwrite a perfectly good branch price with the highest price
  // found on any sibling row every time this repair ran.
  let pricesFilled = 0;
  try {
    const skuExpr = sqlMovementSkuKey('p');
    const peerExpr = sqlMovementSkuKey('p2');
    // Prefer GREATEST(price, price2) from peers (PG) / MAX for SQLite.
    const peerBestPrice =
      db.engine === 'postgres'
        ? `GREATEST(COALESCE(p2.price, 0), COALESCE(p2.price2, 0))`
        : `MAX(COALESCE(p2.price, 0), COALESCE(p2.price2, 0))`;
    const filled = await q.query(
      `UPDATE products p SET
         price = CASE
           WHEN COALESCE(p.price, 0) > 0 THEN p.price
           ELSE COALESCE((
             SELECT MAX(${peerBestPrice})
             FROM products p2
             WHERE ${coalesceActiveNotZero(db, 'p2.is_active')}
               AND ${peerExpr} = ${skuExpr}
               AND p2.id != p.id
               AND (${peerBestPrice}) > 0
           ), p.price)
         END,
         last_cost = COALESCE(NULLIF(p.last_cost, 0), (
           SELECT sm.unit_cost FROM stock_movements sm
           WHERE sm.product_id = p.id AND sm.warehouse_id = $1 AND sm.movement_type = 'IN'
             AND COALESCE(sm.unit_cost, 0) > 0
           ORDER BY sm.created_at DESC LIMIT 1
         ), p.last_cost),
         cost = CASE
           WHEN COALESCE(p.cost, 0) > 0 THEN p.cost
           ELSE COALESCE((
             SELECT sm.unit_cost FROM stock_movements sm
             WHERE sm.product_id = p.id AND sm.warehouse_id = $1 AND sm.movement_type = 'IN'
               AND COALESCE(sm.unit_cost, 0) > 0
             ORDER BY sm.created_at DESC LIMIT 1
           ), p.cost)
         END,
         first_cost = CASE
           WHEN COALESCE(p.first_cost, 0) > 0 THEN p.first_cost
           ELSE COALESCE((
             SELECT sm.unit_cost FROM stock_movements sm
             WHERE sm.product_id = p.id AND sm.warehouse_id = $1 AND sm.movement_type = 'IN'
               AND COALESCE(sm.unit_cost, 0) > 0
             ORDER BY sm.created_at ASC LIMIT 1
           ), p.first_cost)
         END,
         avg_cost = CASE
           WHEN COALESCE(p.avg_cost, 0) > 0 THEN p.avg_cost
           ELSE COALESCE((
             SELECT sm.unit_cost FROM stock_movements sm
             WHERE sm.product_id = p.id AND sm.warehouse_id = $1 AND sm.movement_type = 'IN'
               AND COALESCE(sm.unit_cost, 0) > 0
             ORDER BY sm.created_at DESC LIMIT 1
           ), p.avg_cost)
         END,
         updated_at = CURRENT_TIMESTAMP
       WHERE ${coalesceActiveNotZero(db, 'p.is_active')}
         AND p.branch_id = $1
         AND (
           COALESCE(p.stock, 0) > 0
           OR EXISTS (
             SELECT 1 FROM stock_movements sm
             WHERE sm.product_id = p.id AND sm.warehouse_id = $1
           )
         )
         AND (
           COALESCE(p.price, 0) <= 0
           OR COALESCE(p.cost, 0) <= 0
           OR COALESCE(p.last_cost, 0) <= 0
         )`,
      [wh],
    );
    pricesFilled = filled.rowCount || 0;
  } catch (err) {
    console.warn(`[filialStockRepair] price backfill @ ${wh}:`, err.message);
  }

  return { reactivated, merged, reconciled, pricesFilled };
}

async function ensureFilialProductsFromAllMovements() {
  // warehouse_id is UUID on Postgres — never TRIM/COALESCE with ''.
  const warehouses = await db.query(
    db.engine === 'postgres'
      ? `SELECT DISTINCT sm.warehouse_id::text AS id
         FROM stock_movements sm
         WHERE sm.warehouse_id IS NOT NULL`
      : `SELECT DISTINCT sm.warehouse_id AS id
         FROM stock_movements sm
         WHERE sm.warehouse_id IS NOT NULL
           AND TRIM(COALESCE(sm.warehouse_id, '')) != ''`,
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
