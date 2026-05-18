#!/usr/bin/env node
/**
 * Duplicate-key scan only (legacy). Prefer: npm run check:consistency
 */
const path = require('path');
const { runAllChecks } = require('./lib/integrityRunner');

process.env.DB_ENGINE = process.env.DB_ENGINE || 'sqlite';
if (!process.env.SQLITE_PATH) {
  process.env.SQLITE_PATH = path.resolve(__dirname, '../../../nexor/erp.db');
}

async function main() {
  const db = require('../src/db');
  console.log(`[integrity] engine=${db.engine} path=${db.engine === 'sqlite' ? db.dbPath : 'postgres'}`);
  const summary = await runAllChecks(db, { uniqueness: true, consistency: false });
  process.exit(summary.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[integrity] fatal:', err);
  process.exit(2);
});
