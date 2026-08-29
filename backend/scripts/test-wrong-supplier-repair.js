#!/usr/bin/env node
/**
 * Reproduces the BASEL ANGOLA case and checks that the repair moves the credit onto
 * the right supplier. Runs on node:sqlite with a minimal schema, so it needs no
 * database server and no native module build.
 *
 * Usage: node backend/scripts/test-wrong-supplier-repair.js
 */
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('crypto');

const sqlite = new DatabaseSync(':memory:');

/** Minimal pg-shaped wrapper: $1 placeholders, { rows, rowCount } results. */
const db = {
  engine: 'sqlite',
  async query(sql, params = []) {
    const text = sql.replace(/\$(\d+)/g, '?');
    const stmt = sqlite.prepare(text);
    if (/^\s*(select|with)/i.test(text)) {
      return { rows: stmt.all(...params), rowCount: 0 };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: Number(info.changes || 0) };
  },
};

sqlite.exec(`
  CREATE TABLE chart_of_accounts (
    id TEXT PRIMARY KEY, code TEXT UNIQUE, name TEXT, description TEXT,
    account_type TEXT, account_nature TEXT, parent_id TEXT, level INTEGER,
    is_header INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
    opening_balance REAL DEFAULT 0, current_balance REAL DEFAULT 0,
    children_count INTEGER DEFAULT 0
  );
  CREATE TABLE journal_entries (
    id TEXT PRIMARY KEY, entry_number TEXT, entry_date TEXT, description TEXT,
    reference_type TEXT, reference_id TEXT, created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE journal_entry_lines (
    id TEXT PRIMARY KEY, journal_entry_id TEXT, account_id TEXT,
    debit_amount REAL DEFAULT 0, credit_amount REAL DEFAULT 0, description TEXT
  );
  CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT, nif TEXT);
  CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT, nif TEXT);
  CREATE TABLE purchase_invoices (
    id TEXT PRIMARY KEY, invoice_number TEXT, supplier_account_code TEXT,
    supplier_name TEXT, supplier_id TEXT, total REAL DEFAULT 0, status TEXT
  );
  CREATE TABLE purchase_orders (
    id TEXT PRIMARY KEY, order_number TEXT, supplier_name TEXT, supplier_id TEXT,
    total REAL DEFAULT 0, status TEXT
  );
`);

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL  ${message}`);
    return false;
  }
  console.log(`ok    ${message}`);
  return true;
}

async function main() {
  const { remapMisattributedSupplierLines } = require('../src/lib/repairParentEntityCoa');

  const parentId = randomUUID();
  const abricomeId = randomUUID();
  const goodsId = randomUUID();
  const soyoId = randomUUID();
  const supplierId = randomUUID();
  const invoiceId = randomUUID();
  const journalId = randomUUID();
  const wrongLineId = randomUUID();

  await db.query(
    `INSERT INTO chart_of_accounts (id, code, name, description, account_type, account_nature, level, is_header, is_active)
     VALUES ($1, '321', 'Fornecedores - correntes', '', 'liability', 'credit', 2, 0, 1)`,
    [parentId],
  );
  // ABRICOME's NIF text contains BASEL ANGOLA's NIF (3210008) as a fragment.
  await db.query(
    `INSERT INTO chart_of_accounts (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active)
     VALUES ($1, '32100008', 'ABRICOME', 'NIF: 32100089', 'liability', 'credit', $2, 3, 0, 1)`,
    [abricomeId, parentId],
  );
  // A different supplier that merely starts with the same words.
  await db.query(
    `INSERT INTO chart_of_accounts (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active)
     VALUES ($1, '32100262', 'BASEL ANGOLA SOYO', 'NIF: 32130007', 'liability', 'credit', $2, 3, 0, 1)`,
    [soyoId, parentId],
  );
  await db.query(
    `INSERT INTO chart_of_accounts (id, code, name, description, account_type, account_nature, level, is_header, is_active)
     VALUES ($1, '212', 'Mercadorias', '', 'asset', 'debit', 2, 0, 1)`,
    [goodsId],
  );
  await db.query(`INSERT INTO suppliers (id, name, nif) VALUES ($1, 'BASEL ANGOLA', '3210008')`, [supplierId]);
  await db.query(
    `INSERT INTO purchase_invoices (id, invoice_number, supplier_account_code, supplier_name, supplier_id, total, status)
     VALUES ($1, 'FC-SY07-2026-00003', '32100008', 'BASEL ANGOLA', $2, 21926856.23, 'confirmed')`,
    [invoiceId, supplierId],
  );
  await db.query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id)
     VALUES ($1, 'CP-2026-01346', '2026-08-06', 'Fatura de Compra FC-SY07-2026-00003 — BASEL ANGOLA', 'purchase_invoice', $2)`,
    [journalId, invoiceId],
  );
  await db.query(
    `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, description)
     VALUES ($1, $2, $3, 21926856.23, 0, 'Mercadorias')`,
    [randomUUID(), journalId, goodsId],
  );
  await db.query(
    `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, description)
     VALUES ($1, $2, $3, 0, 21926856.23, 'BASEL ANGOLA')`,
    [wrongLineId, journalId, abricomeId],
  );

  const countAccounts = async () =>
    Number((await db.query(`SELECT COUNT(*) AS n FROM chart_of_accounts`)).rows[0].n);
  const accountsBefore = await countAccounts();

  const dry = await remapMisattributedSupplierLines(db, { dryRun: true });
  assert(!dry.failed, `scan runs without a SQL error (${dry.failed || 'none'})`);
  assert(dry.checked === 1, `scan sees the supplier line (checked=${dry.checked})`);
  assert(dry.moved === 1, `dry run flags the wrong account (moved=${dry.moved})`);
  assert(await countAccounts() === accountsBefore, 'dry run creates no accounts');
  const untouched = (await db.query(`SELECT account_id FROM journal_entry_lines WHERE id = $1`, [wrongLineId]))
    .rows[0].account_id;
  assert(untouched === abricomeId, 'dry run moves no lines');

  const run = await remapMisattributedSupplierLines(db);
  for (const d of run.details) console.log(`      ${d}`);
  assert(run.moved === 1, `repair moves one line (moved=${run.moved})`);
  assert(run.invoicesFixed === 1, `repair corrects the stored code (invoices=${run.invoicesFixed})`);

  const landed = (await db.query(
    `SELECT coa.code, coa.name FROM journal_entry_lines jel
     INNER JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE jel.id = $1`,
    [wrongLineId],
  )).rows[0] || {};
  console.log(`      credit now on ${landed.code} — ${landed.name}`);
  assert(String(landed.name || '').toUpperCase() === 'BASEL ANGOLA', 'credit sits on BASEL ANGOLA');
  assert(landed.code !== '32100008', 'credit is off ABRICOME');
  assert(landed.code !== '32100262', 'credit did not land on BASEL ANGOLA SOYO');

  const left = await db.query(
    `SELECT COUNT(*) AS n FROM journal_entry_lines WHERE account_id = $1`,
    [abricomeId],
  );
  assert(Number(left.rows[0].n) === 0, 'ABRICOME keeps no lines');

  const inv = await db.query(`SELECT supplier_account_code FROM purchase_invoices WHERE id = $1`, [invoiceId]);
  console.log(`      invoice supplier_account_code = ${inv.rows[0].supplier_account_code}`);
  assert(inv.rows[0].supplier_account_code === landed.code, 'invoice now points at the supplier account');

  const again = await remapMisattributedSupplierLines(db);
  assert(again.moved === 0, `re-running is a no-op (moved=${again.moved})`);

  console.log(failures ? `\nFAILED (${failures})` : '\nPASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
