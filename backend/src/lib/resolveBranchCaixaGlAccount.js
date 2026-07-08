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

function branchNameMatchSql(engine, coaAlias = 'coa', branchAlias = 'b') {
  const coa = coaAlias;
  const b = branchAlias;
  if (engine === 'postgres') {
    return `(${coa}.name ILIKE 'Caixa - ' || ${b}.name
      OR ${coa}.name ILIKE 'Cash - ' || ${b}.name
      OR ${coa}.name ILIKE '%' || ${b}.name || '%'
      OR (${b}.code IS NOT NULL AND TRIM(${b}.code) != '' AND ${coa}.name ILIKE '%' || ${b}.code || '%')
      OR ${coa}.description ILIKE '%filial ' || ${b}.name || '%')`;
  }
  return `(LOWER(${coa}.name) LIKE 'caixa - ' || LOWER(${b}.name)
    OR LOWER(${coa}.name) LIKE 'cash - ' || LOWER(${b}.name)
    OR LOWER(${coa}.name) LIKE '%' || LOWER(${b}.name) || '%'
    OR (${b}.code IS NOT NULL AND TRIM(${b}.code) != '' AND LOWER(${coa}.name) LIKE '%' || LOWER(${b}.code) || '%')
    OR LOWER(COALESCE(${coa}.description, '')) LIKE '%filial ' || LOWER(${b}.name) || '%')`;
}

function nameMatchSql(engine) {
  return branchNameMatchSql(engine, 'coa', 'b');
}

/**
 * Link existing 45x leaf accounts that match a branch name/code to branches.branch_id.
 * Also repairs stale branch_id values when the account name clearly belongs to another branch.
 */
async function linkOrphanBranchCaixaAccounts(dbOrClient) {
  const engine = dbOrClient?.engine || getDb().engine;
  const match = nameMatchSql(engine);
  let linked = 0;

  try {
    const branchIdMismatch = engine === 'postgres'
      ? `(coa.branch_id IS NULL
           OR TRIM(COALESCE(coa.branch_id, '')) = ''
           OR coa.branch_id::text != b.id::text)`
      : `(coa.branch_id IS NULL
           OR TRIM(COALESCE(coa.branch_id, '')) = ''
           OR coa.branch_id != b.id)`;

    const candidates = await queryClient(
      dbOrClient,
      `SELECT coa.id, coa.code, coa.branch_id AS current_branch_id, b.id AS branch_id, b.name AS branch_name
       FROM chart_of_accounts coa
       JOIN branches b ON ${match}
       WHERE coa.is_active = true
         AND coa.is_header = false
         AND coa.code LIKE '45%'
         AND coa.code NOT IN ('45', '451')
         AND LENGTH(TRIM(coa.code)) >= 3
         AND ${branchIdMismatch}
       ORDER BY coa.code, b.name`,
    );

    const claimedBranches = new Set();
    for (const row of candidates.rows || []) {
      const branchKey = String(row.branch_id);
      if (claimedBranches.has(branchKey)) continue;

      const conflict = await queryClient(
        dbOrClient,
        `SELECT id, code FROM chart_of_accounts
         WHERE branch_id = $1 AND is_active = true AND is_header = false
           AND code LIKE '45%' AND code NOT IN ('45', '451')
           AND id != $2
         LIMIT 1`,
        [branchKey, row.id],
      );
      if (conflict.rows?.length) {
        claimedBranches.add(branchKey);
        continue;
      }

      await queryClient(
        dbOrClient,
        `UPDATE chart_of_accounts SET branch_id = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [branchKey, row.id],
      );
      claimedBranches.add(branchKey);
      linked += 1;
      const from = row.current_branch_id ? ` (was ${row.current_branch_id})` : '';
      console.log(`[branchCaixa] Linked ${row.code} → branch ${row.branch_name} (${branchKey})${from}`);
    }
  } catch (err) {
    console.warn('[branchCaixa] link orphan accounts:', err.message);
  }

  return { linked };
}

async function loadBranchRow(client, branchId) {
  if (!branchId) return null;
  const result = await queryClient(
    client,
    `SELECT id, name, code FROM branches WHERE id = $1 LIMIT 1`,
    [String(branchId)],
  );
  return result.rows[0] || null;
}

async function resolveByBranchId(client, branchId) {
  if (!branchId) return null;

  const engine = client?.engine || getDb().engine;
  const nameMatch = branchNameMatchSql(engine, 'coa', 'b');
  const prefixRank = engine === 'postgres'
    ? `CASE WHEN coa.name ILIKE 'Caixa - ' || b.name OR coa.name ILIKE 'Cash - ' || b.name THEN 0 ELSE 1 END`
    : `CASE WHEN LOWER(coa.name) LIKE 'caixa - ' || LOWER(b.name) OR LOWER(coa.name) LIKE 'cash - ' || LOWER(b.name) THEN 0 ELSE 1 END`;

  const result = await queryClient(
    client,
    `SELECT coa.code
     FROM chart_of_accounts coa
     JOIN branches b ON b.id = $1
     WHERE coa.is_active = true AND coa.is_header = false
       AND coa.code LIKE '45%' AND coa.code NOT IN ('45', '451')
       AND (coa.branch_id = $1 OR ${nameMatch})
     ORDER BY CASE WHEN coa.branch_id = $1 THEN 0 ELSE 1 END,
              ${prefixRank},
              LENGTH(coa.code) DESC, coa.code
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
       AND coa.code NOT IN ('45', '451')
     ORDER BY jel.debit_amount DESC, LENGTH(coa.code) DESC, coa.code
     LIMIT 1`,
    [String(saleId)],
  );
  return result.rows[0]?.code || null;
}

async function resolveByBranchName(client, branchName, branchCode) {
  const name = String(branchName || '').trim();
  const code = String(branchCode || '').trim();
  if (!name && !code) return null;

  const engine = client?.engine || getDb().engine;
  const clauses = [];
  const params = [];
  if (name) {
    params.push(`Caixa - ${name}`, `Cash - ${name}`, `%${name}%`);
    if (engine === 'postgres') {
      clauses.push('name ILIKE $1', 'name ILIKE $2', 'name ILIKE $3');
    } else {
      clauses.push('LOWER(name) LIKE LOWER($1)', 'LOWER(name) LIKE LOWER($2)', 'LOWER(name) LIKE LOWER($3)');
    }
  }
  if (code) {
    const idx = params.length + 1;
    params.push(`%${code}%`);
    clauses.push(engine === 'postgres' ? `name ILIKE $${idx}` : `LOWER(name) LIKE LOWER($${idx})`);
  }
  if (!clauses.length) return null;

  const result = await queryClient(
    client,
    `SELECT code FROM chart_of_accounts
     WHERE is_active = true AND is_header = false
       AND code LIKE '45%' AND code NOT IN ('45', '451')
       AND (${clauses.join(' OR ')})
     ORDER BY LENGTH(code) DESC, code
     LIMIT 1`,
    params,
  );
  return result.rows[0]?.code || null;
}

/**
 * @param {object} client - pg client or db
 * @param {{ branchId?: string, branchName?: string, branchCode?: string, saleId?: string }} scope
 * @returns {Promise<string>} GL account code (45x or 451 fallback)
 */
async function resolveBranchCaixaGlAccountCode(client, scope = {}) {
  const branchId = scope.branchId != null ? String(scope.branchId).trim() : '';
  let branchName = scope.branchName != null ? String(scope.branchName).trim() : '';
  let branchCode = scope.branchCode != null ? String(scope.branchCode).trim() : '';
  const saleId = scope.saleId != null ? String(scope.saleId).trim() : '';

  if (branchId && (!branchName || !branchCode)) {
    const branch = await loadBranchRow(client, branchId);
    if (branch) {
      if (!branchName) branchName = String(branch.name || '').trim();
      if (!branchCode) branchCode = String(branch.code || '').trim();
    }
  }

  const fromBranch = await resolveByBranchId(client, branchId);
  if (fromBranch) return fromBranch;

  const fromSale = await resolveFromSaleJournal(client, saleId);
  if (fromSale) return fromSale;

  const fromName = await resolveByBranchName(client, branchName, branchCode);
  if (fromName) return fromName;

  console.warn(
    `[branchCaixa] No branch caixa for branchId=${branchId || '(none)'}`
    + ` name=${branchName || '(none)'} saleId=${saleId || '(none)'} — using ${GLOBAL_PETTY_CASH_CODE}`,
  );
  return GLOBAL_PETTY_CASH_CODE;
}

module.exports = {
  resolveBranchCaixaGlAccountCode,
  linkOrphanBranchCaixaAccounts,
  GLOBAL_PETTY_CASH_CODE,
};
