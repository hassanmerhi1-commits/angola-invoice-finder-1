#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadDbUrl() {
  const envPath = process.env.NEXOR_DATABASE_ENV || 'C:\\NEXOR ERP\\database.env';
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim();
    }
  }
  return process.env.DATABASE_URL || '';
}

async function main() {
  const url = loadDbUrl();
  if (!url) throw new Error('No DATABASE_URL — is database.env present?');
  const { Pool } = require(path.join(__dirname, '../backend/node_modules/pg'));
  const pool = new Pool({ connectionString: url });
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  console.log('[DB] PostgreSQL');
  console.log('\n=== LAST INVOICES ===');
  console.table(await q(
    `SELECT invoice_number, warehouse_id, branch_id, created_at::text, status
     FROM purchase_invoices ORDER BY created_at DESC LIMIT 8`,
  ));
  console.log('\n=== RECENT PURCHASE MOVEMENTS ===');
  console.table(await q(
    `SELECT sm.warehouse_id, p.sku, sm.movement_type, sm.quantity::float,
            sm.reference_number, sm.created_at::text
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     WHERE sm.reference_type IN ('purchase_invoice', 'purchase')
     ORDER BY sm.created_at DESC LIMIT 10`,
  ));
  console.log('\n=== OPEN ITEMS (supplier) recent ===');
  console.table(await q(
    `SELECT document_number, original_amount::float, remaining_amount::float,
            branch_id, created_at::text
     FROM open_items WHERE entity_type = 'supplier'
     ORDER BY created_at DESC LIMIT 8`,
  ));
  const branches = await q(`SELECT id, name, is_main FROM branches ORDER BY name`);
  console.log('\n=== BRANCHES ===');
  console.table(branches);
  const checkNos = ['FC-MAIN-2026-3389', 'FC-MAIN-2026-0280', 'FC-MAIN-2026-2705'];
  console.log('\n=== INVOICE vs MOVEMENTS (recent saves) ===');
  for (const no of checkNos) {
    const inv = await q(
      `SELECT id, lines_json FROM purchase_invoices WHERE invoice_number = $1 LIMIT 1`,
      [no],
    );
    if (!inv[0]) {
      console.log(no, 'NOT FOUND');
      continue;
    }
    const lines = inv[0].lines_json;
    const arr = Array.isArray(lines) ? lines : (typeof lines === 'string' ? JSON.parse(lines) : []);
    const sm = await q(`SELECT COUNT(*)::int AS c FROM stock_movements WHERE reference_id = $1`, [inv[0].id]);
    const oi = await q(`SELECT COUNT(*)::int AS c FROM open_items WHERE document_id = $1`, [inv[0].id]);
    const je = await q(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE reference_id = $1`, [inv[0].id]);
    console.log(no, {
      id: inv[0].id,
      lines: arr.length,
      sampleQty: arr[0]?.totalQty ?? arr[0]?.quantity,
      sampleProductId: arr[0]?.productId,
      stockMovements: sm[0].c,
      openItems: oi[0].c,
      journalEntries: je[0].c,
    });
  }

  const orphanCount = await q(
    `SELECT COUNT(*)::int AS c
     FROM purchase_invoices pi
     WHERE COALESCE(pi.status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
       AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.reference_id = pi.id)
       AND pi.created_at > NOW() - INTERVAL '7 days'`,
  );
  console.log('Orphan invoices (7d, no stock movements):', orphanCount[0].c);

  for (const b of branches) {
    const ledger = await q(
      `SELECT LOWER(TRIM(COALESCE(p.sku, ''))) AS sku,
              SUM(CASE WHEN sm.movement_type = 'IN' THEN sm.quantity
                       WHEN sm.movement_type = 'OUT' THEN -sm.quantity ELSE 0 END)::float AS ledger
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       WHERE sm.warehouse_id = $1
       GROUP BY LOWER(TRIM(COALESCE(p.sku, '')))
       HAVING SUM(CASE WHEN sm.movement_type = 'IN' THEN sm.quantity
                       WHEN sm.movement_type = 'OUT' THEN -sm.quantity ELSE 0 END) > 0.0001
       ORDER BY ledger DESC LIMIT 3`,
      [b.id],
    );
    if (ledger.length) {
      console.log(`\n=== LEDGER @ ${b.name} (${b.id}) ===`);
      console.table(ledger);
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
