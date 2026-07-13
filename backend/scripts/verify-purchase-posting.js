#!/usr/bin/env node
/**
 * Prove whether repaired purchases actually exist in stock / payables / journal.
 * Run inside Docker:
 *   docker compose exec backend node scripts/verify-purchase-posting.js
 *   docker compose exec backend node scripts/verify-purchase-posting.js FC-SY05
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: 'C:\\NEXOR ERP\\database.env' });

async function detectDatabase() {
  if (process.env.DATABASE_URL) return;
  const { Client } = require('pg');
  const url = `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    process.env.DATABASE_URL = url;
    process.env.DB_ENGINE = 'postgres';
  } catch (e) {
    console.error('No PostgreSQL:', e.message);
    process.exit(1);
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

async function main() {
  await detectDatabase();
  const db = require('../src/db');
  await db.query('SELECT 1');

  const filter = process.argv.find((a) => /^FC-/i.test(a)) || 'FC-SY05';
  const inv = await db.query(
    `SELECT id, invoice_number, branch_id, warehouse_id, supplier_id, supplier_name, total, date::text AS date
     FROM purchase_invoices
     WHERE invoice_number ILIKE $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [`%${filter}%`],
  );

  console.log('==================================================================');
  console.log(`Verify purchase posting (filter=${filter})`);
  console.log('==================================================================');

  if (!inv.rows.length) {
    console.log('No invoices matched.');
    process.exit(1);
  }

  for (const row of inv.rows) {
    const stock = await db.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(quantity),0)::float AS qty
       FROM stock_movements
       WHERE reference_id = $1 AND reference_type IN ('purchase_invoice','purchase')`,
      [row.id],
    );
    const oi = await db.query(
      `SELECT id, remaining_amount, status, branch_id::text AS branch_id
       FROM open_items WHERE document_id = $1 AND entity_type = 'supplier' LIMIT 1`,
      [row.id],
    );
    const je = await db.query(
      `SELECT id, entry_number, total_debit, total_credit
       FROM journal_entries WHERE reference_id = $1 LIMIT 1`,
      [row.id],
    );
    const stockN = stock.rows[0]?.n || 0;
    const qty = stock.rows[0]?.qty || 0;
    const payable = oi.rows[0];
    const journal = je.rows[0];

    console.log('');
    console.log(`${row.invoice_number}  total=${row.total}  branch=${row.branch_id}`);
    console.log(`  stock_movements : ${stockN} (qty=${qty}) ${stockN ? 'OK' : 'MISSING'}`);
    console.log(
      `  open_item       : ${payable ? `${payable.id} rem=${payable.remaining_amount} status=${payable.status}` : 'MISSING'}`,
    );
    console.log(
      `  journal_entry   : ${journal ? `${journal.entry_number} D=${journal.total_debit} C=${journal.total_credit}` : 'MISSING'}`,
    );

    if (stockN > 0) {
      const prod = await db.query(
        `SELECT p.sku, p.name, p.branch_id::text AS product_branch, p.stock,
                sm.warehouse_id::text AS warehouse, sm.quantity
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         WHERE sm.reference_id = $1
         LIMIT 5`,
        [row.id],
      );
      for (const p of prod.rows) {
        console.log(
          `    SKU ${p.sku} qty=${p.quantity} warehouse=${p.warehouse} product.branch=${p.product_branch} products.stock=${p.stock}`,
        );
      }
    }
  }

  // Sample chart balances for purchase accounts
  const coa = await db.query(
    `SELECT code, name, current_balance FROM chart_of_accounts
     WHERE code IN ('212','3451','321') OR code LIKE '321%'
     ORDER BY code LIMIT 15`,
  );
  console.log('');
  console.log('Chart sample balances:');
  for (const a of coa.rows) {
    console.log(`  ${a.code} ${a.name}: ${a.current_balance}`);
  }

  // Payables query for Soyo 05 (the one the UI uses)
  const soyo05 = 'ab040158-9f8a-4d7f-8ff9-621de1277c64';
  try {
    const { listSupplierPayables } = require('../src/lib/supplierPayablesList');
    const rows = await listSupplierPayables(db, { branchId: soyo05 });
    const sy05 = rows.filter((r) => String(r.document_number || '').includes('SY05'));
    console.log('');
    console.log(`listSupplierPayables(Soyo05) total=${rows.length} SY05 docs=${sy05.length}`);
    for (const r of sy05.slice(0, 10)) {
      console.log(`  ${r.document_number} ${r.supplier_name} rem=${r.remaining_amount}`);
    }
  } catch (e) {
    console.log('');
    console.log('listSupplierPayables FAILED:', e.message);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
