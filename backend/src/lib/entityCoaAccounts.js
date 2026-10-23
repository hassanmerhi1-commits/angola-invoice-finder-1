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

function nextEntityAccountCode(parentCode, existingCodes, nestedHeaderCodes) {
  const headers = (nestedHeaderCodes || []).filter(
    (h) => h && h !== parentCode && String(h).startsWith(parentCode) && String(h).length > parentCode.length,
  );
  const suffixLen = Math.max(1, ENTITY_ACCOUNT_CODE_LENGTH - parentCode.length);
  const maxSeq = existingCodes.reduce((max, code) => {
    if (!code || !code.startsWith(parentCode) || code.length !== ENTITY_ACCOUNT_CODE_LENGTH) return max;
    if (headers.some((h) => code.startsWith(h))) return max;
    const parsed = Number(code.slice(parentCode.length));
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  return `${parentCode}${String(maxSeq + 1).padStart(suffixLen, '0')}`;
}

function isTruthyFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function isActiveFlag(value) {
  return value !== false && value !== 0 && value !== '0' && value !== 'false';
}

/** Compact 3211 / 3112 slot — used by old supplier leaves and new category headers. */
function isCompactEntityCode(code) {
  const c = String(code || '').trim();
  if (c.startsWith(SUPPLIER_PARENT_CODE) && c.length > SUPPLIER_PARENT_CODE.length && c.length < ENTITY_ACCOUNT_CODE_LENGTH) {
    return true;
  }
  if (c.startsWith(CLIENT_PARENT_CODE) && c.length > CLIENT_PARENT_CODE.length && c.length < ENTITY_ACCOUNT_CODE_LENGTH) {
    return true;
  }
  return false;
}

function nextCompactChildCode(parentCode, existingCodes) {
  const parent = String(parentCode || '').trim();
  const used = new Set((existingCodes || []).map((c) => String(c || '').trim()));
  let n = 1;
  while (used.has(`${parent}${n}`)) n += 1;
  return `${parent}${n}`;
}

/** 321 itself or a compact header under it (3211, 32111). Not an 8-digit supplier leaf. */
function isSupplierCategoryParent(code) {
  const c = String(code || '').trim();
  return c === SUPPLIER_PARENT_CODE
    || (c.startsWith(SUPPLIER_PARENT_CODE) && c.length > SUPPLIER_PARENT_CODE.length && c.length < ENTITY_ACCOUNT_CODE_LENGTH);
}

/** 311 itself or a compact header under it (3111, 31111). */
function isClientCategoryParent(code) {
  const c = String(code || '').trim();
  return c === CLIENT_PARENT_CODE
    || (c.startsWith(CLIENT_PARENT_CODE) && c.length > CLIENT_PARENT_CODE.length && c.length < ENTITY_ACCOUNT_CODE_LENGTH);
}

function isEightDigitEntityLeaf(code) {
  const c = String(code || '').trim();
  return c.length >= ENTITY_ACCOUNT_CODE_LENGTH && /^3[12]/.test(c);
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
       AND LENGTH(CAST(code AS TEXT)) > 3
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
  const usedRows = await client.query(
    `SELECT code, is_header FROM chart_of_accounts WHERE CAST(code AS TEXT) LIKE $1`,
    [`${resolvedParentCode}%`],
  );
  const existingCodes = (usedRows.rows || []).map((r) => String(r.code || ''));
  const headerCodes = (usedRows.rows || [])
    .filter((r) => isTruthyFlag(r.is_header))
    .map((r) => String(r.code || ''));
  let code = nextEntityAccountCode(resolvedParentCode, existingCodes, headerCodes);
  let inserted = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
    const mine = await findEntityLeafCode(client, groupCode, defaultParentCode, normalizedName, normalizedNif);
    if (mine) {
      inserted = true;
      code = mine;
      break;
    }
    existingCodes.push(code);
    code = nextEntityAccountCode(resolvedParentCode, existingCodes, headerCodes);
  }

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

  const created = await findEntityLeafCode(client, groupCode, defaultParentCode, normalizedName, normalizedNif);
  const resolved = created || (inserted ? code : null);
  if (!resolved) {
    console.warn(`[${logTag}] Could not allocate a free leaf under ${resolvedParentCode} for ${normalizedName}`);
    return null;
  }
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

function extractNifFromDescription(description) {
  const match = cleanText(description).match(/NIF:\s*([^\s]+)/i);
  return normalizeNif(match ? match[1] : '');
}

function isEntityLedgerCode(code, groupCode) {
  const c = String(code || '').trim();
  if (groupCode === SUPPLIER_GROUP_CODE) {
    return c.startsWith(SUPPLIER_PARENT_CODE) && c.length > SUPPLIER_PARENT_CODE.length;
  }
  if (groupCode === CLIENT_GROUP_CODE) {
    return c.startsWith(CLIENT_PARENT_CODE) && c.length > CLIENT_PARENT_CODE.length;
  }
  return c.startsWith(groupCode) && c.length >= ENTITY_ACCOUNT_CODE_LENGTH;
}

/**
 * When a customer (31x) / supplier (32x) leaf is renamed in the chart, keep the
 * matching row on clients / suppliers in lockstep. Prefer NIF, then a unique
 * exact old-name match — never rename two masters from one ambiguous name.
 */
async function syncLinkedEntityNameFromCoa(dbOrClient, opts) {
  const code = String(opts?.code || '').trim();
  const isSupplier = isEntityLedgerCode(code, SUPPLIER_GROUP_CODE);
  const isClient = isEntityLedgerCode(code, CLIENT_GROUP_CODE);
  if (!isSupplier && !isClient) return { table: null, updated: 0 };

  const table = isSupplier ? 'suppliers' : 'clients';
  const newName = cleanText(opts?.newName);
  const oldName = cleanText(opts?.oldName);
  const nif = normalizeNif(opts?.nif) || extractNifFromDescription(opts?.description);
  if (!newName || (oldName && newName.toLowerCase() === oldName.toLowerCase())) {
    return { table, updated: 0 };
  }

  const run = (sql, params) => dbOrClient.query(sql, params);

  if (nif) {
    const byNif = await run(
      `UPDATE ${table}
          SET name = $1, updated_at = CURRENT_TIMESTAMP
        WHERE REPLACE(REPLACE(COALESCE(nif, ''), ' ', ''), '-', '') = $2
        RETURNING id`,
      [newName, nif],
    );
    if ((byNif.rowCount || byNif.rows?.length || 0) > 0) {
      return { table, updated: byNif.rowCount || byNif.rows.length };
    }
  }

  if (!oldName) return { table, updated: 0 };

  const matches = await run(
    `SELECT id FROM ${table} WHERE LOWER(TRIM(name)) = LOWER($1)`,
    [oldName],
  );
  if ((matches.rows || []).length !== 1) return { table, updated: 0 };

  await run(
    `UPDATE ${table}
        SET name = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2`,
    [newName, matches.rows[0].id],
  );
  return { table, updated: 1 };
}

async function findLinkedEntityRow(dbOrClient, opts) {
  const code = String(opts?.code || '').trim();
  const isSupplier = isEntityLedgerCode(code, SUPPLIER_GROUP_CODE);
  const isClient = isEntityLedgerCode(code, CLIENT_GROUP_CODE);
  if (!isSupplier && !isClient) return { table: null, id: null };

  const table = isSupplier ? 'suppliers' : 'clients';
  const name = cleanText(opts?.name);
  const nif = normalizeNif(opts?.nif) || extractNifFromDescription(opts?.description);
  const run = (sql, params) => dbOrClient.query(sql, params);

  if (nif) {
    const byNif = await run(
      `SELECT id FROM ${table}
        WHERE REPLACE(REPLACE(COALESCE(nif, ''), ' ', ''), '-', '') = $1
        LIMIT 1`,
      [nif],
    );
    if (byNif.rows?.[0]?.id) return { table, id: byNif.rows[0].id };
  }

  if (!name) return { table, id: null };
  const matches = await run(
    `SELECT id FROM ${table} WHERE LOWER(TRIM(name)) = LOWER($1)`,
    [name],
  );
  if ((matches.rows || []).length !== 1) return { table, id: null };
  return { table, id: matches.rows[0].id };
}

/**
 * Remove the matching supplier / client row when its chart leaf is deleted.
 * Same match rules as rename: NIF first, then a unique exact name.
 * Purchase documents keep their stored supplier_name.
 */
async function deleteLinkedEntityFromCoa(dbOrClient, opts) {
  const found = await findLinkedEntityRow(dbOrClient, opts);
  if (!found.table || !found.id) return { table: found.table, updated: 0 };

  const result = await dbOrClient.query(
    `DELETE FROM ${found.table} WHERE id = $1`,
    [found.id],
  );
  return { table: found.table, updated: result.rowCount || result.rows?.length || 1 };
}

async function refreshChildrenCount(client, parentId) {
  if (!parentId) return;
  await runOptionalInSavepoint(client, 'coa_children_count', async () => {
    await client.query(
      `UPDATE chart_of_accounts SET children_count = (
         SELECT COUNT(*) FROM chart_of_accounts WHERE parent_id = $1 AND is_active IS NOT FALSE
       ) WHERE id = $1`,
      [parentId],
    );
  }, () => {});
}

async function accountHasJournalLines(client, row) {
  const entries = await client.query(
    `SELECT id FROM journal_entry_lines
      WHERE CAST(account_id AS TEXT) = CAST($1 AS TEXT)
         OR CAST(account_id AS TEXT) = CAST($2 AS TEXT)
      LIMIT 1`,
    [row.id, row.code],
  );
  return (entries.rows || []).length > 0;
}

/**
 * Move a compact 3211-style supplier/client leaf to an 8-digit code so 3211 can
 * become a category header. Journals that stored the old PGC code are rewritten.
 */
async function recodeOccupyingLeaf(client, row) {
  const code = String(row.code || '').trim();
  let parentCode = code.startsWith(CLIENT_PARENT_CODE)
    ? CLIENT_PARENT_CODE
    : code.startsWith(SUPPLIER_PARENT_CODE)
      ? SUPPLIER_PARENT_CODE
      : code.startsWith('45')
        ? '45'
        : code.slice(0, Math.max(1, code.length - 1));
  if (row.parent_id) {
    const parent = await client.query(
      'SELECT code FROM chart_of_accounts WHERE id = $1 LIMIT 1',
      [row.parent_id],
    );
    const got = String(parent.rows?.[0]?.code || '').trim();
    if (got) parentCode = got;
  }

  const usedRows = await client.query(
    `SELECT code, is_header FROM chart_of_accounts WHERE CAST(code AS TEXT) LIKE $1`,
    [`${parentCode}%`],
  );
  const existingCodes = (usedRows.rows || [])
    .map((r) => String(r.code || ''))
    .filter((c) => c && c !== code);
  const headerCodes = (usedRows.rows || [])
    .filter((r) => isTruthyFlag(r.is_header))
    .map((r) => String(r.code || ''));
  const newCode = nextEntityAccountCode(parentCode, existingCodes, headerCodes);
  const parent = await client.query(
    'SELECT id FROM chart_of_accounts WHERE code = $1 LIMIT 1',
    [parentCode],
  );
  await client.query(
    `UPDATE chart_of_accounts
        SET code = $1,
            parent_id = COALESCE($2, parent_id),
            is_header = false,
            is_active = true,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $3`,
    [newCode, parent.rows?.[0]?.id || null, row.id],
  );
  await rewriteStoredSupplierAccountCode(client, code, newCode);
  return { oldCode: code, newCode, id: row.id };
}

/**
 * Decide how to take a COA code: insert, reactivate an unused row, or move an
 * old compact supplier leaf (3211) to 32100001 so the number can be a category.
 */
async function claimChartAccountCode(client, opts) {
  const code = String(opts?.code || '').trim();
  const wantHeader = !!opts?.isHeader;
  if (!code) throw new Error('Account code is required');

  const existing = await client.query(
    `SELECT id, code, name, description, is_active, is_header, parent_id
       FROM chart_of_accounts WHERE code = $1 LIMIT 1`,
    [code],
  );
  const row = existing.rows?.[0];
  if (!row) return { action: 'insert' };

  const header = isTruthyFlag(row.is_header);
  const active = isActiveFlag(row.is_active);
  const nifLeaf = /NIF\s*:/i.test(String(row.description || ''));
  const compactLeaf = (
    (isCompactEntityCode(row.code) && (!header || nifLeaf))
    || (!header && String(row.code || '').length < ENTITY_ACCOUNT_CODE_LENGTH && String(row.code || '').trim() !== '45')
  );

  if (wantHeader && compactLeaf) {
    const recoded = await recodeOccupyingLeaf(client, row);
    return { action: 'insert', recoded };
  }

  if (wantHeader && header) {
    return { action: 'reuse', row };
  }

  if (!active) {
    const busy = await accountHasJournalLines(client, row);
    if (!busy) return { action: 'reuse', row };
    if (compactLeaf) {
      const recoded = await recodeOccupyingLeaf(client, row);
      return { action: 'insert', recoded };
    }
  }

  const used = await client.query('SELECT code FROM chart_of_accounts');
  const parent = code.startsWith(SUPPLIER_PARENT_CODE) ? SUPPLIER_PARENT_CODE
    : code.startsWith(CLIENT_PARENT_CODE) ? CLIENT_PARENT_CODE
      : code.startsWith('45') ? '45'
        : code.slice(0, Math.max(1, code.length - 1));
  const suggestion = nextCompactChildCode(parent, (used.rows || []).map((r) => r.code));
  const err = new Error(`A conta ${code} já existe (${row.name}). Tente ${suggestion}.`);
  err.code = 'CODE_EXISTS';
  err.existing = { code: row.code, name: row.name };
  err.suggestion = suggestion;
  throw err;
}

async function rewriteStoredSupplierAccountCode(client, oldCode, newCode) {
  if (!oldCode || !newCode || oldCode === newCode) return;
  await client.query(
    `UPDATE journal_entry_lines
        SET account_id = $1
      WHERE CAST(account_id AS TEXT) = CAST($2 AS TEXT)`,
    [newCode, oldCode],
  ).catch(() => {});
  await client.query(
    `UPDATE purchase_invoices
        SET supplier_account_code = $1
      WHERE CAST(supplier_account_code AS TEXT) = CAST($2 AS TEXT)`,
    [newCode, oldCode],
  ).catch(() => {});
}

async function assertNotMovingIntoSelf(client, leafId, newParentId) {
  let current = newParentId;
  const seen = new Set();
  while (current) {
    if (String(current) === String(leafId)) {
      throw new Error('Cannot move an account into itself or one of its children');
    }
    if (seen.has(String(current))) break;
    seen.add(String(current));
    const row = await client.query(
      'SELECT parent_id FROM chart_of_accounts WHERE id = $1 LIMIT 1',
      [current],
    );
    current = row.rows?.[0]?.parent_id || null;
  }
}

/**
 * Move a leaf under a category parent. Same rule on every tab: 8-digit leaf
 * (32110001 under 3211, 45100001 under 451). The COA id stays so journal
 * lines stored by UUID remain valid.
 */
async function moveEntityLeafToParent(client, opts) {
  const requestedParent = cleanText(opts?.parentCode);
  let leaf = null;
  if (opts?.accountId) {
    const r = await client.query(
      `SELECT id, code, name, description, parent_id, is_header
         FROM chart_of_accounts WHERE id = $1 LIMIT 1`,
      [opts.accountId],
    );
    leaf = r.rows?.[0] || null;
  }
  if (!leaf && (opts?.name || opts?.nif)) {
    const code = await findEntityLeafCode(
      client,
      SUPPLIER_GROUP_CODE,
      SUPPLIER_PARENT_CODE,
      opts.name,
      opts.nif,
    );
    if (code) {
      const r = await client.query(
        `SELECT id, code, name, description, parent_id, is_header
           FROM chart_of_accounts WHERE code = $1 LIMIT 1`,
        [code],
      );
      leaf = r.rows?.[0] || null;
    }
  }
  if (!leaf) throw new Error('Account not found');
  if (leaf.is_header === true || leaf.is_header === 1) {
    throw new Error('Cannot move a category header — pick an account');
  }
  if (String(leaf.code || '').trim() === '45') {
    throw new Error('Cannot move the cash parent (45)');
  }

  const supplierLeaf = isEntityLedgerCode(leaf.code, SUPPLIER_GROUP_CODE);
  const clientLeaf = isEntityLedgerCode(leaf.code, CLIENT_GROUP_CODE);
  const entityLeaf = isEightDigitEntityLeaf(leaf.code) || supplierLeaf || clientLeaf;
  const parentCode = requestedParent
    || (supplierLeaf ? SUPPLIER_PARENT_CODE : clientLeaf ? CLIENT_PARENT_CODE : '');
  if (!parentCode) throw new Error('parentCode is required');

  if (supplierLeaf && !isSupplierCategoryParent(parentCode)) {
    throw new Error(`Parent ${parentCode} is not a supplier category under 321`);
  }
  if (clientLeaf && !isClientCategoryParent(parentCode)) {
    throw new Error(`Parent ${parentCode} is not a customer category under 311`);
  }

  const parent = await client.query(
    `SELECT id, code, level FROM chart_of_accounts
      WHERE code = $1 AND is_active IS NOT FALSE
      LIMIT 1`,
    [parentCode],
  );
  if (!parent.rows?.[0]) {
    throw new Error(`Category ${parentCode} not found`);
  }
  if (String(leaf.id) === String(parent.rows[0].id)) {
    throw new Error('Cannot move an account into itself');
  }
  await assertNotMovingIntoSelf(client, leaf.id, parent.rows[0].id);

  if (String(leaf.parent_id || '') === String(parent.rows[0].id)) {
    return { id: leaf.id, oldCode: leaf.code, newCode: leaf.code, parentCode, moved: false };
  }

  const used = await client.query('SELECT code FROM chart_of_accounts');
  const usedCodes = (used.rows || []).map((r) => r.code).filter((c) => c !== leaf.code);
  const siblings = await client.query(
    `SELECT code FROM chart_of_accounts WHERE parent_id = $1 AND is_header IS NOT TRUE`,
    [parent.rows[0].id],
  );
  const headerCodes = usedCodes.filter(
    (c) => c && c !== parentCode && String(c).startsWith(parentCode) && String(c).length < ENTITY_ACCOUNT_CODE_LENGTH,
  );
  const newCode = nextEntityAccountCode(
    parentCode,
    usedCodes.filter((c) => String(c).length === ENTITY_ACCOUNT_CODE_LENGTH),
    headerCodes,
  );
  if (usedCodes.includes(newCode)) {
    throw new Error(`Code ${newCode} is already in use`);
  }
  const newLevel = (parseInt(parent.rows[0].level, 10) || 2) + 1;
  const oldParentId = leaf.parent_id;

  await client.query(
    `UPDATE chart_of_accounts
        SET parent_id = $1, code = $2, level = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4`,
    [parent.rows[0].id, newCode, newLevel, leaf.id],
  );
  await rewriteStoredSupplierAccountCode(client, leaf.code, newCode);
  await refreshChildrenCount(client, oldParentId);
  await refreshChildrenCount(client, parent.rows[0].id);

  return { id: leaf.id, oldCode: leaf.code, newCode, parentCode, moved: true };
}

/** Hide an unused 32x/31x leaf after the master row is deleted. Keep it if it has journals. */
async function deactivateUnusedEntityLeaf(dbOrClient, opts) {
  const groupCode = opts?.groupCode || SUPPLIER_GROUP_CODE;
  const parentCode = opts?.parentCode || SUPPLIER_PARENT_CODE;
  const code = await findEntityLeafCode(dbOrClient, groupCode, parentCode, opts?.name, opts?.nif);
  if (!code) return { code: null, deactivated: false };

  const acc = await dbOrClient.query(
    'SELECT id, code FROM chart_of_accounts WHERE code = $1 LIMIT 1',
    [code],
  );
  if (!acc.rows?.[0]) return { code, deactivated: false };

  const entries = await dbOrClient.query(
    `SELECT id FROM journal_entry_lines
      WHERE CAST(account_id AS TEXT) = CAST($1 AS TEXT)
         OR CAST(account_id AS TEXT) = CAST($2 AS TEXT)
      LIMIT 1`,
    [acc.rows[0].id, code],
  );
  if ((entries.rows || []).length > 0) return { code, deactivated: false };

  await dbOrClient.query(
    'UPDATE chart_of_accounts SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [acc.rows[0].id],
  );
  return { code, deactivated: true };
}

module.exports = {
  CLIENT_GROUP_CODE,
  CLIENT_PARENT_CODE,
  SUPPLIER_GROUP_CODE,
  SUPPLIER_PARENT_CODE,
  ENTITY_ACCOUNT_CODE_LENGTH,
  nextEntityAccountCode,
  nextCompactChildCode,
  isCompactEntityCode,
  isSupplierCategoryParent,
  isClientCategoryParent,
  ensureSupplierSubAccount,
  ensureClientSubAccount,
  resolveEntityAccountCode,
  findEntityLeafCode,
  normalizeEntityName,
  namesRelated,
  extractNifFromDescription,
  syncLinkedEntityNameFromCoa,
  deleteLinkedEntityFromCoa,
  deactivateUnusedEntityLeaf,
  moveEntityLeafToParent,
  recodeOccupyingLeaf,
  claimChartAccountCode,
};
