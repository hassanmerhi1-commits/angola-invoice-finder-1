#!/usr/bin/env node
/**
 * Data integrity + consistency report for NEXOR ERP database.
 *
 * Usage:
 *   node backend/scripts/check-data-consistency.cjs
 *   SQLITE_PATH=C:\nexor\erp.db node backend/scripts/check-data-consistency.cjs
 *   node backend/scripts/check-data-consistency.cjs --unique-only
 *
 * Prefer: npm run check:consistency (uses Electron Node when available)
 */
const path = require('path');
const { runAllChecks } = require('./lib/integrityRunner');

process.env.DB_ENGINE = process.env.DB_ENGINE || 'sqlite';
if (!process.env.SQLITE_PATH) {
  process.env.SQLITE_PATH = path.resolve(__dirname, '../../../nexor/erp.db');
}

const args = process.argv.slice(2);
const uniqueOnly = args.includes('--unique-only');
const consistencyOnly = args.includes('--consistency-only');

async function main() {
  const db = require('../src/db');
  console.log(`[consistency] engine=${db.engine} path=${db.engine === 'sqlite' ? db.dbPath : 'postgres'}`);

  const summary = await runAllChecks(db, {
    uniqueness: !consistencyOnly,
    consistency: !uniqueOnly,
  });

  console.log('\n── Summary ──');
  console.log(`  OK: ${summary.ok}  Errors: ${summary.errors}  Warnings: ${summary.warnings}  Skipped: ${summary.skipped}`);

  const exitCode = summary.errors > 0 ? 1 : summary.warnings > 0 ? 2 : 0;
  if (exitCode === 0) {
    console.log('\n[consistency] All checks passed.');
  } else if (exitCode === 1) {
    console.log('\n[consistency] Errors found — fix before backup/restore or go-live.');
  } else {
    console.log('\n[consistency] Warnings only — review when convenient.');
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[consistency] fatal:', err.message);
  process.exit(2);
});
