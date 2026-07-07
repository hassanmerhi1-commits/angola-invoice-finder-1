/**
 * Resolve the branch-specific caixa GL account (45x) for sales, credit notes, voids, etc.
 * Falls back through several strategies so server DBs with unlinked 45x accounts still work.
 */

const GLOBAL_PETTY_CASH_CODE = '451';

function getDb() {
  // Lazy load so unit tests can mock query clients without touching SQLite.
  // eslint-disable-next-line global-require
  return require('../db');
}

async function queryClient(clientOrDb, sql, params = []) {
  if (clientOrDb && typeof clientOrDb.query === 'function') {
    return clientOrDb.query(sql, params);
  }
  return getDb().query(sql, params);
}

function nameMatchSql(engine) {
  if (engine === 'postgres') {
    return `(coa.name ILIKE 'Caixa - ' || b.name
      OR coa.name ILIKE 'Cash - ' || b.name
      OR coa.name ILIKE '%' || b.name
      OR coa.description ILIKE '%filial ' || b.name || '%')`;
  }
  return `(LOWER(coa.name) LIKE 'caixa - ' || LOWER(b.name)
    OR LOWER(coa.name) LIKE 'cash - ' || LOWER(b.name)
    OR LOWER(coa.name) LIKE '%' || LOWER(b.name)
    OR LOWER(COALESCE(coa.description, '')) LIKE '%filial ' || LOWER(b.name) || '%')`;
}

/**
 * Link existing 45x leaf accounts that match a branch name but have no branch_id.
 * Common on servers migrated from client-side CoA seeding.
 */
async function linkOrphanBranchCaixaAccounts(dbOrClient) {
  const engine = dbOrClient?.engine || getDb().engine;
  const match = nameMatchSql(engine);
  let linked = 0;

  try {
    const orphans = await queryClient(
      dbOrClient,
      `SELECT coa.id, coa.code, b.id AS branch_id, b.name AS branch_name
       FROM chart_of_accounts coa
       JOIN branches b ON ${match}
       WHERE (coa.branch_id IS NULL OR TRIM(COALESCE(coa.branch_id, '')) = '')
         AND coa.is_active = true
         AND coa.is_header = false
         AND coa.code LIKE '45%'
         AND coa.code != '45'
         AND LENGTH(TRIM(coa.code)) >= 3
       ORDER BY coa.code, b.name`,
    );

    const claimedBranches = new Set();
    for (const row of orphans.rows || []) {
      const branchKey = String(row.branch_id);
      if (claimedBranches.has(branchKey)) continue;

      const conflict = await queryClient(
        dbOrClient,
        `SELECT id FROM chart_of_accounts
         WHERE branch_id = $1 AND is_active = true AND is_header = false
           AND code LIKE '45%' AND code != '45'
         LIMIT 1`,
        [branchKey],
      );
      if (conflict.rows?.length) {
        claimedBranches.add(branchKey);
        continue;
      }

      await queryClient(
        dbOrClient,
        `UPDATE chart_of_accounts SET branch_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND (branch_id IS NULL OR TRIM(COALESCE(branch_id, '')) = '')`,
        [branchKey, row.id],
      );
      claimedBranches.add(branchKey);
      linked += 1;
      console.log(`[branchCaixa] Linked ${row.code} → branch ${row.branch_name} (${branchKey})`);
    }
  } catch (err) {
    console.warn('[branchCaixa] link orphan accounts:', err.message);
  }

  return { linked };
}

async function resolveByBranchId(client, branchId) {
  if (!branchId) return null;
  const result = await queryClient(
    client,
    `SELECT code FROM chart_of_accounts
     WHERE branch_id = $1 AND is_active = true AND is_header = false
       AND code LIKE '45%' AND code != '45'
     ORDER BY LENGTH(code) DESC, code
     LIMIT 1`,
    [String(branchId)],
  );
  return result.rows[0]?.code || null;
}

async function resolveFromSaleJournal(client, saleId) {
  if (!saleId) return null;
  const result = await queryClient(
    client,
    `SELECT coa.code
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE je.reference_type = 'sale'
       AND je.reference_id = $1
       AND jel.debit_amount > 0
       AND coa.is_active = true
       AND coa.is_header = false
       AND coa.code LIKE '45%'
       AND coa.code != '45'
     ORDER BY jel.debit_amount DESC, LENGTH(coa.code) DESC, coa.code
     LIMIT 1`,
    [String(saleId)],
  );
  return result.rows[0]?.code || null;
}

async function resolveByBranchName(client, branchName) {
  const name = String(branchName || '').trim();
  if (!name) return null;

  const engine = client?.engine || getDb().engine;
  const nameClause = engine === 'postgres'
    ? `(name ILIKE $1 OR name ILIKE $2 OR name ILIKE $3)`
  : `(LOWER(name) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($2) OR LOWER(name) LIKE LOWER($3))`;

  const result = await queryClient(
    client,
    `SELECT code FROM chart_of_accounts
     WHERE is_active = true AND is_header = false
       AND code LIKE '45%' AND code != '45'
       AND ${nameClause}
     ORDER BY LENGTH(code) DESC, code
     LIMIT 1`,
    [`Caixa - ${name}`, `Cash - ${name}`, `%${name}%`],
  );
  return result.rows[0]?.code || null;
}

/**
 * @param {object} client - pg client or db
 * @param {{ branchId?: string, branchName?: string, saleId?: string }} scope
 * @returns {Promise<string>} GL account code (45x or 451 fallback)
 */
async function resolveBranchCaixaGlAccountCode(client, scope = {}) {
  const branchId = scope.branchId != null ? String(scope.branchId).trim() : '';
  const branchName = scope.branchName != null ? String(scope.branchName).trim() : '';
  const saleId = scope.saleId != null ? String(scope.saleId).trim() : '';

  const fromBranch = await resolveByBranchId(client, branchId);
  if (fromBranch) return fromBranch;

  const fromSale = await resolveFromSaleJournal(client, saleId);
  if (fromSale) return fromSale;

  const fromName = await resolveByBranchName(client, branchName);
  if (fromName) return fromName;

  return GLOBAL_PETTY_CASH_CODE;
}

module.exports = {
  resolveBranchCaixaGlAccountCode,
  linkOrphanBranchCaixaAccounts,
  GLOBAL_PETTY_CASH_CODE,
};
