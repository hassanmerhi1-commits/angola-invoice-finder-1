#!/usr/bin/env node
/**
 * Force remap journal lines off parent 321/311 onto supplier/client leaves.
 *
 * Usage (on city, from repo root with DATABASE_URL set):
 *   node backend/scripts/repair-parent-coa-v3.js
 *   node backend/scripts/repair-parent-coa-v3.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }

  const dryRun = process.argv.includes('--dry-run');
  const db = require('../src/db');
  const {
    countParentEntityLines,
    repairParentEntityCoaPostings,
  } = require('../src/lib/repairParentEntityCoa');
  const { fastRecomputeCoaCurrentBalances } = require('../src/accounting');

  const before = await countParentEntityLines(db);
  console.log(`[repair-parent-coa-v3] Parent 321/311 lines before: ${before}${dryRun ? ' (dry-run)' : ''}`);

  const result = await repairParentEntityCoaPostings(db, { dryRun });
  console.log(`[repair-parent-coa-v3] moved=${result.moved} bulk=${result.bulkMoved || 0} skipped=${result.skipped} remaining=${result.remaining}`);
  for (const line of (result.details || []).slice(0, 30)) {
    console.log('  ', line);
  }
  if ((result.details || []).length > 30) {
    console.log(`  … ${result.details.length - 30} more`);
  }

  if (!dryRun) {
    await fastRecomputeCoaCurrentBalances(db);
    const after = await countParentEntityLines(db);
    console.log(`[repair-parent-coa-v3] Parent 321/311 lines after: ${after}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
