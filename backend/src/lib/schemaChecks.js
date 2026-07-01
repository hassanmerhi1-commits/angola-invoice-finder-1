/**
 * Lightweight schema probes for /api/health and deployment diagnostics.
 */
async function columnExists(db, table, column) {
  try {
    if (db.engine === 'postgres') {
      const res = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
         LIMIT 1`,
        [table, column],
      );
      return res.rows.length > 0;
    }
    if (db.sqlite) {
      const cols = db.sqlite.pragma(`table_info(${table})`);
      return Array.isArray(cols) && cols.some((c) => c.name === column);
    }
  } catch (_) {}
  return false;
}

async function salesAllowsCreditPayment(db) {
  if (db.engine !== 'postgres') return true;
  try {
    const res = await db.query(
      `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON c.conrelid = t.oid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
       WHERE t.relname = 'sales'
         AND a.attname = 'payment_method'
         AND c.contype = 'c'`,
    );
    if (!res.rows.length) return true;
    return res.rows.every((row) => String(row.def || '').includes("'credit'"));
  } catch (_) {
    return false;
  }
}

async function buildSchemaChecks(db) {
  const [branchesPriceLevel, salesCreditOk] = await Promise.all([
    columnExists(db, 'branches', 'price_level'),
    salesAllowsCreditPayment(db),
  ]);
  return {
    branchesPriceLevel,
    salesCreditPayment: salesCreditOk,
    ok: branchesPriceLevel && salesCreditOk,
  };
}

module.exports = {
  buildSchemaChecks,
  columnExists,
  salesAllowsCreditPayment,
};
