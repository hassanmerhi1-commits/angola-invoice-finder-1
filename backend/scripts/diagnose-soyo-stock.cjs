#!/usr/bin/env node
/** Diagnose Soyo / filial stock — run: node scripts/diagnose-soyo-stock.js [path-to-erp.db] */
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.argv[2] || process.env.SQLITE_PATH || 'C:\\nexor\\erp.db';

function diag(db, label) {
  console.log('\n==========', label, dbPath, '==========');
  const branches = db
    .prepare(
      `SELECT id, name, code, is_main FROM branches WHERE COALESCE(is_active,1)!=0 ORDER BY name`,
    )
    .all();
  const soyo = branches.filter((b) => /soyo/i.test(String(b.name || b.code || '')));
  console.log('Branches:', branches.map((b) => `${b.name} (${b.id}) main=${b.is_main}`).join('\n  '));
  if (!soyo.length) {
    console.log('No branch matching Soyo — check branch names above.');
  }

  for (const br of soyo.length ? soyo : branches.filter((b) => !b.is_main).slice(0, 3)) {
    const wh = br.id;
    const transfers = db
      .prepare(
        `SELECT transfer_number, status, from_branch_name, to_branch_name, received_at
         FROM stock_transfers
         WHERE to_branch_id = ? OR from_branch_id = ?
         ORDER BY created_at DESC LIMIT 10`,
      )
      .all(wh, wh);
    console.log(`\n--- ${br.name} (${wh}) transfers:`, transfers.length);
    transfers.forEach((t) =>
      console.log(`  ${t.transfer_number} ${t.status} ${t.from_branch_name} -> ${t.to_branch_name} received=${t.received_at || '-'}`),
    );

    const movs = db
      .prepare(
        `SELECT COUNT(*) AS n,
          COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity WHEN movement_type='OUT' THEN -quantity ELSE 0 END),0) AS net
         FROM stock_movements WHERE warehouse_id = ?`,
      )
      .get(wh);
    console.log(`  movements at warehouse: count=${movs.n} net=${movs.net}`);

    const skuRows = db
      .prepare(
        `SELECT LOWER(TRIM(pm.sku)) AS sku,
          COALESCE(SUM(CASE WHEN sm.movement_type='IN' THEN sm.quantity WHEN sm.movement_type='OUT' THEN -sm.quantity ELSE 0 END),0) AS ledger
         FROM stock_movements sm
         JOIN products pm ON pm.id = sm.product_id
         WHERE sm.warehouse_id = ? AND TRIM(COALESCE(pm.sku,'')) != ''
         GROUP BY LOWER(TRIM(pm.sku))
         HAVING ledger > 0
         ORDER BY ledger DESC LIMIT 15`,
      )
      .all(wh);
    console.log(`  SKUs with ledger > 0: ${skuRows.length}`);
    skuRows.slice(0, 8).forEach((r) => console.log(`    ${r.sku}: ${r.ledger}`));

    const activeFilial = db
      .prepare(
        `SELECT COUNT(*) AS n FROM products WHERE branch_id = ? AND COALESCE(is_active,1)!=0`,
      )
      .get(wh);
    const inactiveWithMov = db
      .prepare(
        `SELECT COUNT(*) AS n FROM products p
         WHERE p.branch_id = ? AND COALESCE(p.is_active,0)=0
           AND EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id = p.id AND sm.warehouse_id = ?)`,
      )
      .get(wh, wh);
    console.log(`  active products branch_id=${wh}: ${activeFilial.n}`);
    console.log(`  inactive products with movements: ${inactiveWithMov.n}`);
  }
}

for (const p of [
  dbPath,
  'C:\\nexor\\erp.db',
  path.join(process.env.APPDATA || '', 'NEXOR ERP', 'erp.db'),
]) {
  try {
    if (!require('fs').existsSync(p)) continue;
    const db = new Database(p, { readonly: true });
    diag(db, path.basename(path.dirname(p)) + '/' + path.basename(p));
    db.close();
  } catch (e) {
    console.log('Skip', p, e.message);
  }
}
