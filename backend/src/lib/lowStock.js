/**
 * Low-stock list from the movement ledger (same qty as Inventory), not products.stock.
 *
 * products.stock / products.branch_id are catalog fields — filial qty lives on
 * stock_movements.warehouse_id. min_stock also defaults to 0, so requiring min > 0
 * hid every out-of-stock SKU.
 *
 * A SKU is low when it has warehouse activity and
 * ledger_qty <= max(min_stock, 0)  (out of stock, or at/below a set minimum).
 */
const db = require('../db');
const { coalesceActiveNotZero } = require('./sqlDialect');
const { sqlMovementSkuKey } = require('./productSkuResolve');

function normalizeBranchId(branchId) {
  const key = String(branchId || '').trim();
  if (!key || key === 'all') return '';
  return key;
}

function ledgerCteSql(skuKey, scoped) {
  const whereWarehouse = scoped ? 'WHERE sm.warehouse_id = $1' : '';
  return `
    ledger AS (
      SELECT
        ${skuKey} AS sku_key,
        COALESCE(SUM(
          CASE
            WHEN sm.movement_type = 'IN' THEN sm.quantity
            WHEN sm.movement_type = 'OUT' THEN -sm.quantity
            ELSE 0
          END
        ), 0) AS ledger_stock
      FROM stock_movements sm
      INNER JOIN products pm ON pm.id = sm.product_id
      ${whereWarehouse}
      GROUP BY ${skuKey}
    )`;
}

function minsCteSql() {
  const skuKey = sqlMovementSkuKey('p');
  return `
    mins AS (
      SELECT
        ${skuKey} AS sku_key,
        MAX(COALESCE(p.min_stock, 0)) AS min_stock
      FROM products p
      WHERE ${coalesceActiveNotZero(db, 'p.is_active')}
        AND TRIM(COALESCE(p.sku, '')) != ''
      GROUP BY ${skuKey}
    )`;
}

function pickDisplayRow(prev, row, warehouseId) {
  if (!prev) return row;
  const scoped = String(warehouseId || '');
  const prevLocal = scoped && String(prev.branch_id || '') === scoped;
  const rowLocal = scoped && String(row.branch_id || '') === scoped;
  if (rowLocal && !prevLocal) return row;
  if (prevLocal && !rowLocal) return prev;
  const prevDup = String(prev.sku || '').toLowerCase().includes('-dup-');
  const rowDup = String(row.sku || '').toLowerCase().includes('-dup-');
  if (prevDup && !rowDup) return row;
  if (rowDup && !prevDup) return prev;
  return prev;
}

function dedupeLowStockRows(rows, warehouseId) {
  const bySku = new Map();
  for (const row of rows || []) {
    const key = String(row.sku_key || '').trim() || String(row.id || '');
    bySku.set(key, pickDisplayRow(bySku.get(key), row, warehouseId));
  }
  return Array.from(bySku.values()).sort((a, b) => {
    const stockDelta = Number(a.stock) - Number(b.stock);
    if (stockDelta !== 0) return stockDelta;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

/**
 * @param {{ branchId?: string, limit?: number }} [opts]
 * @returns {Promise<Array<{id, sku, name, stock, min_stock, branch_id, unit}>>}
 */
async function queryLowStockProducts(opts = {}) {
  const branchId = normalizeBranchId(opts.branchId);
  const limit = Number.isFinite(Number(opts.limit)) ? Math.max(1, Number(opts.limit)) : 150;
  const skuKey = sqlMovementSkuKey('pm');
  const pSkuKey = sqlMovementSkuKey('p');
  const params = branchId ? [branchId] : [];

  const sql = `
    WITH ${ledgerCteSql(skuKey, Boolean(branchId))},
    ${minsCteSql()}
    SELECT
      p.id,
      p.sku,
      p.name,
      p.unit,
      p.branch_id,
      ${pSkuKey} AS sku_key,
      l.ledger_stock AS stock,
      COALESCE(m.min_stock, 0) AS min_stock
    FROM ledger l
    LEFT JOIN mins m ON m.sku_key = l.sku_key
    INNER JOIN products p ON ${pSkuKey} = l.sku_key
    WHERE ${coalesceActiveNotZero(db, 'p.is_active')}
      AND l.ledger_stock <= COALESCE(m.min_stock, 0)
  `;

  const result = await db.query(sql, params);
  const rows = dedupeLowStockRows(result.rows, branchId).slice(0, limit);
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    stock: Number(row.stock) || 0,
    min_stock: Number(row.min_stock) || 0,
    branch_id: row.branch_id,
    unit: row.unit,
  }));
}

/**
 * Distinct SKU count matching queryLowStockProducts (no row limit).
 * @param {{ branchId?: string }} [opts]
 */
async function countLowStockProducts(opts = {}) {
  const branchId = normalizeBranchId(opts.branchId);
  const skuKey = sqlMovementSkuKey('pm');
  const params = branchId ? [branchId] : [];

  const sql = `
    WITH ${ledgerCteSql(skuKey, Boolean(branchId))},
    ${minsCteSql()}
    SELECT COUNT(*) AS count
    FROM ledger l
    LEFT JOIN mins m ON m.sku_key = l.sku_key
    WHERE l.ledger_stock <= COALESCE(m.min_stock, 0)
  `;

  const result = await db.query(sql, params);
  const n = Number(result.rows?.[0]?.count);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  queryLowStockProducts,
  countLowStockProducts,
};
