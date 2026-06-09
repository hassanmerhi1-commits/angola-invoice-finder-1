#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadDbUrl() {
  const envPath = process.env.NEXOR_DATABASE_ENV || 'C:\\NEXOR ERP\\database.env';
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL=(.+)$/);
    if (m) return m[1].trim();
  }
  return process.env.DATABASE_URL || '';
}

async function main() {
  process.env.DATABASE_URL = loadDbUrl();
  process.env.DB_ENGINE = 'postgres';
  const db = require(path.join(__dirname, '../backend/src/db'));

  const nos = ['FC-MAIN-2026-3389', 'FC-MAIN-2026-0280', 'FC-MAIN-2026-2705', 'FC-MAIN-2026-6836'];
  for (const no of nos) {
    const inv = await db.query('SELECT id FROM purchase_invoices WHERE invoice_number = $1', [no]);
    const id = inv.rows[0]?.id;
    const byId = await db.query('SELECT COUNT(*)::int AS c FROM stock_movements WHERE reference_id = $1', [id]);
    const byNo = await db.query('SELECT COUNT(*)::int AS c FROM stock_movements WHERE reference_number = $1', [no]);
    const recent = await db.query(
      `SELECT id, reference_id, reference_number, reference_type, quantity::float, created_at::text
       FROM stock_movements WHERE reference_number = $1 OR reference_id = $2
       ORDER BY created_at DESC LIMIT 5`,
      [no, id],
    );
    console.log(no, { id, byId: byId.rows[0].c, byNo: byNo.rows[0].c, recent: recent.rows });
  }

  const journals = await db.query(
    `SELECT id, reference_id, document_number, created_at::text
     FROM journal_entries WHERE document_number LIKE 'CP20260609%' ORDER BY created_at DESC LIMIT 15`,
  );
  console.log('\nJournals CP20260609*:', journals.rows);

  const allRecent = await db.query(
    `SELECT reference_number, reference_id, reference_type, COUNT(*)::int AS c
     FROM stock_movements GROUP BY reference_number, reference_id, reference_type
     ORDER BY MAX(created_at) DESC LIMIT 15`,
  );
  console.log('\nRecent stock movement groups:', allRecent.rows);

  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
