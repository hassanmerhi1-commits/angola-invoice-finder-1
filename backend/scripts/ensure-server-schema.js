#!/usr/bin/env node
/** Run on PostgreSQL server after deploy — applies pending SQL migrations and refreshes app_meta. */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: 'C:\\NEXOR ERP\\database.env' });

const db = require('../src/db');
const { applyPostgresMigrations } = require('../src/migrations/applyMigrations');
const {
  ensureSalesCreditPaymentMethod,
  ensureBranchPricingColumn,
  ensurePhaseSchema,
} = require('../src/lib/ensurePhaseSchema');
const { buildSchemaChecks } = require('../src/lib/schemaChecks');
const {
  recordAppMetaForDb,
  readAppVersion,
  readSchemaVersionFromDb,
  EXPECTED_SCHEMA_VERSION,
} = require('../src/lib/deploymentStatus');

async function main() {
  await db.query('SELECT 1');
  console.log('[ensure-server-schema] engine:', db.engine);

  if (db.engine === 'postgres') {
    const migrationResult = await applyPostgresMigrations(db, { logPrefix: '[ensure-server-schema]', strict: true });
    console.log('[ensure-server-schema] migrations applied:', migrationResult.applied.length);
    if (migrationResult.skipped.length) {
      console.log('[ensure-server-schema] migrations skipped:', migrationResult.skipped.join(', '));
    }
    await ensurePhaseSchema(db);
  } else {
    await ensureSalesCreditPaymentMethod(db);
    await ensureBranchPricingColumn(db);
  }

  await recordAppMetaForDb(db, readAppVersion());
  const schema = await readSchemaVersionFromDb(db);
  console.log('[ensure-server-schema] schema_version:', schema.stored, 'expected:', EXPECTED_SCHEMA_VERSION);

  const checks = await buildSchemaChecks(db);
  console.log('[ensure-server-schema] schemaChecks:', JSON.stringify(checks));
  if (!checks.salesCreditPayment) {
    console.error('[ensure-server-schema] FAILED: credit payment still blocked');
    process.exit(1);
  }
  if (schema.stored != null && schema.stored < EXPECTED_SCHEMA_VERSION) {
    console.error(`[ensure-server-schema] FAILED: schema ${schema.stored} < expected ${EXPECTED_SCHEMA_VERSION}`);
    process.exit(1);
  }
  console.log('[ensure-server-schema] OK');
  process.exit(0);
}

main().catch((e) => {
  console.error('[ensure-server-schema]', e.message || e);
  process.exit(1);
});
