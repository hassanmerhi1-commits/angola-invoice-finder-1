#!/usr/bin/env node
/**
 * Fix Adjust In / stock that was posted to the wrong branch's product_id.
 *
 * Example: Adjust In for SOYO 01 used a SOYO 03 product row → warehouse_id=SOYO01 but
 * product_id=SOYO03. Inventory then showed the qty under the wrong branch (or not at all).
 *
 *   node scripts/repair-filial-stock-ownership.js              # all filials
 *   node scripts/repair-filial-stock-ownership.js --branch SY01
 *   node scripts/repair-filial-stock-ownership.js --sku 106000024
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }
  const db = require('../src/db');
  if (db.engine !== 'postgres') {
    console.error('This script targets the PostgreSQL server database.');
    process.exit(1);
  }

  const {
    repairFilialWarehouseStockOwnership,
    ensureLocalProductForWarehouseStock,
    reconcileSkuStockAtWarehouse,
    resolveWarehouseId,
  } = require('../src/transactionEngine');
  const { loadMainBranchIds, isCatalogBranchScope, sqlMovementSkuKey } = require('../src/lib/productSkuResolve');
  const { emptyBranchIdClause } = require('../src/lib/sqlDialect');

  const args = process.argv.slice(2);
  const branchIdx = args.indexOf('--branch');
  const branchArg = branchIdx >= 0 ? args[branchIdx + 1] : null;
  const skuIdx = args.indexOf('--sku');
  const skuArg = skuIdx >= 0 ? args[skuIdx + 1] : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const mainBranchIds = await loadMainBranchIds(client);
    const branches = await client.query(
      `SELECT id::text AS id, code, name, is_main FROM branches ORDER BY name`,
    );

    let targets = branches.rows.filter((b) => !isCatalogBranchScope(b.id, mainBranchIds));
    if (branchArg) {
      const wh = await resolveWarehouseId(client, branchArg);
      targets = targets.filter(
        (b) => String(b.id) === String(wh) || String(b.code || '').toLowerCase() === String(branchArg).toLowerCase()
          || String(b.name || '').toLowerCase().includes(String(branchArg).toLowerCase()),
      );
      if (targets.length === 0 && wh) {
        targets = [{ id: wh, code: branchArg, name: branchArg }];
      }
    }

    console.log('');
    console.log('=== repair filial stock ownership ===');
    console.log('filials to repair:', targets.map((b) => b.code || b.name || b.id).join(', ') || '(none)');

    if (skuArg) {
      for (const b of targets) {
        const sample = await client.query(
          `SELECT pm.id
           FROM stock_movements sm
           INNER JOIN products pm ON pm.id = sm.product_id
           WHERE sm.warehouse_id = $1
             AND ${sqlMovementSkuKey('pm')} = LOWER(TRIM($2))
           ORDER BY sm.created_at DESC
           LIMIT 1`,
          [b.id, skuArg],
        );
        if (!sample.rows[0]?.id) {
          console.log(`  ${b.code || b.name}: no movements for SKU ${skuArg}`);
          continue;
        }
        const localId = await ensureLocalProductForWarehouseStock(client, sample.rows[0].id, b.id);
        await reconcileSkuStockAtWarehouse(client, skuArg, b.id);
        console.log(`  ${b.code || b.name}: SKU ${skuArg} → local product ${localId}`);
      }
    } else {
      for (const b of targets) {
        const result = await repairFilialWarehouseStockOwnership(client, b.id);
        console.log(
          `  ${b.code || b.name}: foreign-sku groups=${result.skus}, remapped=${result.remapped}, localised=${result.cloned}`,
        );
      }
    }

    // Spot-check leftover foreign movements
    const leftover = await client.query(
      `SELECT b.code, b.name, COUNT(*)::int AS bad_movements
       FROM stock_movements sm
       INNER JOIN products pm ON pm.id = sm.product_id
       INNER JOIN branches b ON b.id::text = sm.warehouse_id::text
       WHERE TRIM(COALESCE(pm.sku, '')) != ''
         AND pm.branch_id IS NOT NULL
         AND pm.branch_id::text IS DISTINCT FROM sm.warehouse_id::text
         AND NOT (${emptyBranchIdClause(db, 'pm.branch_id')})
       GROUP BY b.code, b.name
       ORDER BY bad_movements DESC
       LIMIT 15`,
    );
    console.log('');
    console.log('=== leftover movements where product.branch ≠ warehouse (should be 0) ===');
    if (leftover.rows.length === 0) console.log('(none)');
    else console.table(leftover.rows);

    await client.query('COMMIT');
    console.log('');
    console.log('Done. Restart backend and hard-refresh Inventory.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
