/**
 * Auto-create per-branch Caixa GL sub-accounts under parent 45 (PGC).
 * Codes 451–453 are reserved; branch caixa accounts use 454+.
 */

const CAIXA_PARENT_CODE = '45';
const CAIXA_CODE_MIN_SUFFIX = 4; // → 454
const CAIXA_CODE_MAX_SUFFIX = 99;

async function queryDb(dbOrClient, sql, params = []) {
  if (typeof dbOrClient.query === 'function') {
    return dbOrClient.query(sql, params);
  }
  return db.query(sql, params);
}

async function findBranchCaixaAccount(client, branchId) {
  const result = await queryDb(
    client,
    `SELECT id, code, name, branch_id
     FROM chart_of_accounts
     WHERE branch_id = $1
       AND is_active = true
       AND is_header = false
       AND code LIKE '45%'
     ORDER BY code
     LIMIT 1`,
    [branchId],
  );
  return result.rows[0] || null;
}

async function loadUsedCaixaSubCodes(client) {
  const result = await queryDb(
    client,
    `SELECT code FROM chart_of_accounts
     WHERE code LIKE '45%'
       AND LENGTH(code) = 3
       AND is_header = false`,
  );
  return new Set(result.rows.map((row) => String(row.code || '').trim()));
}

async function allocateNextBranchCaixaCode(client) {
  const used = await loadUsedCaixaSubCodes(client);
  for (let suffix = CAIXA_CODE_MIN_SUFFIX; suffix <= CAIXA_CODE_MAX_SUFFIX; suffix += 1) {
    const code = `${CAIXA_PARENT_CODE}${suffix}`;
    if (!used.has(code)) return code;
  }
  throw new Error('No free 45x caixa sub-account codes (454–4599 range exhausted)');
}

async function resolveCaixaParent(client) {
  const result = await queryDb(
    client,
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [CAIXA_PARENT_CODE],
  );
  return result.rows[0]?.id || null;
}

async function bumpParentChildrenCount(client, parentId) {
  await queryDb(
    client,
    `UPDATE chart_of_accounts SET children_count = (
       SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
     )
     WHERE id = $1`,
    [parentId],
  );
}

/**
 * Ensure one Caixa GL leaf exists for a branch. Idempotent.
 * @returns {{ created: boolean, code: string|null, branchId: string, branchName: string }}
 */
async function ensureBranchCaixaAccount(dbOrClient, branchId, branchName) {
  const branchIdStr = String(branchId || '').trim();
  const name = String(branchName || '').trim();
  if (!branchIdStr || !name) {
    return { created: false, code: null, branchId: branchIdStr, branchName: name };
  }

  const run = async (client) => {
    const existing = await findBranchCaixaAccount(client, branchIdStr);
    if (existing) {
      return { created: false, code: existing.code, branchId: branchIdStr, branchName: name };
    }

    const parentId = await resolveCaixaParent(client);
    if (!parentId) {
      console.warn('[branchCaixa] Parent account 45 (Caixa) not found — skipping', name);
      return { created: false, code: null, branchId: branchIdStr, branchName: name };
    }

    let code = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = await allocateNextBranchCaixaCode(client);
      const insert = await queryDb(
        client,
        `INSERT INTO chart_of_accounts
         (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance, branch_id)
         VALUES ($1, $2, $3, 'asset', 'debit', $4, 2, false, 0, 0, $5)
         ON CONFLICT (code) DO NOTHING
         RETURNING code`,
        [code, `Caixa - ${name}`, `Conta caixa da filial ${name}`, parentId, branchIdStr],
      );
      if (insert.rows[0]?.code) {
        await bumpParentChildrenCount(client, parentId);
        console.log(`[branchCaixa] Created ${code} — Caixa - ${name}`);
        return { created: true, code, branchId: branchIdStr, branchName: name };
      }
      // Code race or stale allocation — mark used and retry.
      const used = await loadUsedCaixaSubCodes(client);
      used.add(code);
    }

    console.warn('[branchCaixa] Could not allocate caixa code for branch', name);
    return { created: false, code: null, branchId: branchIdStr, branchName: name };
  };

  if (typeof dbOrClient.connect === 'function') {
    const client = await dbOrClient.connect();
    try {
      return await run(client);
    } finally {
      client.release();
    }
  }

  return run(dbOrClient);
}

/**
 * Backfill missing caixa GL accounts for every active branch.
 */
async function ensureAllBranchCaixaAccounts(db) {
  const branches = await queryDb(
    db,
    `SELECT id, name FROM branches ORDER BY name`,
  );

  const created = [];
  const skipped = [];
  const failed = [];

  for (const branch of branches.rows) {
    try {
      const result = await ensureBranchCaixaAccount(db, branch.id, branch.name);
      if (result.created) created.push(result);
      else if (result.code) skipped.push(result);
      else failed.push({ branchId: branch.id, branchName: branch.name });
    } catch (err) {
      failed.push({
        branchId: branch.id,
        branchName: branch.name,
        error: err?.message || String(err),
      });
    }
  }

  return {
    totalBranches: branches.rows.length,
    created: created.length,
    skipped: skipped.length,
    failed: failed.length,
    createdAccounts: created,
    failedBranches: failed,
  };
}

module.exports = {
  ensureBranchCaixaAccount,
  ensureAllBranchCaixaAccounts,
  allocateNextBranchCaixaCode,
};
