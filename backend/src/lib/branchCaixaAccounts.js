/**
 * Auto-create per-branch Caixa GL sub-accounts under parent 45 (PGC).
 * Same as suppliers: categories stay compact (451, 4511), leaves are 8-digit
 * (45000001, 45110001).
 */

const {
  resolveBranchCaixaGlAccountCode,
  linkOrphanBranchCaixaAccounts,
} = require('./resolveBranchCaixaGlAccount');
const { nextEntityAccountCode } = require('./entityCoaAccounts');

const CAIXA_PARENT_CODE = '45';

function isBranchCaixaLeafCode(code) {
  const value = String(code || '').trim();
  return /^45\d+$/.test(value) && value !== CAIXA_PARENT_CODE;
}

/** Same as suppliers: 8-digit leaf under 45 (45000001), not 451/452 category slots. */
function pickNextTopLevelCaixaCode(usedCodes) {
  const codes = [...usedCodes].map((code) => String(code || '').trim());
  const headers = codes.filter((c) => c.startsWith(CAIXA_PARENT_CODE) && c !== CAIXA_PARENT_CODE && c.length < 8);
  return nextEntityAccountCode(CAIXA_PARENT_CODE, codes, headers);
}

function pickNextExtraCaixaCode(_parentCode, usedCodes) {
  return pickNextTopLevelCaixaCode(usedCodes);
}

function defaultBranchCaixaName(branchName, extraIndex = 0) {
  const base = `Caixa - ${String(branchName || '').trim()}`;
  return extraIndex > 0 ? `${base} (${extraIndex + 1})` : base;
}

async function queryDb(dbOrClient, sql, params = []) {
  if (typeof dbOrClient.query === 'function') {
    return dbOrClient.query(sql, params);
  }
  return db.query(sql, params);
}

async function findBranchCaixaAccount(client, branchId, branchName) {
  const code = await resolveBranchCaixaGlAccountCode(client, {
    branchId,
    branchName,
  });
  if (!code) return null;
  const result = await queryDb(
    client,
    `SELECT id, code, name, branch_id
     FROM chart_of_accounts
     WHERE code = $1 AND is_active = true AND is_header = false
     LIMIT 1`,
    [code],
  );
  return result.rows[0] || null;
}

async function loadUsedCaixaSubCodes(client) {
  const result = await queryDb(
    client,
    `SELECT code FROM chart_of_accounts
     WHERE CAST(code AS TEXT) LIKE '45%'`,
  );
  return new Set(result.rows.map((row) => String(row.code || '').trim()));
}

async function allocateNextBranchCaixaCode(client) {
  return pickNextTopLevelCaixaCode(await loadUsedCaixaSubCodes(client));
}

async function listBranchCaixaAccounts(client, branchId) {
  const result = await queryDb(
    client,
    `SELECT id, code, name, parent_id, branch_id, level
     FROM chart_of_accounts
     WHERE is_active = true
       AND is_header = false
       AND CAST(code AS TEXT) LIKE '45%'
       AND CAST(code AS TEXT) <> '45'
       AND CAST(branch_id AS TEXT) = $1
     ORDER BY LENGTH(CAST(code AS TEXT)), code`,
    [String(branchId)],
  );
  return result.rows || [];
}

async function upsertOperationalCaixaFromAccount(client, account, branchName) {
  const id = String(account?.id || '').trim();
  const branchId = String(account?.branch_id || '').trim();
  const name = String(account?.name || '').trim();
  if (!id || !branchId || !name) {
    return { created: false, id: null };
  }

  const now = new Date().toISOString();
  const existing = await queryDb(
    client,
    `SELECT id FROM caixas
     WHERE CAST(id AS TEXT) = $1
        OR (CAST(branch_id AS TEXT) = $2 AND LOWER(TRIM(name)) = LOWER(TRIM($3)))
     LIMIT 1`,
    [id, branchId, name],
  );
  if (existing.rows[0]?.id) {
    await queryDb(
      client,
      `UPDATE caixas
       SET branch_id = $2, branch_name = $3, name = $4, updated_at = $5
       WHERE id = $1`,
      [existing.rows[0].id, branchId, String(branchName || '').trim(), name, now],
    );
    return { created: false, id: existing.rows[0].id };
  }

  await queryDb(
    client,
    `INSERT INTO caixas (
      id, branch_id, branch_name, name, opening_balance, current_balance,
      status, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,0,0,'closed',$5,$5)`,
    [id, branchId, String(branchName || '').trim(), name, now],
  );
  return { created: true, id };
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
 * @returns {{ created: boolean, code: string|null, id: string|null, branchId: string, branchName: string }}
 */
async function ensureBranchCaixaAccount(dbOrClient, branchId, branchName) {
  const branchIdStr = String(branchId || '').trim();
  const name = String(branchName || '').trim();
  if (!branchIdStr || !name) {
    return { created: false, code: null, id: null, branchId: branchIdStr, branchName: name };
  }

  const run = async (client) => {
    const existing = await findBranchCaixaAccount(client, branchIdStr, name);
    if (existing) {
      return {
        created: false,
        code: existing.code,
        id: existing.id || null,
        branchId: branchIdStr,
        branchName: name,
      };
    }

    const parentId = await resolveCaixaParent(client);
    if (!parentId) {
      console.warn('[branchCaixa] Parent account 45 (Caixa) not found — skipping', name);
      return { created: false, code: null, id: null, branchId: branchIdStr, branchName: name };
    }

    let code = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = await allocateNextBranchCaixaCode(client);
      const accountName = defaultBranchCaixaName(name);
      const insert = await queryDb(
        client,
        `INSERT INTO chart_of_accounts
         (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance, branch_id)
         VALUES ($1, $2, $3, 'asset', 'debit', $4, 2, false, 0, 0, $5)
         ON CONFLICT (code) DO NOTHING
         RETURNING id, code`,
        [code, accountName, `Conta caixa da filial ${name}`, parentId, branchIdStr],
      );
      if (insert.rows[0]?.code) {
        await bumpParentChildrenCount(client, parentId);
        console.log(`[branchCaixa] Created ${insert.rows[0].code} — ${accountName}`);
        return {
          created: true,
          code: insert.rows[0].code,
          id: insert.rows[0].id || null,
          branchId: branchIdStr,
          branchName: name,
        };
      }
    }

    console.warn('[branchCaixa] Could not allocate caixa code for branch', name);
    return { created: false, code: null, id: null, branchId: branchIdStr, branchName: name };
  };

  // A checked-out pg client already has .connect AND .release. Calling
  // connect() again throws "Client has already been connected" and rolls
  // back Filial create. Only checkout from a pool (connect, no release).
  if (typeof dbOrClient.release === 'function') {
    return run(dbOrClient);
  }
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
 * Old 451/452 remapping ate category headers (4511) and 8-digit children
 * (45110001). Cash now follows suppliers — leave the tree alone.
 */
async function compactSequentialCaixaCodes(_client) {
  return { compacted: 0 };
}

/**
 * Create another Caixa GL leaf for a branch that already has one.
 * Same sequence as the first box: next free 451, 452, 453… under parent 45.
 */
async function createExtraBranchCaixaAccount(dbOrClient, branchId, branchName, extraName) {
  const branchIdStr = String(branchId || '').trim();
  const name = String(branchName || '').trim();
  const wantedName = String(extraName || '').trim();
  if (!branchIdStr || !name) {
    return { created: false, code: null, id: null, branchId: branchIdStr, branchName: name };
  }

  const run = async (client) => {
    const existing = await listBranchCaixaAccounts(client, branchIdStr);
    if (existing.length === 0) {
      const first = await ensureBranchCaixaAccount(client, branchIdStr, name);
      if (wantedName && first.id) {
        await queryDb(
          client,
          `UPDATE chart_of_accounts SET name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [first.id, wantedName],
        );
      }
      return { ...first, name: wantedName || defaultBranchCaixaName(name) };
    }

    const already = existing.find(
      (row) => wantedName && String(row.name || '').trim().toLowerCase() === wantedName.toLowerCase(),
    );
    if (already) {
      return {
        created: false,
        code: already.code,
        id: already.id,
        branchId: branchIdStr,
        branchName: name,
        name: already.name,
      };
    }

    const parentId = await resolveCaixaParent(client);
    if (!parentId) {
      return { created: false, code: null, id: null, branchId: branchIdStr, branchName: name };
    }
    const used = await loadUsedCaixaSubCodes(client);
    let code = pickNextTopLevelCaixaCode(used);
    const accountName = wantedName || defaultBranchCaixaName(name, existing.length);
    const insert = await queryDb(
      client,
      `INSERT INTO chart_of_accounts
       (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance, branch_id)
       VALUES ($1, $2, $3, 'asset', 'debit', $4, 2, false, 0, 0, $5)
       ON CONFLICT (code) DO NOTHING
       RETURNING id, code, name`,
      [code, accountName, `Conta caixa extra da filial ${name}`, parentId, branchIdStr],
    );
    if (!insert.rows[0]?.code) {
      used.add(code);
      code = pickNextTopLevelCaixaCode(used);
      const retry = await queryDb(
        client,
        `INSERT INTO chart_of_accounts
         (code, name, description, account_type, account_nature, parent_id, level, is_header, opening_balance, current_balance, branch_id)
         VALUES ($1, $2, $3, 'asset', 'debit', $4, 2, false, 0, 0, $5)
         RETURNING id, code, name`,
        [code, accountName, `Conta caixa extra da filial ${name}`, parentId, branchIdStr],
      );
      if (!retry.rows[0]?.code) {
        return { created: false, code: null, id: null, branchId: branchIdStr, branchName: name };
      }
      await bumpParentChildrenCount(client, parentId);
      return {
        created: true,
        code: retry.rows[0].code,
        id: retry.rows[0].id,
        branchId: branchIdStr,
        branchName: name,
        name: retry.rows[0].name,
      };
    }

    await bumpParentChildrenCount(client, parentId);
    console.log(`[branchCaixa] Extra ${insert.rows[0].code} — ${accountName}`);
    return {
      created: true,
      code: insert.rows[0].code,
      id: insert.rows[0].id,
      branchId: branchIdStr,
      branchName: name,
      name: insert.rows[0].name,
    };
  };

  if (typeof dbOrClient.release === 'function') return run(dbOrClient);
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
  await linkOrphanBranchCaixaAccounts(db);
  let compacted = 0;
  try {
    compacted = (await compactSequentialCaixaCodes(db)).compacted || 0;
  } catch (err) {
    console.warn('[branchCaixa] compact codes:', err.message);
  }

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
    compacted,
    createdAccounts: created,
    failedBranches: failed,
  };
}

module.exports = {
  ensureBranchCaixaAccount,
  ensureAllBranchCaixaAccounts,
  createExtraBranchCaixaAccount,
  compactSequentialCaixaCodes,
  upsertOperationalCaixaFromAccount,
  allocateNextBranchCaixaCode,
  pickNextTopLevelCaixaCode,
  pickNextExtraCaixaCode,
  isBranchCaixaLeafCode,
  defaultBranchCaixaName,
};
