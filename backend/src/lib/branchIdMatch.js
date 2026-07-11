/**
 * Resolve branch filter param to canonical branch id.
 * Handles UUID/string mismatches and code/name lookups (e.g. SOYO05 / Soyo 05).
 */

function normalizeBranchIdKey(id) {
  return String(id || '').trim().toLowerCase().replace(/-/g, '');
}

/** True when two branch ids refer to the same filial (dashless UUID / legacy keys). */
function branchKeysEqual(a, b) {
  const left = normalizeBranchIdKey(a);
  const right = normalizeBranchIdKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length >= 8 && right.length >= 8 && left === right;
}

function normalizeBranchNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function branchIdSqlNorm(columnExpr, db) {
  const col = db.engine === 'postgres' ? columnExpr : columnExpr;
  return `REPLACE(LOWER(TRIM(COALESCE(${col}, ''))), '-', '')`;
}

async function resolveBranchFilterId(db, branchId) {
  const raw = String(branchId || '').trim();
  if (!raw) return null;

  const idSql =
    db.engine === 'postgres'
      ? 'SELECT id::text AS id FROM branches WHERE id::text = $1 LIMIT 1'
      : 'SELECT CAST(id AS TEXT) AS id FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1';
  const byId = await db.query(idSql, [raw]);
  if (byId.rows[0]?.id) return String(byId.rows[0].id);

  const rawKey = normalizeBranchIdKey(raw);
  if (rawKey.length >= 8) {
    const dashlessSql =
      db.engine === 'postgres'
        ? `SELECT id::text AS id FROM branches
           WHERE REPLACE(LOWER(id::text), '-', '') = $1 LIMIT 1`
        : `SELECT CAST(id AS TEXT) AS id FROM branches
           WHERE REPLACE(LOWER(CAST(id AS TEXT)), '-', '') = $1 LIMIT 1`;
    const byDashless = await db.query(dashlessSql, [rawKey]);
    if (byDashless.rows[0]?.id) return String(byDashless.rows[0].id);
  }

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

  const nameKey = normalizeBranchNameKey(raw);
  if (nameKey.length >= 2) {
    const byName = await db.query(
      db.engine === 'postgres'
        ? `SELECT id::text AS id FROM branches
           WHERE lower(trim(name)) = $1
              OR lower(trim(coalesce(code, ''))) = replace($1, ' ', '')
           LIMIT 1`
        : `SELECT CAST(id AS TEXT) AS id FROM branches
           WHERE lower(trim(name)) = $1
              OR lower(trim(coalesce(code, ''))) = replace($1, ' ', '')
           LIMIT 1`,
      [nameKey],
    );
    if (byName.rows[0]?.id) return String(byName.rows[0].id);
  }

  return raw;
}

/**
 * Resolve branchId param to a branches table row (canonical id, code, name).
 */
async function resolveBranchRow(db, branchId) {
  const resolved = await resolveBranchFilterId(db, branchId);
  if (!resolved) return null;

  const key = normalizeBranchIdKey(resolved);
  const byId = await db.query(
    db.engine === 'postgres'
      ? `SELECT id::text AS id, code, name FROM branches
         WHERE id::text = $1
            OR REPLACE(LOWER(id::text), '-', '') = $2
         LIMIT 1`
      : `SELECT CAST(id AS TEXT) AS id, code, name FROM branches
         WHERE CAST(id AS TEXT) = $1
            OR REPLACE(LOWER(CAST(id AS TEXT)), '-', '') = $2
         LIMIT 1`,
    [resolved, key],
  );
  if (byId.rows[0]?.id) return byId.rows[0];

  const byMeta = await db.query(
    db.engine === 'postgres'
      ? `SELECT id::text AS id, code, name FROM branches
         WHERE lower(trim(coalesce(code, ''))) = lower($1)
            OR lower(trim(name)) = lower($1)
         LIMIT 1`
      : `SELECT CAST(id AS TEXT) AS id, code, name FROM branches
         WHERE lower(trim(coalesce(code, ''))) = lower($1)
            OR lower(trim(name)) = lower($1)
         LIMIT 1`,
    [resolved],
  );
  return byMeta.rows[0] || null;
}

function castText(columnExpr) {
  return (db) => (db.engine === 'postgres' ? `${columnExpr}::text` : `CAST(${columnExpr} AS TEXT)`);
}

/**
 * For purchase_invoices: match branch_id, warehouse_id, names, and dashless UUID keys.
 */
async function buildPurchaseInvoiceBranchFilter(db, branchId, startParamIdx) {
  const resolved = await resolveBranchFilterId(db, branchId);
  if (!resolved) return { sql: '', params: [] };

  const branchCol = castText('branch_id')(db);
  const whCol = castText('warehouse_id')(db);
  const branchNorm = branchIdSqlNorm('branch_id', db);
  const whNorm = branchIdSqlNorm('warehouse_id', db);

  const matchValues = new Set([resolved]);
  let branchName = '';
  let branchCode = '';
  try {
    const meta = await db.query(
      db.engine === 'postgres'
        ? `SELECT id::text AS id, code, name FROM branches WHERE id::text = $1 LIMIT 1`
        : `SELECT CAST(id AS TEXT) AS id, code, name FROM branches WHERE CAST(id AS TEXT) = $1 LIMIT 1`,
      [resolved],
    );
    const row = meta.rows[0];
    if (row?.code) {
      branchCode = String(row.code).trim();
      matchValues.add(branchCode);
    }
    if (row?.name) {
      branchName = String(row.name).trim();
      matchValues.add(branchName);
    }
    const resolvedKey = normalizeBranchIdKey(resolved);
    if (resolvedKey) matchValues.add(resolvedKey);
  } catch {
    /* optional */
  }

  const params = [];
  const clauses = [];
  let idx = startParamIdx;
  for (const val of matchValues) {
    if (!val) continue;
    const p = `$${idx++}`;
    params.push(val);
    clauses.push(`${branchCol} = ${p}`, `${whCol} = ${p}`);
  }

  const resolvedKey = normalizeBranchIdKey(resolved);
  if (resolvedKey) {
    const p = `$${idx++}`;
    params.push(resolvedKey);
    clauses.push(`${branchNorm} = ${p}`, `${whNorm} = ${p}`);
  }

  if (branchName) {
    const p = `$${idx++}`;
    params.push(normalizeBranchNameKey(branchName));
    clauses.push(
      `LOWER(TRIM(COALESCE(branch_name, ''))) = ${p}`,
      `LOWER(TRIM(COALESCE(warehouse_name, ''))) = ${p}`,
    );
  }

  if (!clauses.length) return { sql: '', params: [] };

  return {
    sql: ` AND (${clauses.join(' OR ')})`,
    params,
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
  const norm = branchIdSqlNorm('je.branch_id', db);
  const key = normalizeBranchIdKey(resolved);
  if (key) {
    const p2 = `$${startParamIdx + 1}`;
    return {
      sql: ` AND (${col} = ${p} OR ${norm} = ${p2})`,
      params: [resolved, key],
    };
  }
  return {
    sql: ` AND ${col} = ${p}`,
    params: [resolved],
  };
}

module.exports = {
  normalizeBranchIdKey,
  normalizeBranchNameKey,
  branchKeysEqual,
  resolveBranchFilterId,
  resolveBranchRow,
  buildPurchaseInvoiceBranchFilter,
  buildJournalBranchFilter,
};
