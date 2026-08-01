/**
 * Move journal lines off parent 321/311 onto the correct 8-digit supplier/client leaf.
 *
 * City data often posted purchases/payments/PO receives to bare 321 — tree leaves
 * (ATLAS, etc.) stay at 0 while parent 321 holds the full balance.
 *
 * Resolution order per line:
 *  1. payments
 *  2. purchase_invoices
 *  3. purchase_orders
 *  4. open_items (by journal reference_id)
 *  5. stock_movements / products.supplier (adjustments)
 *  6. description / journal text matching leaf or entity name
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

function isLeafCode(code, parentCode) {
  const c = cleanText(code);
  if (!c || c === parentCode) return false;
  if (parentCode === '321') return /^321\d{5,}$/i.test(c);
  if (parentCode === '311') return /^311\d{5,}$/i.test(c);
  return c.startsWith(parentCode) && c.length > parentCode.length;
}

async function safeResolveEntity(client, entityType, entityId, entityName) {
  try {
    return await resolveEntityAccountCode(client, entityType, entityId, entityName);
  } catch (e) {
    console.warn('[COA REPAIR] resolveEntityAccountCode:', e.message);
    return null;
  }
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
       AND LOWER(COALESCE(je.reference_type, '')) IN (
         'payment', 'payment_out', 'payment_receipt', 'receipt'
       )
       AND LOWER(COALESCE(p.entity_type, '')) IN ('supplier', 'customer', 'client')
     LIMIT 1`,
    [journalEntryId],
  );
  const row = r.rows?.[0];
  if (!row) return null;
  const entityType = String(row.entity_type).toLowerCase() === 'client' ? 'customer' : row.entity_type;
  const code = await safeResolveEntity(
    client,
    entityType,
    row.entity_id,
    row.entity_name,
  );
  const parent = entityType === 'supplier' ? '321' : '311';
  return isLeafCode(code, parent) ? code : null;
}

async function resolveLeafFromPurchaseInvoice(client, journalEntryId) {
  const r = await client.query(
    `SELECT pi.supplier_id, pi.supplier_name, pi.supplier_account_code
     FROM journal_entries je
     INNER JOIN purchase_invoices pi ON CAST(pi.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND LOWER(COALESCE(je.reference_type, '')) IN ('purchase_invoice', 'purchase', 'fc')
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;
  const stored = cleanText(row.supplier_account_code);
  if (isLeafCode(stored, '321')) return stored;
  const code = await safeResolveEntity(
    client,
    'supplier',
    row.supplier_id,
    row.supplier_name,
  );
  return isLeafCode(code, '321') ? code : null;
}

async function resolveLeafFromPurchaseOrder(client, journalEntryId) {
  const r = await client.query(
    `SELECT po.supplier_id, po.supplier_name
     FROM journal_entries je
     INNER JOIN purchase_orders po ON CAST(po.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND LOWER(COALESCE(je.reference_type, '')) IN ('purchase', 'purchase_order', 'po')
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;
  const code = await safeResolveEntity(
    client,
    'supplier',
    row.supplier_id,
    row.supplier_name,
  );
  return isLeafCode(code, '321') ? code : null;
}

async function resolveLeafFromOpenItem(client, journalEntryId) {
  const r = await client.query(
    `SELECT oi.entity_type, oi.entity_id,
            COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(c.name), '')) AS entity_name
     FROM journal_entries je
     INNER JOIN open_items oi ON CAST(oi.document_id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN suppliers s
       ON LOWER(COALESCE(oi.entity_type, '')) = 'supplier'
      AND CAST(s.id AS TEXT) = CAST(oi.entity_id AS TEXT)
     LEFT JOIN clients c
       ON LOWER(COALESCE(oi.entity_type, '')) IN ('customer', 'client')
      AND CAST(c.id AS TEXT) = CAST(oi.entity_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND LOWER(COALESCE(oi.entity_type, '')) IN ('supplier', 'customer', 'client')
     ORDER BY oi.created_at DESC
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;
  const entityType = String(row.entity_type).toLowerCase() === 'client' ? 'customer' : row.entity_type;
  const code = await safeResolveEntity(
    client,
    entityType,
    row.entity_id,
    row.entity_name,
  );
  const parent = entityType === 'supplier' ? '321' : '311';
  return isLeafCode(code, parent) ? code : null;
}

async function resolveLeafFromStockMovement(client, journalEntryId) {
  // Adjustments / stock docs: find supplier via products on the movement.
  const r = await client.query(
    `SELECT DISTINCT
        COALESCE(NULLIF(TRIM(p.supplier_id), ''), NULL) AS supplier_id,
        COALESCE(NULLIF(TRIM(p.supplier_name), ''), NULLIF(TRIM(s.name), '')) AS supplier_name
     FROM journal_entries je
     INNER JOIN stock_movements sm
       ON CAST(sm.reference_id AS TEXT) = CAST(je.reference_id AS TEXT)
       OR CAST(sm.id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN products p ON CAST(p.id AS TEXT) = CAST(sm.product_id AS TEXT)
     LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(p.supplier_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND LOWER(COALESCE(je.reference_type, '')) IN (
         'adjustment', 'ajuste', 'stock_adjustment', 'purchase', 'transfer_in'
       )
       AND (
         NULLIF(TRIM(p.supplier_id), '') IS NOT NULL
         OR NULLIF(TRIM(p.supplier_name), '') IS NOT NULL
         OR NULLIF(TRIM(s.name), '') IS NOT NULL
       )
     LIMIT 5`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));

  for (const row of r.rows || []) {
    const code = await safeResolveEntity(
      client,
      'supplier',
      row.supplier_id,
      row.supplier_name,
    );
    if (isLeafCode(code, '321')) return code;
  }
  return null;
}

/**
 * Pull a plausible entity name out of journal/line text.
 * Examples: "Compra OC-001 - ATLAS", "Fornecedor NAVAL GENERAL...", "Pagamento ATLAS"
 */
function extractEntityHint(description) {
  const desc = cleanText(description);
  if (!desc || desc.length < 3) return null;

  const patterns = [
    /(?:fornecedor|supplier|cliente|customer|client)\s*[:\-]?\s*(.+)$/i,
    /(?:compra|purchase|pagamento|payment|recebimento|receipt|fc|oc)\s+[^\-–—]+[\-–—]\s*(.+)$/i,
    /(?:entrada\s+invent[aá]rio|stock\s+in)\s+[^\-–—]+[\-–—]\s*(.+)$/i,
  ];
  for (const re of patterns) {
    const m = desc.match(re);
    if (m?.[1]) {
      const hint = cleanText(m[1]).replace(/\s*\(.*?\)\s*$/, '').trim();
      if (hint.length >= 4 && !/^fornecedores?/i.test(hint)) return hint;
    }
  }
  // No unstructured whole-description fallback — that mis-matched leaves.
  return null;
}

async function resolveLeafFromDescription(client, parentCode, description) {
  const hint = extractEntityHint(description);
  if (!hint || hint.length < 4) return null;
  const group = parentCode === CLIENT_PARENT_CODE ? CLIENT_GROUP_CODE : SUPPLIER_GROUP_CODE;
  const parent = parentCode === CLIENT_PARENT_CODE ? CLIENT_PARENT_CODE : SUPPLIER_PARENT_CODE;

  // Only match EXISTING leaves — never create accounts during auto-repair.
  const r = await client.query(
    `SELECT code, name
     FROM chart_of_accounts
     WHERE code LIKE $1
       AND code <> $2
       AND LENGTH(code) > LENGTH($2)
       AND is_header = false
       AND is_active = true
       AND LENGTH(TRIM(name)) >= 4
       AND (
         LOWER($3) LIKE '%' || LOWER(TRIM(name)) || '%'
         OR LOWER(TRIM(name)) LIKE '%' || LOWER($3) || '%'
       )
     ORDER BY LENGTH(TRIM(name)) DESC
     LIMIT 1`,
    [`${group}%`, parent, hint],
  );
  if (r.rows?.[0]?.code) return r.rows[0].code;

  const table = parentCode === CLIENT_PARENT_CODE ? 'clients' : 'suppliers';
  const ent = await client.query(
    `SELECT id, name, nif FROM ${table}
     WHERE is_active = true
       AND LENGTH(TRIM(name)) >= 4
       AND LOWER($1) LIKE '%' || LOWER(TRIM(name)) || '%'
     ORDER BY LENGTH(TRIM(name)) DESC
     LIMIT 1`,
    [hint],
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
 * Load all journal lines still parked on parent 321/311 —
 * by UUID join OR by legacy code-keyed account_id.
 */
async function loadParentLines(db, parentIds) {
  const parentIdList = [...parentIds.values()].map(String);
  const byUuid = (
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

  // Legacy: account_id stored as the code string '321'/'311'
  const byCode = (
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
         CAST(jel.account_id AS TEXT) AS old_code
       FROM journal_entry_lines jel
       INNER JOIN journal_entries je ON CAST(je.id AS TEXT) = CAST(jel.journal_entry_id AS TEXT)
       WHERE CAST(jel.account_id AS TEXT) IN ('321', '311')
       ORDER BY je.entry_date, je.created_at`,
    ).catch(() => ({ rows: [] }))
  ).rows || [];

  const seen = new Set();
  const out = [];
  for (const row of [...byUuid, ...byCode]) {
    const key = String(row.line_id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  // Silence unused when parentIds empty path already returned
  void parentIdList;
  return out;
}

async function resolveLeafForLine(db, row) {
  const parentCode = row.old_code === '311' ? '311' : '321';
  let leafCode = await resolveLeafFromPayment(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromPurchaseInvoice(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromPurchaseOrder(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromOpenItem(db, row.journal_entry_id);
  if (!leafCode && parentCode === '321') {
    leafCode = await resolveLeafFromStockMovement(db, row.journal_entry_id);
  }
  if (!leafCode) {
    leafCode = await resolveLeafFromDescription(
      db,
      parentCode,
      [row.line_description, row.journal_description].filter(Boolean).join(' — '),
    );
  }
  return { parentCode, leafCode };
}

/**
 * @returns {{ moved: number, skipped: number, remaining: number, details: string[] }}
 */
async function repairParentEntityCoaPostings(db, opts = {}) {
  const dryRun = opts.dryRun === true;
  const parentIds = await loadParentIds(db);
  if (parentIds.size === 0) {
    return { moved: 0, skipped: 0, remaining: 0, details: ['no parent 321/311 accounts'] };
  }

  const lines = await loadParentLines(db, parentIds);
  let moved = 0;
  let skipped = 0;
  const details = [];

  for (const row of lines) {
    let parentCode = '321';
    let leafCode = null;
    try {
      ({ parentCode, leafCode } = await resolveLeafForLine(db, row));
    } catch (e) {
      details.push(`skip ${row.entry_number}: resolve failed (${e.message})`);
      skipped += 1;
      continue;
    }

    if (!leafCode || !isLeafCode(leafCode, parentCode)) {
      skipped += 1;
      details.push(
        `unresolved ${row.entry_number || row.line_id}: still on ${parentCode} (${row.reference_type || '?'})`,
      );
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
      details.push(`moved ${row.entry_number}: ${parentCode} → ${leafCode} (D${debit}/C${credit})`);
      moved += 1;
    } catch (e) {
      details.push(`error ${row.entry_number}: ${e.message}`);
      skipped += 1;
    }
  }

  const remaining = Math.max(0, lines.length - moved);
  return { moved, skipped, remaining, details };
}

async function countParentEntityLines(db) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM journal_entry_lines jel
     LEFT JOIN chart_of_accounts coa ON CAST(coa.id AS TEXT) = CAST(jel.account_id AS TEXT)
     WHERE CAST(coa.code AS TEXT) IN ('321', '311')
        OR CAST(jel.account_id AS TEXT) IN ('321', '311')`,
  ).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows?.[0]?.n) || 0;
}

/**
 * Always attempt repair on startup. Mark patch only when no parent lines remain
 * (or after a successful run that moved something). Re-runs if residual lines exist.
 */
async function ensureParentEntityCoaRepaired(db) {
  const patchId = '023_repair_parent_entity_coa_v2';
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

  const remainingBefore = await countParentEntityLines(db);
  if (remainingBefore === 0) {
    await db.query('INSERT INTO schema_patches (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [patchId]);
    return { skipped: true, reason: 'no_parent_lines', moved: 0, remaining: 0 };
  }

  const already = await db.query('SELECT 1 AS ok FROM schema_patches WHERE id = $1 LIMIT 1', [patchId]);
  // Still run if residual parent lines exist even after a prior "applied" mark.
  if (already.rows?.length && remainingBefore === 0) {
    return { skipped: true, reason: 'already_applied', remaining: 0 };
  }

  const result = await repairParentEntityCoaPostings(db, { dryRun: false });
  const remainingAfter = await countParentEntityLines(db);
  if (remainingAfter === 0) {
    await db.query('INSERT INTO schema_patches (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [patchId]);
  }
  console.log(
    `[SCHEMA] Parent 321/311 COA repair v2: moved=${result.moved} skipped=${result.skipped} remaining=${remainingAfter}`,
  );
  return { ...result, remaining: remainingAfter };
}

module.exports = {
  repairParentEntityCoaPostings,
  ensureParentEntityCoaRepaired,
  countParentEntityLines,
  isLeafCode,
};
