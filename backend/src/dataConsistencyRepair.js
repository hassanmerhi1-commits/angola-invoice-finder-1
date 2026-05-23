/**
 * Repairs data consistency issues detected by check-data-consistency.cjs
 */
const db = require('./db');

async function tableExists(name) {
  if (db.engine === 'postgres') {
    const r = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
      [name],
    );
    return r.rows.length > 0;
  }
  const r = await db.query(
    `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = $1 LIMIT 1`,
    [name],
  );
  return r.rows.length > 0;
}

async function backfillClientBalancesFromOpenItems() {
  if (!(await tableExists('clients')) || !(await tableExists('open_items'))) {
    return { updated: 0 };
  }
  const result = await db.query(
    `UPDATE clients SET current_balance = COALESCE((
       SELECT SUM(CASE WHEN oi.is_debit = 1 OR oi.is_debit = TRUE THEN oi.remaining_amount ELSE -oi.remaining_amount END)
       FROM open_items oi
       WHERE oi.entity_type = 'customer' AND oi.entity_id = clients.id
     ), 0),
     updated_at = CURRENT_TIMESTAMP`,
  );
  return { updated: result.rowCount || 0 };
}

async function repairDuplicateProductSkus() {
  if (!(await tableExists('products'))) return { renamed: 0 };

  const groups = await db.query(
    `SELECT LOWER(TRIM(sku)) AS sku_key, COALESCE(branch_id, '') AS branch_key, COUNT(*) AS n
     FROM products
     WHERE sku IS NOT NULL AND TRIM(sku) != ''
     GROUP BY LOWER(TRIM(sku)), COALESCE(branch_id, '')
     HAVING COUNT(*) > 1`,
  );

  let renamed = 0;
  for (const group of groups.rows || []) {
    const products = await db.query(
      `SELECT p.id, p.sku,
        (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = p.id) AS mov_count,
        p.created_at
       FROM products p
       WHERE LOWER(TRIM(p.sku)) = LOWER($1)
         AND COALESCE(p.branch_id, '') = $2
       ORDER BY mov_count DESC, p.created_at ASC`,
      [group.sku_key, group.branch_key],
    );
    const rows = products.rows || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const suffix = String(row.id).replace(/-/g, '').slice(0, 8);
      const newSku = `${row.sku}-DUP-${suffix}`;
      await db.query(
        `UPDATE products SET sku = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newSku, row.id],
      );
      renamed += 1;
    }
  }
  return { renamed };
}

async function reconcileProductStockFromMovements() {
  if (!(await tableExists('products')) || !(await tableExists('stock_movements'))) {
    return { updated: 0 };
  }
  const result = await db.query(
    `UPDATE products SET stock = COALESCE((
       SELECT SUM(
         CASE
           WHEN sm.movement_type = 'IN' THEN sm.quantity
           WHEN sm.movement_type = 'OUT' THEN -sm.quantity
           ELSE 0
         END
       )
       FROM stock_movements sm
       WHERE sm.product_id = products.id
     ), 0),
     updated_at = CURRENT_TIMESTAMP`,
  );
  return { updated: result.rowCount || 0 };
}

async function assignBranchToOrphanProducts() {
  if (!(await tableExists('products')) || !(await tableExists('branches'))) {
    return { updated: 0 };
  }
  const main = await db.query(
    `SELECT id FROM branches WHERE is_main = 1 OR is_main = TRUE ORDER BY created_at LIMIT 1`,
  );
  const branchId = main.rows[0]?.id
    || (await db.query(`SELECT id FROM branches ORDER BY created_at LIMIT 1`)).rows[0]?.id;
  if (!branchId) return { updated: 0 };

  const result = await db.query(
    `UPDATE products SET branch_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE (branch_id IS NULL OR TRIM(branch_id) = '')
       AND sku IS NOT NULL AND TRIM(sku) != ''
       AND NOT EXISTS (
         SELECT 1 FROM products p2
         WHERE p2.id != products.id
           AND LOWER(TRIM(p2.sku)) = LOWER(TRIM(products.sku))
           AND p2.branch_id = $1
       )`,
    [branchId],
  );
  return { updated: result.rowCount || 0 };
}

/**
 * Run all automated repairs (safe for production; idempotent).
 */
async function runDataConsistencyRepair() {
  const report = {
    supplierReturns: { repaired: 0 },
    supplierBalances: { updated: 0 },
    clientBalances: { updated: 0 },
    duplicateSkusRenamed: 0,
    productsBranchAssigned: 0,
    productStockReconciled: 0,
  };

  const { runSupplierBalanceRepair } = require('./supplierBalanceRepair');

  try {
    report.supplierRepair = await runSupplierBalanceRepair();
    report.supplierBalances = { updated: report.supplierRepair?.updated ?? 0 };
  } catch (e) {
    report.supplierError = e.message;
  }

  try {
    report.clientBalances = await backfillClientBalancesFromOpenItems();
  } catch (e) {
    report.clientError = e.message;
  }

  try {
    report.duplicateSkusRenamed = (await repairDuplicateProductSkus()).renamed;
    report.productsBranchAssigned = (await assignBranchToOrphanProducts()).updated;
    report.productStockReconciled = (await reconcileProductStockFromMovements()).updated;
  } catch (e) {
    report.productError = e.message;
  }

  return report;
}

module.exports = {
  runDataConsistencyRepair,
  backfillClientBalancesFromOpenItems,
  repairDuplicateProductSkus,
  reconcileProductStockFromMovements,
  assignBranchToOrphanProducts,
};
