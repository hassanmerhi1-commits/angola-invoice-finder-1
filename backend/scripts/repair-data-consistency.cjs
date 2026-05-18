#!/usr/bin/env node
/**
 * Apply automated fixes for check-data-consistency failures.
 *
 * Usage:
 *   npm run repair:consistency
 *   SQLITE_PATH=C:\nexor\erp.db npm run repair:consistency
 */
const path = require('path');

process.env.DB_ENGINE = process.env.DB_ENGINE || 'sqlite';
if (!process.env.SQLITE_PATH) {
  process.env.SQLITE_PATH = path.resolve(__dirname, '../../../nexor/erp.db');
}

async function main() {
  require('../src/db');
  const { runDataConsistencyRepair } = require('../src/dataConsistencyRepair');

  console.log(`[repair] database: ${process.env.SQLITE_PATH}`);
  const report = await runDataConsistencyRepair();

  console.log('[repair] Results:');
  console.log(`  Supplier return links fixed: ${report.supplierReturns?.repaired ?? 0}`);
  console.log(`  Supplier balances synced: ${report.supplierBalances?.updated ?? 0}`);
  console.log(`  Client balances synced: ${report.clientBalances?.updated ?? 0}`);
  console.log(`  Products assigned to main branch: ${report.productsBranchAssigned ?? 0}`);
  console.log(`  Duplicate SKUs renamed: ${report.duplicateSkusRenamed ?? 0}`);
  console.log(`  Product stock reconciled (by product id): ${report.productStockReconciled ?? 0}`);

  if (report.supplierError) console.warn('  Supplier repair error:', report.supplierError);
  if (report.clientError) console.warn('  Client repair error:', report.clientError);
  if (report.productError) console.warn('  Product repair error:', report.productError);

  console.log('\n[repair] Re-running consistency check…\n');
  const { runAllChecks } = require('./lib/integrityRunner');
  const db = require('../src/db');
  const summary = await runAllChecks(db, { uniqueness: true, consistency: true });

  const exitCode = summary.errors > 0 ? 1 : summary.warnings > 0 ? 2 : 0;
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[repair] fatal:', err);
  process.exit(2);
});
