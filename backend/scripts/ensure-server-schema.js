#!/usr/bin/env node
/** Run on server after deploy: fixes credit-sale DB constraint + branch price_level. */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const db = require('../src/db');
const { ensureSalesCreditPaymentMethod, ensureBranchPricingColumn } = require('../src/lib/ensurePhaseSchema');
const { buildSchemaChecks } = require('../src/lib/schemaChecks');

async function main() {
  await db.query('SELECT 1');
  console.log('[ensure-server-schema] engine:', db.engine);
  await ensureSalesCreditPaymentMethod(db);
  await ensureBranchPricingColumn(db);
  const checks = await buildSchemaChecks(db);
  console.log('[ensure-server-schema] schemaChecks:', JSON.stringify(checks));
  if (!checks.salesCreditPayment) {
    console.error('[ensure-server-schema] FAILED: credit payment still blocked');
    process.exit(1);
  }
  console.log('[ensure-server-schema] OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('[ensure-server-schema]', e.message || e);
  process.exit(1);
});
