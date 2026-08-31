#!/usr/bin/env node
/**
 * Pull supplier/customer postings onto their own ledger account:
 *  - moves lines off parent 321/311
 *  - rescues lines an earlier repair parked on “… por classificar”
 *  - deactivates entity leaves that never received a posting
 *
 * Usage (on the city server, from repo root):
 *   docker exec -it nexor-backend node scripts/repair-supplier-coa-v8.js --dry-run
 *   docker exec -it nexor-backend node scripts/repair-supplier-coa-v8.js
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
    countMisfiledClassifyLines,
    pruneUnusedEntityLeaves,
    remapMisattributedEntityLines,
    repairParentEntityCoaPostings,
  } = require('../src/lib/repairParentEntityCoa');
  const { fastRecomputeCoaCurrentBalances } = require('../src/accounting');

  const parentBefore = await countParentEntityLines(db);
  const classifyBefore = await countMisfiledClassifyLines(db);
  console.log(
    `[repair-v8] before: parent 321/311 lines=${parentBefore}, “por classificar” lines=${classifyBefore}${dryRun ? ' (dry-run)' : ''}`,
  );

  const wrong = await remapMisattributedEntityLines(db, { dryRun });
  if (wrong.failed) {
    console.error(`[repair-v8] wrong-account scan FAILED: ${wrong.failed}`);
  }
  console.log(
    `[repair-v8] lines on the wrong party's account (purchases, sales, payments): checked=${wrong.checked} moved=${wrong.moved} invoices corrected=${wrong.invoicesFixed}`,
  );
  for (const line of (wrong.details || []).slice(0, 40)) console.log('  ', line);

  const result = await repairParentEntityCoaPostings(db, { dryRun, pruneUnused: false });
  console.log(`[repair-v8] moved=${result.moved} bulk=${result.bulkMoved || 0} skipped=${result.skipped}`);
  for (const line of (result.details || []).slice(0, 40)) console.log('  ', line);
  if ((result.details || []).length > 40) console.log(`   … ${result.details.length - 40} more`);

  const pruned = await pruneUnusedEntityLeaves(db, { dryRun });
  console.log(
    `[repair-v8] unused entity leaves: candidates=${pruned.candidates} deactivated=${pruned.deactivated}`,
  );
  for (const s of pruned.sample || []) console.log('   ', s);

  if (!dryRun) {
    try {
      await fastRecomputeCoaCurrentBalances(db);
    } catch (e) {
      console.warn(`[repair-v8] balance recompute failed (remap still applied): ${e.message}`);
    }
    console.log(
      `[repair-v8] after: parent 321/311 lines=${await countParentEntityLines(db)}, “por classificar” lines=${await countMisfiledClassifyLines(db)}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
