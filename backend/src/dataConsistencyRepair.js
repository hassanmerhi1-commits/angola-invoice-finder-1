/**
 * Repairs data consistency issues detected by check-data-consistency.cjs
 */
const db = require('./db');
const { loadMainBranchIds } = require('./lib/productSkuResolve');

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

/** Deactivate rows left from old repair that renamed SKUs to *-DUP-* when a canonical SKU still exists. */
async function deactivateDupSuffixProducts() {
  if (!(await tableExists('products'))) return { deactivated: 0 };

  const dupRows = await db.query(
    `SELECT id, sku FROM products
     WHERE COALESCE(is_active, 1) != 0
       AND sku LIKE '%-DUP-%'`,
  );

  let deactivated = 0;
  for (const row of dupRows.rows || []) {
    const sku = String(row.sku || '');
    const baseSku = sku.replace(/-DUP-[a-f0-9]+$/i, '').trim();
    if (!baseSku) continue;
    const canonical = await db.query(
      `SELECT id FROM products
       WHERE id != $1
         AND COALESCE(is_active, 1) != 0
         AND LOWER(TRIM(sku)) = LOWER($2)
       LIMIT 1`,
      [row.id, baseSku],
    );
    if (canonical.rows[0]?.id) {
      await db.query(
        `UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.id],
      );
      deactivated += 1;
    }
  }
  return { deactivated };
}

/** Deactivate extra rows sharing SKU+branch — never rename SKUs to *-DUP-* (breaks catalog/filial pairing). */
async function repairDuplicateProductSkus() {
  if (!(await tableExists('products'))) return { deactivated: 0 };

  const groups = await db.query(
    `SELECT LOWER(TRIM(sku)) AS sku_key, COALESCE(branch_id, '') AS branch_key, COUNT(*) AS n
     FROM products
     WHERE sku IS NOT NULL AND TRIM(sku) != ''
       AND COALESCE(is_active, 1) != 0
     GROUP BY LOWER(TRIM(sku)), COALESCE(branch_id, '')
     HAVING COUNT(*) > 1`,
  );

  let deactivated = 0;
  for (const group of groups.rows || []) {
    const products = await db.query(
      `SELECT p.id, p.sku,
        (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = p.id) AS mov_count,
        p.created_at
       FROM products p
       WHERE LOWER(TRIM(p.sku)) = LOWER($1)
         AND COALESCE(p.branch_id, '') = $2
         AND COALESCE(p.is_active, 1) != 0
       ORDER BY mov_count DESC, p.created_at ASC`,
      [group.sku_key, group.branch_key],
    );
    const rows = products.rows || [];
    for (let i = 1; i < rows.length; i++) {
      await db.query(
        `UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [rows[i].id],
      );
      deactivated += 1;
    }
  }
  return { deactivated };
}

/** Seed opening IN movements where products.stock exists but the ledger is empty. */
async function seedLegacyOpeningStockMovements() {
  const { ensureOpeningStockMovement } = require('./transactionEngine');
  const mainBranches = await db.query(
    `SELECT id FROM branches
     WHERE COALESCE(is_main, false) = true
     ORDER BY CASE WHEN UPPER(TRIM(COALESCE(code, ''))) = 'MAIN' THEN 0 ELSE 1 END`,
  );
  let warehouseIds = (mainBranches.rows || []).map((r) => String(r.id).trim()).filter(Boolean);
  if (warehouseIds.length === 0) {
    const any = await db.query(`SELECT id FROM branches ORDER BY name LIMIT 1`);
    if (any.rows[0]?.id) warehouseIds = [String(any.rows[0].id)];
  }
  if (warehouseIds.length === 0) return { seeded: 0 };

  const products = await db.query(
    `SELECT id, sku, stock
     FROM products
     WHERE is_active IS DISTINCT FROM false`,
  );

  let seeded = 0;
  for (const wh of warehouseIds) {
    for (const p of products.rows || []) {
      const before = await db.query(
        `SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
        [p.id, wh],
      );
      if (Number(before.rows[0]?.n || 0) > 0) continue;
      if (parseFloat(p.stock || 0) <= 0.0001) continue;

      await ensureOpeningStockMovement(db, p.id, wh, null);

      const after = await db.query(
        `SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
        [p.id, wh],
      );
      if (Number(after.rows[0]?.n || 0) > Number(before.rows[0]?.n || 0)) seeded += 1;
    }
  }
  return { seeded };
}

/** Align products.stock with movement ledger per SKU + warehouse (same as POS engine). */
async function reconcileAllSkuStockAtWarehouses() {
  const { reconcileSkuStockAtWarehouse } = require('./transactionEngine');
  if (!(await tableExists('products')) || !(await tableExists('stock_movements'))) {
    return { reconciled: 0 };
  }
  const pairs = await db.query(
    `SELECT DISTINCT TRIM(pm.sku) AS sku, TRIM(sm.warehouse_id) AS wh
     FROM stock_movements sm
     INNER JOIN products pm ON pm.id = sm.product_id
     WHERE TRIM(COALESCE(pm.sku, '')) != ''
       AND TRIM(COALESCE(sm.warehouse_id, '')) != ''`,
  );
  let reconciled = 0;
  for (const row of pairs.rows || []) {
    await reconcileSkuStockAtWarehouse(db, row.sku, row.wh);
    reconciled += 1;
  }
  return { reconciled };
}

/** @deprecated Prefer seedLegacyOpeningStockMovements + reconcileAllSkuStockAtWarehouses */
async function reconcileProductStockFromMovements() {
  const seeded = await seedLegacyOpeningStockMovements();
  const synced = await reconcileAllSkuStockAtWarehouses();
  return { updated: synced.reconciled, seeded: seeded.seeded };
}

async function deactivateDuplicateProductNames() {
  if (!(await tableExists('products'))) return { deactivated: 0 };

  const main = await db.query(
    `SELECT id FROM branches WHERE COALESCE(is_main, 0) != 0 AND COALESCE(is_active, 1) != 0`,
  );
  const mainBranchIds = (main.rows || []).map((r) => String(r.id).trim()).filter(Boolean);

  const normalizeName = (name) =>
    String(name || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');

  const scopeKey = (branchId) => {
    const value = String(branchId ?? '').trim();
    if (!value) return 'catalog';
    if (mainBranchIds.includes(value)) return 'catalog';
    return value;
  };

  const rows = await db.query(
    `SELECT p.id, p.name, p.sku, p.branch_id, p.stock, p.created_at,
      (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = p.id) AS mov_count
     FROM products p
     WHERE COALESCE(p.is_active, 1) != 0`,
  );

  const groups = new Map();
  for (const row of rows.rows || []) {
    const key = `${scopeKey(row.branch_id)}|${normalizeName(row.name)}`;
    if (!key.endsWith('|')) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
  }

  const skipDeactivate = async (row) => {
    const branchKey = String(row.branch_id || '').trim();
    if (branchKey && !mainBranchIds.includes(branchKey)) {
      return true;
    }
    if (!mainBranchIds.length) return false;
    const placeholders = mainBranchIds.map((_, i) => `$${i + 2}`).join(', ');
    const filialOnly = await db.query(
      `SELECT 1
       FROM stock_movements sm
       WHERE sm.product_id = $1
         AND sm.warehouse_id IS NOT NULL
         AND TRIM(sm.warehouse_id) != ''
         AND sm.warehouse_id NOT IN (${placeholders})
       LIMIT 1`,
      [row.id, ...mainBranchIds],
    );
    return filialOnly.rows.length > 0;
  };

  let deactivated = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const movDiff = Number(b.mov_count || 0) - Number(a.mov_count || 0);
      if (movDiff !== 0) return movDiff;
      return Number(b.stock || 0) - Number(a.stock || 0);
    });
    for (let i = 1; i < group.length; i++) {
      if (await skipDeactivate(group[i])) continue;
      await db.query(
        `UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [group[i].id],
      );
      deactivated += 1;
    }
  }
  return { deactivated };
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

  const mainBranchIds = await loadMainBranchIds();
  const mainIn =
    mainBranchIds.length > 0
      ? mainBranchIds.map((_, i) => `$${i + 2}`).join(', ')
      : "''";
  const params = [branchId, ...mainBranchIds];
  const filialOnlyClause =
    mainBranchIds.length > 0
      ? `AND sm.warehouse_id NOT IN (${mainIn})`
      : '';

  const result = await db.query(
    `UPDATE products SET branch_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE (branch_id IS NULL OR TRIM(branch_id) = '')
       AND sku IS NOT NULL AND TRIM(sku) != ''
       AND NOT EXISTS (
         SELECT 1 FROM products p2
         WHERE p2.id != products.id
           AND LOWER(TRIM(p2.sku)) = LOWER(TRIM(products.sku))
           AND p2.branch_id = $1
       )
       AND NOT EXISTS (
         SELECT 1 FROM stock_movements sm
         WHERE sm.product_id = products.id
           AND sm.warehouse_id IS NOT NULL
           AND TRIM(sm.warehouse_id) != ''
           ${filialOnlyClause}
       )`,
    params,
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
    duplicateSkusDeactivated: 0,
    duplicateSkusRenamed: 0,
    duplicateNamesDeactivated: 0,
    productsBranchAssigned: 0,
    openingMovementsSeeded: 0,
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
    report.dupSuffixDeactivated = (await deactivateDupSuffixProducts()).deactivated;
    report.duplicateSkusDeactivated = (await repairDuplicateProductSkus()).deactivated;
    report.duplicateSkusRenamed = report.duplicateSkusDeactivated;
    report.duplicateNamesDeactivated = (await deactivateDuplicateProductNames()).deactivated;
    report.productsBranchAssigned = (await assignBranchToOrphanProducts()).updated;
    const stockRepair = await reconcileProductStockFromMovements();
    report.openingMovementsSeeded = stockRepair.seeded || 0;
    report.productStockReconciled = stockRepair.updated || 0;
    const { ensureFilialProductsFromAllMovements } = require('./lib/filialStockRepair');
    report.filialStockReconciled = await ensureFilialProductsFromAllMovements();
  } catch (e) {
    report.productError = e.message;
  }

  return report;
}

module.exports = {
  runDataConsistencyRepair,
  backfillClientBalancesFromOpenItems,
  repairDuplicateProductSkus,
  deactivateDuplicateProductNames,
  seedLegacyOpeningStockMovements,
  reconcileAllSkuStockAtWarehouses,
  reconcileProductStockFromMovements,
  assignBranchToOrphanProducts,
};
