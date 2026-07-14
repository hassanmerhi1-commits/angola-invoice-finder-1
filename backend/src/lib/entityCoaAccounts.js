/**
 * Shared customer (31x) / supplier (32x) leaf account resolution for COA posting.
 * Payments, purchases, and master-data create must all resolve the same 8-digit leaf —
 * never silently fall back to parent 311/321 when a leaf exists or can be created.
 */
const { randomUUID } = require('crypto');

const CLIENT_GROUP_CODE = '31';
const CLIENT_PARENT_CODE = '311';
const SUPPLIER_GROUP_CODE = '32';
const SUPPLIER_PARENT_CODE = '321';
const ENTITY_ACCOUNT_CODE_LENGTH = 8;

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNif(value) {
  return String(value || '').replace(/\s/g, '').trim() || null;
}

function nextEntityAccountCode(parentCode, existingCodes) {
  const suffixLen = ENTITY_ACCOUNT_CODE_LENGTH - parentCode.length;
  const maxSeq = existingCodes.reduce((max, code) => {
    if (!code || !code.startsWith(parentCode) || code.length <= parentCode.length) return max;
    const parsed = Number(code.slice(parentCode.length));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${parentCode}${String(maxSeq + 1).padStart(suffixLen, '0')}`;
}

async function findEntityLeafCode(client, groupCode, parentCode, name, nif) {
  const normalizedName = cleanText(name);
  const normalizedNif = normalizeNif(nif);
  if (!normalizedName && !normalizedNif) return null;

  const result = normalizedNif
    ? await client.query(
        `SELECT code
         FROM chart_of_accounts
         WHERE code LIKE $1
           AND code <> $2
           AND LENGTH(code) > LENGTH($2)
           AND level >= 3
           AND is_header = false
           AND is_active = true
           AND (
             ($3 != '' AND LOWER(TRIM(name)) = LOWER($3))
             OR LOWER(COALESCE(description, '')) LIKE '%' || LOWER($4) || '%'
           )
         ORDER BY LENGTH(code) DESC
         LIMIT 1`,
        [`${groupCode}%`, parentCode, normalizedName, normalizedNif],
      )
    : await client.query(
        `SELECT code
         FROM chart_of_accounts
         WHERE code LIKE $1
           AND code <> $2
           AND LENGTH(code) > LENGTH($2)
           AND level >= 3
           AND is_header = false
           AND is_active = true
           AND LOWER(TRIM(name)) = LOWER($3)
         ORDER BY LENGTH(code) DESC
         LIMIT 1`,
        [`${groupCode}%`, parentCode, normalizedName],
      );
  return result.rows[0]?.code || null;
}

async function createEntityLeaf(client, opts) {
  const {
    groupCode,
    defaultParentCode,
    name,
    nif,
    parentCode,
    accountType,
    accountNature,
    logTag,
  } = opts;
  const normalizedName = cleanText(name);
  const normalizedNif = normalizeNif(nif);
  if (!normalizedName) return null;

  const existing = await findEntityLeafCode(client, groupCode, defaultParentCode, normalizedName, normalizedNif);
  if (existing) return existing;

  let resolvedParentCode = cleanText(parentCode) || defaultParentCode;
  if (!resolvedParentCode.startsWith(groupCode)) {
    resolvedParentCode = defaultParentCode;
  }

  let parent = await client.query(
    `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [resolvedParentCode],
  );
  if (parent.rows.length === 0 && resolvedParentCode !== defaultParentCode) {
    resolvedParentCode = defaultParentCode;
    parent = await client.query(
      `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [resolvedParentCode],
    );
  }
  if (parent.rows.length === 0) {
    resolvedParentCode = groupCode;
    parent = await client.query(
      `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [resolvedParentCode],
    );
  }
  if (parent.rows.length === 0) {
    console.warn(`[${logTag}] Parent account ${defaultParentCode}/${groupCode} not found — skipping sub-account`);
    return null;
  }

  const parentId = parent.rows[0].id;
  const childLevel = (parseInt(parent.rows[0].level, 10) || 2) + 1;
  const seqResult = await client.query(
    `SELECT code FROM chart_of_accounts WHERE code LIKE $1 AND is_header = false`,
    [`${resolvedParentCode}%`],
  );
  const code = nextEntityAccountCode(resolvedParentCode, seqResult.rows.map((r) => r.code));

  await client.query(
    `INSERT INTO chart_of_accounts
     (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active, opening_balance, current_balance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, true, 0, 0)
     ON CONFLICT (code) DO NOTHING`,
    [
      randomUUID(),
      code,
      normalizedName,
      normalizedNif ? `NIF: ${normalizedNif}` : '',
      accountType,
      accountNature,
      parentId,
      childLevel,
    ],
  );

  await client.query(
    `UPDATE chart_of_accounts SET children_count = (
       SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
     ) WHERE id = $1`,
    [parentId],
  );

  // Re-read in case ON CONFLICT skipped insert
  const created = await findEntityLeafCode(client, groupCode, defaultParentCode, normalizedName, normalizedNif);
  const resolved = created || code;
  console.log(`[${logTag}] Ensured sub-account ${resolved} — ${normalizedName}`);
  return resolved;
}

async function ensureSupplierSubAccount(client, supplierName, supplierNif, parentCode) {
  return createEntityLeaf(client, {
    groupCode: SUPPLIER_GROUP_CODE,
    defaultParentCode: SUPPLIER_PARENT_CODE,
    name: supplierName,
    nif: supplierNif,
    parentCode,
    accountType: 'liability',
    accountNature: 'credit',
    logTag: 'SUPPLIERS',
  });
}

async function ensureClientSubAccount(client, clientName, clientNif, parentCode) {
  return createEntityLeaf(client, {
    groupCode: CLIENT_GROUP_CODE,
    defaultParentCode: CLIENT_PARENT_CODE,
    name: clientName,
    nif: clientNif,
    parentCode,
    accountType: 'asset',
    accountNature: 'debit',
    logTag: 'CLIENTS',
  });
}

/**
 * Resolve the leaf COA code for a supplier or customer payment/purchase posting.
 * Creates the leaf when missing. Falls back to 321/311 only if create is impossible.
 */
async function resolveEntityAccountCode(client, entityType, entityId, entityName) {
  const isSupplier = entityType === 'supplier';
  const groupCode = isSupplier ? SUPPLIER_GROUP_CODE : CLIENT_GROUP_CODE;
  const parentCode = isSupplier ? SUPPLIER_PARENT_CODE : CLIENT_PARENT_CODE;
  const fallback = parentCode;

  let name = cleanText(entityName);
  let nif = null;

  if (entityId) {
    try {
      const table = isSupplier ? 'suppliers' : 'clients';
      const row = await client.query(
        `SELECT name, nif FROM ${table} WHERE id = $1 LIMIT 1`,
        [entityId],
      );
      if (row.rows[0]) {
        name = cleanText(row.rows[0].name) || name;
        nif = normalizeNif(row.rows[0].nif);
      }
    } catch (e) {
      console.warn(`[ENTITY COA] Failed to load ${entityType} ${entityId}:`, e.message);
    }
  }

  try {
    const existing = await findEntityLeafCode(client, groupCode, parentCode, name, nif);
    if (existing) return existing;

    if (name) {
      const created = isSupplier
        ? await ensureSupplierSubAccount(client, name, nif)
        : await ensureClientSubAccount(client, name, nif);
      if (created) return created;
    }
  } catch (e) {
    console.warn(`[ENTITY COA] resolveEntityAccountCode failed:`, e.message);
  }

  return fallback;
}

module.exports = {
  CLIENT_GROUP_CODE,
  CLIENT_PARENT_CODE,
  SUPPLIER_GROUP_CODE,
  SUPPLIER_PARENT_CODE,
  ensureSupplierSubAccount,
  ensureClientSubAccount,
  resolveEntityAccountCode,
  findEntityLeafCode,
};
