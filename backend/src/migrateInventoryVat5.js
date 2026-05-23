/**
 * One-time patch: set all active inventory products to 5% VAT (IVA5).
 */
const { DEFAULT_VAT_RATE, DEFAULT_TAX_CODE } = require('./taxDefaults');

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

  const hasTaxCode = await db.query(
    isPostgres
      ? `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'tax_code' LIMIT 1`
      : `SELECT 1 FROM pragma_table_info('products') WHERE name = 'tax_code' LIMIT 1`,
  );
  const withTaxCode = (hasTaxCode.rows?.length ?? 0) > 0;

  let updateResult;
  if (withTaxCode) {
    updateResult = await db.query(
      isPostgres
        ? `UPDATE products
           SET tax_rate = $1, tax_code = $2, updated_at = CURRENT_TIMESTAMP
           WHERE COALESCE(is_active, true) IS NOT FALSE`
        : `UPDATE products
           SET tax_rate = $1, tax_code = $2, updated_at = datetime('now')
           WHERE COALESCE(is_active, 1) != 0`,
      [DEFAULT_VAT_RATE, DEFAULT_TAX_CODE],
    );
  } else {
    updateResult = await db.query(
      isPostgres
        ? `UPDATE products
           SET tax_rate = $1, updated_at = CURRENT_TIMESTAMP
           WHERE COALESCE(is_active, true) IS NOT FALSE`
        : `UPDATE products
           SET tax_rate = $1, updated_at = datetime('now')
           WHERE COALESCE(is_active, 1) != 0`,
      [DEFAULT_VAT_RATE],
    );
  }

  await db.query('INSERT INTO schema_patches (id) VALUES ($1)', [PATCH_ID]);

  const updated = Number(updateResult.rowCount ?? 0);
  console.log(`[DB] Inventory VAT patch: ${updated} product(s) set to ${DEFAULT_VAT_RATE}% (${DEFAULT_TAX_CODE})`);
  return { updated };
}

module.exports = { migrateInventoryVatTo5, PATCH_ID };
