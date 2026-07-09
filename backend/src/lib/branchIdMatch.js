/**
 * Resolve branch filter param to canonical branch id.
 * Handles UUID/string mismatches and code/name lookups (e.g. SOYO05).
 */
async function resolveBranchFilterId(db, branchId) {
  const raw = String(branchId || '').trim();
  if (!raw) return null;

  const idSql =
    db.engine === 'postgres'
      ? 'SELECT id::text AS id FROM branches WHERE id::text = $1 LIMIT 1'
      : 'SELECT CAST(id AS TEXT) AS id FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1';
  const byId = await db.query(idSql, [raw]);
  if (byId.rows[0]?.id) return String(byId.rows[0].id);

  const byMeta = await db.query(
    db.engine === 'postgres'
      ? `SELECT id::text AS id FROM branches
         WHERE lower(trim(coalesce(code, ''))) = lower($1)
            OR lower(trim(name)) = lower($1)
         LIMIT 1`
      : `SELECT CAST(id AS TEXT) AS id FROM branches
         WHERE lower(trim(coalesce(code, ''))) = lower($1)
            OR lower(trim(name)) = lower($1)
         LIMIT 1`,
    [raw],
  );
  if (byMeta.rows[0]?.id) return String(byMeta.rows[0].id);

  return raw;
}

function castText(columnExpr) {
  return (db) => (db.engine === 'postgres' ? `${columnExpr}::text` : `CAST(${columnExpr} AS TEXT)`);
}

/**
 * For purchase_invoices: match branch_id OR warehouse_id.
 */
async function buildPurchaseInvoiceBranchFilter(db, branchId, startParamIdx) {
  const resolved = await resolveBranchFilterId(db, branchId);
  if (!resolved) return { sql: '', params: [] };
  const p = `$${startParamIdx}`;
  const branchCol = castText('branch_id')(db);
  const whCol = castText('warehouse_id')(db);
  return {
    sql: ` AND (${branchCol} = ${p} OR ${whCol} = ${p})`,
    params: [resolved],
  };
}

/**
 * For journal_entries.branch_id
 */
async function buildJournalBranchFilter(db, branchId, startParamIdx) {
  const resolved = await resolveBranchFilterId(db, branchId);
  if (!resolved) return { sql: '', params: [] };
  const p = `$${startParamIdx}`;
  const col = castText('je.branch_id')(db);
  return {
    sql: ` AND ${col} = ${p}`,
    params: [resolved],
  };
}

module.exports = {
  resolveBranchFilterId,
  buildPurchaseInvoiceBranchFilter,
  buildJournalBranchFilter,
};
