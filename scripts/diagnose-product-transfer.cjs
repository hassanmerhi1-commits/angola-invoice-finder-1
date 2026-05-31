#!/usr/bin/env node
/** Diagnose one product across transfers and branch inventory. */
const path = require('path');
const fs = require('fs');

const PRODUCT_NEEDLE = process.argv[2] || 'ACUCAR ALIMO';
const paths = [
  process.argv[3],
  'C:\\nexor\\erp.db',
  path.join(process.env.APPDATA || '', 'NEXOR ERP', 'erp.db'),
  'C:\\NEXOR ERP\\data\\erp.db',
].filter(Boolean);

let Database;
try {
  Database = require(path.join(__dirname, '../backend/node_modules/better-sqlite3'));
} catch {
  console.error('Run from repo with backend/node_modules');
  process.exit(1);
}

function diag(dbPath) {
  if (!fs.existsSync(dbPath)) return;
  console.log('\n==========', dbPath, '==========');
  const db = new Database(dbPath, { readonly: true });

  const branches = db.prepare(
    `SELECT id, name, code, is_main FROM branches WHERE COALESCE(is_active,1)!=0 ORDER BY name`,
  ).all();
  console.log('Branches:', branches.map((b) => `${b.name} [${b.id}] main=${b.is_main}`).join('\n  '));

  const products = db.prepare(
    `SELECT id, name, sku, branch_id, stock, is_active,
      (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = products.id) AS mov_n
     FROM products
     WHERE LOWER(name) LIKE LOWER(?)
     ORDER BY is_active DESC, mov_n DESC`,
  ).all(`%${PRODUCT_NEEDLE}%`);
  console.log(`\nProducts matching "${PRODUCT_NEEDLE}":`, products.length);
  for (const p of products) {
    console.log(`  id=${p.id.slice(0, 8)}… sku="${p.sku}" branch=${p.branch_id || 'NULL'} stock=${p.stock} active=${p.is_active} movs=${p.mov_n}`);
    const movs = db.prepare(
      `SELECT sm.warehouse_id, b.name AS wh_name, sm.movement_type, sm.quantity, sm.reference_type, sm.reference_number, sm.created_at
       FROM stock_movements sm
       LEFT JOIN branches b ON b.id = sm.warehouse_id
       WHERE sm.product_id = ?
       ORDER BY sm.created_at DESC LIMIT 8`,
    ).all(p.id);
    for (const m of movs) {
      console.log(`    ${m.movement_type} ${m.quantity} @ ${m.wh_name || m.warehouse_id} ref=${m.reference_number || m.reference_type}`);
    }
  }

  const transfers = db.prepare(
    `SELECT st.transfer_number, st.status, st.from_branch_name, st.to_branch_name,
            st.to_branch_id, st.received_at, sti.quantity, sti.received_quantity, sti.product_id
     FROM stock_transfers st
     JOIN stock_transfer_items sti ON sti.transfer_id = st.id
     JOIN products p ON p.id = sti.product_id
     WHERE LOWER(p.name) LIKE LOWER(?)
     ORDER BY st.created_at DESC`,
  ).all(`%${PRODUCT_NEEDLE}%`);
  console.log('\nTransfers:', transfers.length);
  for (const t of transfers) {
    console.log(
      `  ${t.transfer_number} ${t.status} ${t.from_branch_name} -> ${t.to_branch_name} (${t.to_branch_id}) qty=${t.quantity} recv=${t.received_quantity} at=${t.received_at || '-'}`,
    );
  }

  const soyo = branches.find((b) => /soyo/i.test(b.name || b.code || ''));
  if (soyo) {
    const wh = soyo.id;
    const skuRows = db.prepare(
      `SELECT LOWER(TRIM(pm.sku)) AS sku_key,
        COALESCE(SUM(CASE WHEN sm.movement_type='IN' THEN sm.quantity WHEN sm.movement_type='OUT' THEN -sm.quantity ELSE 0 END),0) AS ledger
       FROM stock_movements sm
       JOIN products pm ON pm.id = sm.product_id
       WHERE sm.warehouse_id = ? AND LOWER(pm.name) LIKE LOWER(?)
       GROUP BY LOWER(TRIM(pm.sku))`,
    ).all(wh, `%${PRODUCT_NEEDLE}%`);
    console.log(`\nSoyo warehouse ledger for name match:`, skuRows);

    const anyMov = db.prepare(
      `SELECT pm.id, pm.sku, pm.branch_id, pm.is_active, sm.movement_type, sm.quantity
       FROM stock_movements sm
       JOIN products pm ON pm.id = sm.product_id
       WHERE sm.warehouse_id = ? AND LOWER(pm.name) LIKE LOWER(?)`,
    ).all(wh, `%${PRODUCT_NEEDLE}%`);
    console.log('Movements at Soyo for this name:', anyMov.length);
    anyMov.forEach((r) => console.log(`  prod branch=${r.branch_id} sku="${r.sku}" ${r.movement_type} ${r.quantity} active=${r.is_active}`));
  }

  db.close();
}

const seen = new Set();
for (const p of paths) {
  const key = p && path.normalize(p).toLowerCase();
  if (!key || seen.has(key)) continue;
  seen.add(key);
  try {
    diag(p);
  } catch (e) {
    console.log('ERR', p, e.message);
  }
}
