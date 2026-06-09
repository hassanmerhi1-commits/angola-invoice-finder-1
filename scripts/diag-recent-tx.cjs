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

  const tables = await db.query(
    `SELECT reference_type, COUNT(*)::int AS c, MAX(created_at)::text AS last_at
     FROM stock_movements GROUP BY reference_type ORDER BY last_at DESC NULLS LAST`,
  );
  console.log('stock_movements by reference_type:', tables.rows);

  const recent = await db.query(
    `SELECT reference_type, reference_id, reference_number, quantity::float, created_at::text
     FROM stock_movements ORDER BY created_at DESC LIMIT 15`,
  );
  console.log('\nlast 15 stock_movements:', recent.rows);

  const jeCols = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'journal_entries' ORDER BY ordinal_position`,
  );
  console.log('\njournal_entries columns:', jeCols.rows.map((r) => r.column_name).join(', '));

  const recentJe = await db.query(
    `SELECT * FROM journal_entries ORDER BY created_at DESC LIMIT 5`,
  );
  console.log('\nlast 5 journal_entries:', recentJe.rows);

  const constraints = await db.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conrelid = 'stock_movements'::regclass`,
  );
  console.log('\nstock_movements constraints:', constraints.rows);

  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
