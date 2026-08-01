/**
 * Move journal lines off parent 321/311 onto the correct 8-digit supplier/client leaf.
 *
 * City data often posted purchases/payments to bare 321 — tree leaves (ATLAS, etc.)
 * stay at 0 while parent 321 holds the full balance. Ledger on the parent shows
 * movements; leaves look empty.
 */
const {
  resolveEntityAccountCode,
  findEntityLeafCode,
  SUPPLIER_PARENT_CODE,
  CLIENT_PARENT_CODE,
  SUPPLIER_GROUP_CODE,
  CLIENT_GROUP_CODE,
} = require('./entityCoaAccounts');

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadParentIds(client) {
  const r = await client.query(
    `SELECT id, code FROM chart_of_accounts
     WHERE code IN ('321', '311') AND is_active = true`,
  );
  const map = new Map();
  for (const row of r.rows || []) map.set(String(row.code), row.id);
  return map;
}

async function resolveLeafFromPayment(client, journalEntryId) {
  const r = await client.query(
    `SELECT p.entity_type, p.entity_id, p.entity_name
     FROM journal_entries je
     INNER JOIN payments p ON CAST(p.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND je.reference_type IN ('payment', 'payment_out', 'payment_receipt', 'receipt')
       AND p.entity_type IN ('supplier', 'customer')
     LIMIT 1`,
    [journalEntryId],
  );
  const row = r.rows?.[0];
  if (!row) return null;
  const code = await resolveEntityAccountCode(
    client,
    row.entity_type,
    row.entity_id,
    row.entity_name,
  );
  if (!code || code === '321' || code === '311') return null;
  return code;
}

async function resolveLeafFromPurchase(client, journalEntryId) {
  const r = await client.query(
    `SELECT pi.supplier_id, pi.supplier_name, pi.supplier_account_code
     FROM journal_entries je
     INNER JOIN purchase_invoices pi ON CAST(pi.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND je.reference_type IN ('purchase_invoice', 'purchase')
     LIMIT 1`,
    [journalEntryId],
  );
  const row = r.rows?.[0];
  if (!row) return null;
  const stored = cleanText(row.supplier_account_code);
  if (/^321\d{5,}$/i.test(stored)) return stored;
  const code = await resolveEntityAccountCode(
    client,
    'supplier',
    row.supplier_id,
    row.supplier_name,
  );
  if (!code || code === '321') return null;
  return code;
}

async function resolveLeafFromDescription(client, parentCode, description) {
  const desc = cleanText(description);
  if (!desc || desc.length < 3) return null;
  const group = parentCode === CLIENT_PARENT_CODE ? CLIENT_GROUP_CODE : SUPPLIER_GROUP_CODE;
  const parent = parentCode === CLIENT_PARENT_CODE ? CLIENT_PARENT_CODE : SUPPLIER_PARENT_CODE;

  // Exact leaf name contained in description (or vice versa).
  const r = await client.query(
    `SELECT code, name
     FROM chart_of_accounts
     WHERE code LIKE $1
       AND code <> $2
       AND LENGTH(code) > LENGTH($2)
       AND is_header = false
       AND is_active = true
       AND (
         LOWER($3) LIKE '%' || LOWER(TRIM(name)) || '%'
         OR LOWER(TRIM(name)) LIKE '%' || LOWER($3) || '%'
       )
     ORDER BY LENGTH(name) DESC
     LIMIT 1`,
    [`${group}%`, parent, desc],
  );
  if (r.rows?.[0]?.code) return r.rows[0].code;

  // Try suppliers/clients table names.
  const table = parentCode === CLIENT_PARENT_CODE ? 'clients' : 'suppliers';
  const ent = await client.query(
    `SELECT id, name, nif FROM ${table}
     WHERE is_active = true
       AND LOWER($1) LIKE '%' || LOWER(TRIM(name)) || '%'
       AND LENGTH(TRIM(name)) >= 3
     ORDER BY LENGTH(name) DESC
     LIMIT 1`,
    [desc],
  ).catch(() => ({ rows: [] }));
  const e = ent.rows?.[0];
  if (!e) return null;
  return findEntityLeafCode(client, group, parent, e.name, e.nif);
}

async function accountIdForCode(client, code) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [code],
  );
  return r.rows?.[0]?.id || null;
}

/**
 * @returns {{ moved: number, skipped: number, details: string[] }}
 */
async function repairParentEntityCoaPostings(db, opts = {}) {
  const dryRun = opts.dryRun === true;
  const parentIds = await loadParentIds(db);
  if (parentIds.size === 0) {
    return { moved: 0, skipped: 0, details: ['no parent 321/311 accounts'] };
  }

  const lines = (
    await db.query(
      `SELECT
         jel.id AS line_id,
         jel.journal_entry_id,
         jel.account_id AS old_account_id,
         jel.debit_amount,
         jel.credit_amount,
         jel.description AS line_description,
         je.description AS journal_description,
         je.reference_type,
         je.entry_number,
         coa.code AS old_code
       FROM journal_entry_lines jel
       INNER JOIN journal_entries je ON CAST(je.id AS TEXT) = CAST(jel.journal_entry_id AS TEXT)
       INNER JOIN chart_of_accounts coa ON CAST(coa.id AS TEXT) = CAST(jel.account_id AS TEXT)
       WHERE CAST(coa.code AS TEXT) IN ('321', '311')
       ORDER BY je.entry_date, je.created_at`,
    )
  ).rows || [];

  let moved = 0;
  let skipped = 0;
  const details = [];

  for (const row of lines) {
    const parentCode = row.old_code === '311' ? '311' : '321';
    let leafCode = null;
    try {
      leafCode = await resolveLeafFromPayment(db, row.journal_entry_id);
      if (!leafCode) leafCode = await resolveLeafFromPurchase(db, row.journal_entry_id);
      if (!leafCode) {
        leafCode = await resolveLeafFromDescription(
          db,
          parentCode,
          row.line_description || row.journal_description || '',
        );
      }
    } catch (e) {
      details.push(`skip ${row.entry_number}: resolve failed (${e.message})`);
      skipped += 1;
      continue;
    }

    if (!leafCode || leafCode === parentCode) {
      skipped += 1;
      continue;
    }

    const leafId = await accountIdForCode(db, leafCode);
    if (!leafId || String(leafId) === String(row.old_account_id)) {
      skipped += 1;
      continue;
    }

    const debit = Number(row.debit_amount) || 0;
    const credit = Number(row.credit_amount) || 0;

    if (dryRun) {
      details.push(`would move ${row.entry_number}: ${parentCode} → ${leafCode}`);
      moved += 1;
      continue;
    }

    try {
      await db.query(`UPDATE journal_entry_lines SET account_id = $1 WHERE id = $2`, [
        leafId,
        row.line_id,
      ]);
      // Balances are rebuilt by fastRecompute after repair — skip fragile +/- here.
      details.push(`moved ${row.entry_number}: ${parentCode} → ${leafCode} (D${debit}/C${credit})`);
      moved += 1;
    } catch (e) {
      details.push(`error ${row.entry_number}: ${e.message}`);
      skipped += 1;
    }
  }

  return { moved, skipped, details };
}

/** One-shot on city: repair then mark schema_patches. */
async function ensureParentEntityCoaRepaired(db) {
  const patchId = '022_repair_parent_entity_coa';
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_patches (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (_) {
    try {
      if (db.sqlite) {
        db.sqlite.exec(`
          CREATE TABLE IF NOT EXISTS schema_patches (
            id TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
      }
    } catch (e2) {
      return { skipped: true, reason: e2.message };
    }
  }

  const already = await db.query('SELECT 1 AS ok FROM schema_patches WHERE id = $1 LIMIT 1', [patchId]);
  if (already.rows?.length) return { skipped: true, reason: 'already_applied' };

  const result = await repairParentEntityCoaPostings(db, { dryRun: false });
  await db.query('INSERT INTO schema_patches (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [patchId]);
  console.log(
    `[SCHEMA] Parent 321/311 COA repair: moved=${result.moved} skipped=${result.skipped}`,
  );
  return result;
}

module.exports = {
  repairParentEntityCoaPostings,
  ensureParentEntityCoaRepaired,
};
