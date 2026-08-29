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

function normalizeEntityName(value) {
  return cleanText(value)
    .replace(/[.,]/g, ' ')
    .replace(/\b(lda|ltda|sa|s\.a|sarl|llc|inc|co)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * NIFs live inside the free-text `description` ("NIF: 5417003210008"). Splitting on
 * non-alphanumerics gives whole identifiers, so a short NIF can no longer match as a
 * fragment of a longer one belonging to a different entity.
 */
function descriptionNifTokens(description) {
  return cleanText(description)
    .split(/[^0-9a-zA-Z]+/)
    .filter((token) => token.length >= 4)
    .map((token) => token.toLowerCase());
}

/**
 * Company suffixes are already stripped by normalizeEntityName, so containment is
 * only allowed to absorb a couple of leftover characters. A whole extra word means a
 * different party — "BASEL ANGOLA" and "BASEL ANGOLA SOYO" are two suppliers.
 */
function namesRelated(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 3) return false;
  if (a.length >= 5 && b.includes(a)) return true;
  if (b.length >= 5 && a.includes(b)) return true;
  return false;
}

async function findEntityLeafCode(client, groupCode, parentCode, name, nif) {
  const normalizedName = cleanText(name);
  const normalizedNif = normalizeNif(nif);
  if (!normalizedName && !normalizedNif) return null;

  const candidates = await client.query(
    `SELECT code, name, description FROM chart_of_accounts
     WHERE code LIKE $1
       AND code <> $2
       AND LENGTH(CAST(code AS TEXT)) > LENGTH($2)
       AND LENGTH(CAST(code AS TEXT)) >= 8
       AND is_header IS NOT TRUE
       AND is_active IS NOT FALSE
     ORDER BY LENGTH(CAST(code AS TEXT)) DESC, code`,
    [`${groupCode}%`, parentCode],
  ).catch(() => ({ rows: [] }));
  const rows = candidates.rows || [];

  const wantExact = normalizedName.toLowerCase();
  if (wantExact) {
    const exact = rows.find((row) => cleanText(row.name).toLowerCase() === wantExact);
    if (exact) return exact.code;
  }

  const want = normalizeEntityName(normalizedName);
  const wantNif = normalizedNif ? normalizedNif.toLowerCase() : '';

  // A NIF hit is only trusted when the account name belongs to the same entity.
  // Otherwise a shared or mistyped NIF would post onto someone else's ledger.
  if (wantNif) {
    for (const row of rows) {
      if (!descriptionNifTokens(row.description).includes(wantNif)) continue;
      if (!want || namesRelated(want, normalizeEntityName(row.name))) return row.code;
    }
  }

  if (!want || want.length < 3) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const row of rows) {
    const got = normalizeEntityName(row.name);
    if (!got || !namesRelated(want, got)) continue;
    const delta = Math.abs(got.length - want.length);
    if (delta < bestDelta) {
      best = row.code;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * A leaf for this entity may exist but be deactivated (unused accounts are
 * pruned from the chart). Reuse it instead of burning a new code.
 */
async function reactivateEntityLeaf(client, groupCode, name) {
  const target = normalizeEntityName(name);
  if (!target) return null;
  const r = await client.query(
    `SELECT id, code, name FROM chart_of_accounts
     WHERE CAST(code AS TEXT) LIKE $1
       AND LENGTH(CAST(code AS TEXT)) >= 8
       AND is_header IS NOT TRUE
       AND is_active = false`,
    [`${groupCode}%`],
  ).catch(() => ({ rows: [] }));
  const match = (r.rows || []).find((row) => normalizeEntityName(row.name) === target);
  if (!match) return null;
  await client.query(`UPDATE chart_of_accounts SET is_active = true WHERE id = $1`, [match.id]);
  return match.code;
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

  const dormant = await reactivateEntityLeaf(client, groupCode, normalizedName);
  if (dormant) return dormant;

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

module.exports = {
  CLIENT_GROUP_CODE,
  CLIENT_PARENT_CODE,
  SUPPLIER_GROUP_CODE,
  SUPPLIER_PARENT_CODE,
  ensureSupplierSubAccount,
  ensureClientSubAccount,
  resolveEntityAccountCode,
  findEntityLeafCode,
  normalizeEntityName,
  namesRelated,
};
