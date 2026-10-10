/**
 * Per-warehouse qty for one SKU — same ledger as HQ inventory grid.
 * Uses product_id IN (…) so idx_stock_movements_product can be used.
 */

const rootDb = require('../db');
const { coalesceMainTruthy } = require('./sqlDialect');
const {
  resolveProductIdsForMovementSku,
  expandProductIdVariants,
} = require('./productSkuResolve');
const { normalizeBranchIdKey } = require('./branchIdMatch');

function dialectDb(queryable) {
  return queryable?.engine ? queryable : rootDb;
}

function idTextSql(queryable, expr) {
  return dialectDb(queryable).engine === 'postgres'
    ? `COALESCE(${expr}::text, '')`
    : `COALESCE(CAST(${expr} AS TEXT), '')`;
}

/**
 * @param {import('../db')} db
 * @param {string} sku
 * @param {string} [productId]
 * @returns {Promise<{ sku: string, rows: Array<{
 *   branchId: string,
 *   branchName: string,
 *   branchCode: string,
 *   isMain: boolean,
 *   stock: number,
 * }> }>}
 */
async function listStockBySku(db, sku, productId) {
  const skuTrim = String(sku || '').trim();
  const ids = expandProductIdVariants(
    await resolveProductIdsForMovementSku(db, skuTrim, productId),
  );

  const [branchesResult, stockResult] = await Promise.all([
    db.query(
      `SELECT ${idTextSql(db, 'id')} AS id, name, code, is_main
       FROM branches
       ORDER BY
         CASE WHEN ${coalesceMainTruthy(dialectDb(db), 'is_main')} THEN 0 ELSE 1 END,
         name`,
    ),
    ids.length === 0
      ? Promise.resolve({ rows: [] })
      : db.query(
          `SELECT
             ${idTextSql(db, 'sm.warehouse_id')} AS warehouse_id,
             COALESCE(SUM(
               CASE
                 WHEN sm.movement_type = 'IN' THEN sm.quantity
                 WHEN sm.movement_type = 'OUT' THEN -sm.quantity
                 ELSE 0
               END
             ), 0) AS ledger
           FROM stock_movements sm
           WHERE sm.product_id IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})
           GROUP BY sm.warehouse_id`,
          ids,
        ),
  ]);

  const stockByWarehouse = new Map();
  for (const row of stockResult.rows || []) {
    const wh = String(row.warehouse_id || '').trim();
    if (!wh) continue;
    const key = normalizeBranchIdKey(wh);
    stockByWarehouse.set(key, (stockByWarehouse.get(key) || 0) + (Number(row.ledger) || 0));
  }

  const used = new Set();
  const rows = (branchesResult.rows || []).map((b) => {
    const id = String(b.id || '').trim();
    const key = normalizeBranchIdKey(id);
    used.add(key);
    return {
      branchId: id,
      branchName: b.name || b.code || id,
      branchCode: b.code || '',
      isMain: Boolean(b.is_main),
      stock: Math.max(0, Number(stockByWarehouse.get(key)) || 0),
    };
  });

  for (const [key, ledger] of stockByWarehouse) {
    if (used.has(key)) continue;
    const stock = Math.max(0, Number(ledger) || 0);
    if (!(stock > 0.0001)) continue;
    used.add(key);
    rows.push({
      branchId: key,
      branchName: key,
      branchCode: '',
      isMain: false,
      stock,
    });
  }

  return { sku: skuTrim, rows };
}

module.exports = { listStockBySku };
