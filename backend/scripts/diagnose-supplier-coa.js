#!/usr/bin/env node
/**
 * Report where a supplier's purchases actually landed in the chart of accounts.
 * Read-only: changes nothing, just prints the truth.
 *
 * Usage (on the city server, from repo root):
 *   docker exec -it nexor-backend node scripts/diagnose-supplier-coa.js "basel"
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const term = (process.argv[2] || '').trim();

function money(v) {
  return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function head(title) {
  console.log('');
  console.log(`=== ${title} ===`);
}

async function q(db, sql, params = []) {
  try {
    const r = await db.query(sql, params);
    return r.rows || [];
  } catch (e) {
    console.log(`  (query failed: ${e.message})`);
    return [];
  }
}

async function main() {
  if (!term) {
    console.error('Usage: node scripts/diagnose-supplier-coa.js "<part of supplier name>"');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }
  const db = require('../src/db');
  const like = `%${term.toLowerCase()}%`;

  console.log(`Diagnosing “${term}” on ${db.engine || 'unknown'} engine`);

  head('Supplier master rows');
  const suppliers = await q(
    db,
    `SELECT id, name, nif FROM suppliers WHERE LOWER(COALESCE(name, '')) LIKE $1 ORDER BY name`,
    [like],
  );
  if (suppliers.length === 0) console.log('  none');
  for (const s of suppliers) console.log(`  ${s.id}  ${s.name}  NIF=${s.nif || '-'}`);
  const supplierIds = suppliers.map((s) => String(s.id));

  head('Chart accounts matching the name');
  const accounts = await q(
    db,
    `SELECT coa.id, coa.code, coa.name, coa.is_header, coa.is_active,
            coa.opening_balance, coa.current_balance,
            (SELECT COUNT(*) FROM journal_entry_lines jel
              WHERE CAST(jel.account_id AS TEXT) = CAST(coa.id AS TEXT)
                 OR CAST(jel.account_id AS TEXT) = CAST(coa.code AS TEXT)) AS lines,
            (SELECT COALESCE(SUM(jel.debit_amount), 0) FROM journal_entry_lines jel
              WHERE CAST(jel.account_id AS TEXT) = CAST(coa.id AS TEXT)
                 OR CAST(jel.account_id AS TEXT) = CAST(coa.code AS TEXT)) AS debits,
            (SELECT COALESCE(SUM(jel.credit_amount), 0) FROM journal_entry_lines jel
              WHERE CAST(jel.account_id AS TEXT) = CAST(coa.id AS TEXT)
                 OR CAST(jel.account_id AS TEXT) = CAST(coa.code AS TEXT)) AS credits
     FROM chart_of_accounts coa
     WHERE LOWER(COALESCE(coa.name, '')) LIKE $1
     ORDER BY coa.code`,
    [like],
  );
  if (accounts.length === 0) console.log('  none — no account carries this name');
  for (const a of accounts) {
    console.log(
      `  ${a.code}  ${a.name}  active=${a.is_active}  header=${a.is_header}  lines=${a.lines}  D=${money(a.debits)}  C=${money(a.credits)}  balance=${money(a.current_balance)}`,
    );
  }
  if (accounts.length > 1) {
    console.log('  ^ more than one account for this name means the postings may be split across duplicates');
  }

  head('Purchase orders');
  const orders = await q(
    db,
    `SELECT id, order_number, supplier_id, supplier_name, status, total
     FROM purchase_orders
     WHERE LOWER(COALESCE(supplier_name, '')) LIKE $1
        OR CAST(supplier_id AS TEXT) = ANY($2)
     ORDER BY created_at`,
    [like, supplierIds.length ? supplierIds : ['']],
  );
  if (orders.length === 0) console.log('  none');
  for (const o of orders) console.log(`  OC ${o.order_number}  ${o.status}  total=${money(o.total)}  id=${o.id}`);

  head('Purchase invoices');
  const invoices = await q(
    db,
    `SELECT id, invoice_number, supplier_id, supplier_name, supplier_account_code, status, total
     FROM purchase_invoices
     WHERE LOWER(COALESCE(supplier_name, '')) LIKE $1
        OR CAST(supplier_id AS TEXT) = ANY($2)
     ORDER BY created_at`,
    [like, supplierIds.length ? supplierIds : ['']],
  );
  if (invoices.length === 0) console.log('  none');
  for (const i of invoices) {
    console.log(
      `  FC ${i.invoice_number}  ${i.status}  total=${money(i.total)}  account_code=${i.supplier_account_code || '(empty)'}  id=${i.id}`,
    );
  }

  head('Journals of those documents, and the accounts they hit');
  const docIds = [...orders.map((o) => String(o.id)), ...invoices.map((i) => String(i.id))];
  if (docIds.length === 0) {
    console.log('  no documents to trace');
  } else {
    const journals = await q(
      db,
      `SELECT id, entry_number, entry_date, reference_type, reference_id, description
       FROM journal_entries
       WHERE CAST(reference_id AS TEXT) = ANY($1)
       ORDER BY entry_date`,
      [docIds],
    );
    if (journals.length === 0) {
      console.log('  NO JOURNAL AT ALL for these documents — nothing was ever posted to accounting');
    }
    for (const j of journals) {
      console.log(`  ${j.entry_number} (${j.reference_type}) ${j.entry_date} — ${j.description || ''}`);
      const lines = await q(
        db,
        `SELECT COALESCE(coa.code, CAST(jel.account_id AS TEXT)) AS code,
                COALESCE(coa.name, '(account row missing)') AS name,
                jel.debit_amount, jel.credit_amount, jel.description
         FROM journal_entry_lines jel
         LEFT JOIN chart_of_accounts coa ON CAST(coa.id AS TEXT) = CAST(jel.account_id AS TEXT)
         WHERE CAST(jel.journal_entry_id AS TEXT) = CAST($1 AS TEXT)
         ORDER BY jel.id`,
        [j.id],
      );
      for (const l of lines) {
        console.log(`      ${l.code}  ${l.name}  D=${money(l.debit_amount)}  C=${money(l.credit_amount)}`);
      }
    }
  }

  head('“por classificar” buckets (money parked away from the real supplier)');
  const classify = await q(
    db,
    `SELECT coa.code, coa.name,
            COUNT(jel.id) AS lines,
            COALESCE(SUM(jel.debit_amount), 0) AS debits,
            COALESCE(SUM(jel.credit_amount), 0) AS credits
     FROM chart_of_accounts coa
     LEFT JOIN journal_entry_lines jel ON CAST(jel.account_id AS TEXT) = CAST(coa.id AS TEXT)
     WHERE LOWER(TRIM(COALESCE(coa.name, ''))) LIKE '%por classificar%'
     GROUP BY coa.code, coa.name
     ORDER BY coa.code`,
  );
  if (classify.length === 0) console.log('  none');
  for (const c of classify) {
    console.log(`  ${c.code}  ${c.name}  lines=${c.lines}  D=${money(c.debits)}  C=${money(c.credits)}`);
  }

  head('Parent 321 / 311 still holding lines directly');
  const parents = await q(
    db,
    `SELECT coa.code, coa.name, COUNT(jel.id) AS lines,
            COALESCE(SUM(jel.debit_amount), 0) AS debits,
            COALESCE(SUM(jel.credit_amount), 0) AS credits
     FROM chart_of_accounts coa
     LEFT JOIN journal_entry_lines jel ON CAST(jel.account_id AS TEXT) = CAST(coa.id AS TEXT)
     WHERE CAST(coa.code AS TEXT) IN ('321', '311')
     GROUP BY coa.code, coa.name`,
  );
  for (const p of parents) {
    console.log(`  ${p.code}  ${p.name}  lines=${p.lines}  D=${money(p.debits)}  C=${money(p.credits)}`);
  }

  head('Supplier/customer leaf accounts on the chart');
  const counts = await q(
    db,
    `SELECT
       SUM(CASE WHEN is_active IS NOT FALSE THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN is_active = false THEN 1 ELSE 0 END) AS inactive,
       SUM(CASE WHEN is_active IS NOT FALSE AND NOT EXISTS (
             SELECT 1 FROM journal_entry_lines jel
             WHERE CAST(jel.account_id AS TEXT) = CAST(chart_of_accounts.id AS TEXT)
           ) THEN 1 ELSE 0 END) AS active_without_movement
     FROM chart_of_accounts
     WHERE (CAST(code AS TEXT) LIKE '321%' OR CAST(code AS TEXT) LIKE '311%')
       AND LENGTH(CAST(code AS TEXT)) >= 8
       AND is_header IS NOT TRUE`,
  );
  for (const c of counts) {
    console.log(`  active=${c.active}  inactive=${c.inactive}  active with no movement=${c.active_without_movement}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
