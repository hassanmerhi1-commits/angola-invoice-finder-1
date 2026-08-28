/**
 * Shared customer (31x) / supplier (32x) leaf account resolution for COA posting.
 * Payments, purchases, and master-data create must all resolve the same 8-digit leaf —
 * never silently fall back to parent 311/321 when a leaf exists or can be created.
 */
const { randomUUID } = require('crypto');
const { runOptionalInSavepoint } = require('./pgSavepoint');

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

  await runOptionalInSavepoint(client, 'coa_children_count', async () => {
    await client.query(
      `UPDATE chart_of_accounts SET children_count = (
         SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active = true
       ) WHERE id = $1`,
      [parentId],
    );
  }, (e) => {
    console.warn(`[${logTag}] children_count update skipped:`, e.message);
  });

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
 * Creates the leaf when missing. Throws when an entity is known but no leaf can be made
 * (never silently post to bare 321/311).
 */
async function resolveEntityAccountCode(client, entityType, entityId, entityName) {
  const isSupplier = entityType === 'supplier';
  const groupCode = isSupplier ? SUPPLIER_GROUP_CODE : CLIENT_GROUP_CODE;
  const parentCode = isSupplier ? SUPPLIER_PARENT_CODE : CLIENT_PARENT_CODE;

  let name = cleanText(entityName);
  let nif = null;

  if (entityId) {
    await runOptionalInSavepoint(client, 'load_entity', async () => {
      const table = isSupplier ? 'suppliers' : 'clients';
      const row = await client.query(
        `SELECT name, nif FROM ${table} WHERE id = $1 LIMIT 1`,
        [entityId],
      );
      if (row.rows[0]) {
        name = cleanText(row.rows[0].name) || name;
        nif = normalizeNif(row.rows[0].nif);
      }
    }, (e) => {
      console.warn(`[ENTITY COA] Failed to load ${entityType} ${entityId}:`, e.message);
    });
  }

  const existing = await findEntityLeafCode(client, groupCode, parentCode, name, nif);
  if (existing) return existing;

  if (name) {
    const created = isSupplier
      ? await ensureSupplierSubAccount(client, name, nif)
      : await ensureClientSubAccount(client, name, nif);
    if (created) return created;
  }

  // Never silently post to bare 321/311 when we have an entity — fail loud.
  if (name || entityId) {
    throw new Error(
      `Could not resolve ${isSupplier ? 'supplier' : 'customer'} COA leaf`
      + (name ? ` for "${name}"` : '')
      + ` (parent ${parentCode}). Create the account under ${parentCode} first.`,
    );
  }
  return parentCode;
}

/**
 * Find-or-create 31x/32x leaves for every supplier and customer master row.
 * Creating a supplier used to skip the COA leaf when 321 was missing or the
 * insert was non-fatal; purchases then had no Fornecedores line to show.
 */
async function ensureAllMasterEntityLeaves(client) {
  const result = { suppliers: 0, clients: 0, errors: 0 };
  const supplierRows = await client.query(
    `SELECT name, nif FROM suppliers WHERE TRIM(COALESCE(name, '')) <> ''`,
  ).catch(() => ({ rows: [] }));
  for (const row of supplierRows.rows || []) {
    try {
      const code = await ensureSupplierSubAccount(client, row.name, row.nif);
      if (code) result.suppliers += 1;
    } catch (e) {
      result.errors += 1;
      console.warn('[ENTITY COA] supplier leaf skipped:', cleanText(row.name), e.message);
    }
  }
  const clientRows = await client.query(
    `SELECT name, nif FROM clients WHERE TRIM(COALESCE(name, '')) <> ''`,
  ).catch(() => ({ rows: [] }));
  for (const row of clientRows.rows || []) {
    try {
      const code = await ensureClientSubAccount(client, row.name, row.nif);
      if (code) result.clients += 1;
    } catch (e) {
      result.errors += 1;
      console.warn('[ENTITY COA] client leaf skipped:', cleanText(row.name), e.message);
    }
  }
  return result;
}

module.exports = {
  CLIENT_GROUP_CODE,
  CLIENT_PARENT_CODE,
  SUPPLIER_GROUP_CODE,
  SUPPLIER_PARENT_CODE,
  ensureSupplierSubAccount,
  ensureClientSubAccount,
  ensureAllMasterEntityLeaves,
  resolveEntityAccountCode,
  findEntityLeafCode,
};
