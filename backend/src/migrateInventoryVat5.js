/**
 * HISTORICAL one-time patch id only.
 *
 * The original migration forced EVERY active product to 5% IVA. That must NEVER
 * run again — if schema_patches was lost (restore/recreate), a backend restart
 * would silently wipe 14%/7%/0% back to 5% ("worked for a while, then broke").
 *
 * We only ensure the patch marker exists so old code paths stay no-ops.
 */
const PATCH_ID = '020_inventory_vat_5';

async function migrateInventoryVatTo5(db) {
  const isPostgres = db.engine === 'postgres';

  if (isPostgres) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_patches (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } else if (db.sqlite) {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_patches (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } else {
    return { skipped: true, reason: 'no_database' };
  }

  const already = await db.query('SELECT 1 AS ok FROM schema_patches WHERE id = $1 LIMIT 1', [PATCH_ID]);
  if (already.rows?.length) {
    return { skipped: true };
  }

  // Mark applied WITHOUT touching product tax rates.
  await db.query('INSERT INTO schema_patches (id) VALUES ($1)', [PATCH_ID]);
  console.log(
    '[DB] Inventory VAT patch marker recorded — products were NOT modified (destructive 5% wipe disabled)',
  );
  return { skipped: true, reason: 'destructive_update_disabled', marked: true };
}

module.exports = { migrateInventoryVatTo5, PATCH_ID };
