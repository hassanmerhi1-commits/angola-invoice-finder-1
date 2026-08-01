/**
 * Move journal lines off parent 321/311 onto the correct 8-digit supplier/client leaf.
 *
 * City symptom: parent 321 holds ~100M+ while leaves (ATLAS, …) stay at 0 because
 * historical posts used bare 321. Repair must resolve entity from ANY linked document
 * (ignore reference_type mismatches) and from existing leaf names in the journal text.
 *
 * Never creates new COA leaves during auto-repair (avoids misallocation).
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

/** Join payment by reference_id — ignore reference_type (city data often mismatches). */
async function resolveLeafFromPayment(client, journalEntryId) {
  const r = await client.query(
    `SELECT p.entity_type, p.entity_id, p.entity_name
     FROM journal_entries je
     INNER JOIN payments p ON CAST(p.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
       AND LOWER(COALESCE(p.entity_type, '')) IN ('supplier', 'customer', 'client')
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;
  const entityType = String(row.entity_type).toLowerCase() === 'client' ? 'customer' : row.entity_type;
  const code = await safeResolveEntity(client, entityType, row.entity_id, row.entity_name);
  const parent = entityType === 'supplier' ? '321' : '311';
  return isLeafCode(code, parent) ? code : null;
}

async function resolveLeafFromPurchaseInvoice(client, journalEntryId) {
  const r = await client.query(
    `SELECT pi.supplier_id, pi.supplier_name, pi.supplier_account_code
     FROM journal_entries je
     INNER JOIN purchase_invoices pi ON CAST(pi.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;
  const stored = cleanText(row.supplier_account_code);
  if (isLeafCode(stored, '321')) return stored;
  const code = await safeResolveEntity(client, 'supplier', row.supplier_id, row.supplier_name);
  return isLeafCode(code, '321') ? code : null;
}

async function resolveLeafFromPurchaseOrder(client, journalEntryId) {
  const r = await client.query(
    `SELECT po.supplier_id, po.supplier_name
     FROM journal_entries je
     INNER JOIN purchase_orders po ON CAST(po.id AS TEXT) = CAST(je.reference_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;
  const code = await safeResolveEntity(client, 'supplier', row.supplier_id, row.supplier_name);
  return isLeafCode(code, '321') ? code : null;
}

/** Also match PI / PO by document number found in journal text. */
async function resolveLeafFromDocumentNumber(client, parentCode, description) {
  const desc = cleanText(description);
  if (!desc || parentCode !== '321') return null;
  const tokens = desc.match(/\b(?:FC|OC|PO|CP)[-/\s]?\d[\w/-]*/gi) || [];
  for (const raw of tokens) {
    const num = raw.replace(/\s+/g, '').toUpperCase();
    const variants = [num, raw.trim(), num.replace(/^FC/, 'FC-').replace(/^OC/, 'OC-')];
    for (const v of variants) {
      const pi = await client.query(
        `SELECT supplier_id, supplier_name, supplier_account_code
         FROM purchase_invoices
         WHERE UPPER(REPLACE(TRIM(COALESCE(invoice_number, '')), ' ', '')) = UPPER(REPLACE($1, ' ', ''))
            OR UPPER(TRIM(COALESCE(invoice_number, ''))) = UPPER($1)
         LIMIT 1`,
        [v],
      ).catch(() => ({ rows: [] }));
      if (pi.rows?.[0]) {
        const stored = cleanText(pi.rows[0].supplier_account_code);
        if (isLeafCode(stored, '321')) return stored;
        const code = await safeResolveEntity(
          client,
          'supplier',
          pi.rows[0].supplier_id,
          pi.rows[0].supplier_name,
        );
        if (isLeafCode(code, '321')) return code;
      }
      const po = await client.query(
        `SELECT supplier_id, supplier_name
         FROM purchase_orders
         WHERE UPPER(REPLACE(TRIM(COALESCE(order_number, '')), ' ', '')) = UPPER(REPLACE($1, ' ', ''))
            OR UPPER(TRIM(COALESCE(order_number, ''))) = UPPER($1)
         LIMIT 1`,
        [v],
      ).catch(() => ({ rows: [] }));
      if (po.rows?.[0]) {
        const code = await safeResolveEntity(
          client,
          'supplier',
          po.rows[0].supplier_id,
          po.rows[0].supplier_name,
        );
        if (isLeafCode(code, '321')) return code;
      }
    }
  }
  return null;
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
  const code = await safeResolveEntity(client, entityType, row.entity_id, row.entity_name);
  const parent = entityType === 'supplier' ? '321' : '311';
  return isLeafCode(code, parent) ? code : null;
}

async function resolveLeafFromStockMovement(client, journalEntryId) {
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
       AND (
         NULLIF(TRIM(p.supplier_id), '') IS NOT NULL
         OR NULLIF(TRIM(p.supplier_name), '') IS NOT NULL
         OR NULLIF(TRIM(s.name), '') IS NOT NULL
       )
     LIMIT 8`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));

  for (const row of r.rows || []) {
    const code = await safeResolveEntity(client, 'supplier', row.supplier_id, row.supplier_name);
    if (isLeafCode(code, '321')) return code;
  }
  return null;
}

/**
 * Match EXISTING leaf names inside the full journal/line text.
 * Prefer longest name (≥5 chars) to avoid matching "LDA" / "COM".
 */
async function resolveLeafFromExistingName(client, parentCode, description) {
  const desc = cleanText(description);
  if (!desc || desc.length < 5) return null;
  const group = parentCode === CLIENT_PARENT_CODE ? CLIENT_GROUP_CODE : SUPPLIER_GROUP_CODE;
  const parent = parentCode === CLIENT_PARENT_CODE ? CLIENT_PARENT_CODE : SUPPLIER_PARENT_CODE;

  const r = await client.query(
    `SELECT code, name
     FROM chart_of_accounts
     WHERE code LIKE $1
       AND code <> $2
       AND LENGTH(code) > LENGTH($2)
       AND is_header = false
       AND is_active = true
       AND LENGTH(TRIM(name)) >= 5
       AND LOWER($3) LIKE '%' || LOWER(TRIM(name)) || '%'
     ORDER BY LENGTH(TRIM(name)) DESC
     LIMIT 1`,
    [`${group}%`, parent, desc],
  );
  if (r.rows?.[0]?.code) return r.rows[0].code;

  const table = parentCode === CLIENT_PARENT_CODE ? 'clients' : 'suppliers';
  const ent = await client.query(
    `SELECT id, name, nif FROM ${table}
     WHERE is_active = true
       AND LENGTH(TRIM(name)) >= 5
       AND LOWER($1) LIKE '%' || LOWER(TRIM(name)) || '%'
     ORDER BY LENGTH(TRIM(name)) DESC
     LIMIT 1`,
    [desc],
  ).catch(() => ({ rows: [] }));
  const e = ent.rows?.[0];
  if (!e) return null;
  return findEntityLeafCode(client, group, parent, e.name, e.nif);
}

function extractEntityHint(description) {
  const desc = cleanText(description);
  if (!desc || desc.length < 3) return null;
  const patterns = [
    /(?:fornecedor|supplier|cliente|customer|client)\s*[:\-]?\s*(.+)$/i,
    /(?:compra|purchase|pagamento|payment|recebimento|receipt|fc|oc)\s+[^\-–—]+[\-–—]\s*(.+)$/i,
    /(?:entrada\s+invent[aá]rio|stock\s+in)\s+[^\-–—]+[\-–—]\s*(.+)$/i,
    /^(.+?)\s*[\-–—]\s*(.+)$/, // generic "DOC - NAME" → take right side if long enough
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const m = desc.match(patterns[i]);
    if (!m) continue;
    const hint = cleanText(i === 3 ? m[2] : m[1]).replace(/\s*\(.*?\)\s*$/, '').trim();
    if (hint.length >= 4 && !/^fornecedores?/i.test(hint) && !/entrada\s+directa/i.test(hint)) {
      return hint;
    }
  }
  return null;
}

async function resolveLeafFromDescription(client, parentCode, description) {
  const full = cleanText(description);
  // 1) Existing leaf / supplier name anywhere in text
  const byName = await resolveLeafFromExistingName(client, parentCode, full);
  if (byName) return byName;

  // 2) Patterned hint → existing leaf only
  const hint = extractEntityHint(full);
  if (!hint) return null;
  return resolveLeafFromExistingName(client, parentCode, hint);
}

async function accountIdForCode(client, code) {
  const r = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
    [code],
  );
  return r.rows?.[0]?.id || null;
}

async function loadParentLines(db) {
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
         je.reference_id,
         je.entry_number,
         coa.code AS old_code
       FROM journal_entry_lines jel
       INNER JOIN journal_entries je ON CAST(je.id AS TEXT) = CAST(jel.journal_entry_id AS TEXT)
       INNER JOIN chart_of_accounts coa ON CAST(coa.id AS TEXT) = CAST(jel.account_id AS TEXT)
       WHERE CAST(coa.code AS TEXT) IN ('321', '311')
       ORDER BY je.entry_date, je.created_at`,
    )
  ).rows || [];

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
         je.reference_id,
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
  return out;
}

async function resolveLeafForLine(db, row) {
  const parentCode = row.old_code === '311' ? '311' : '321';
  const text = [row.line_description, row.journal_description].filter(Boolean).join(' — ');

  let leafCode = await resolveLeafFromPayment(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromPurchaseInvoice(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromPurchaseOrder(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromOpenItem(db, row.journal_entry_id);
  if (!leafCode && parentCode === '321') {
    leafCode = await resolveLeafFromStockMovement(db, row.journal_entry_id);
  }
  if (!leafCode) leafCode = await resolveLeafFromDocumentNumber(db, parentCode, text);
  if (!leafCode) leafCode = await resolveLeafFromDescription(db, parentCode, text);
  return { parentCode, leafCode };
}

/**
 * Fast bulk remaps via SQL for the common city cases (PO / PI / payments by id).
 * Returns number of rows updated.
 */
async function bulkRemapByDocumentJoin(db) {
  let total = 0;
  const statements = [
    // Purchase orders → supplier leaf
    `UPDATE journal_entry_lines jel
     SET account_id = leaf.id
     FROM journal_entries je
     INNER JOIN purchase_orders po ON CAST(po.id AS TEXT) = CAST(je.reference_id AS TEXT)
     INNER JOIN chart_of_accounts parent
       ON CAST(parent.id AS TEXT) = CAST(jel.account_id AS TEXT) AND parent.code = '321'
     INNER JOIN chart_of_accounts leaf
       ON leaf.is_active = true AND leaf.is_header = false
      AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3
      AND LOWER(TRIM(leaf.name)) = LOWER(TRIM(po.supplier_name))
     WHERE CAST(jel.journal_entry_id AS TEXT) = CAST(je.id AS TEXT)
       AND NULLIF(TRIM(po.supplier_name), '') IS NOT NULL`,
    // Purchase invoices → supplier leaf (by name)
    `UPDATE journal_entry_lines jel
     SET account_id = leaf.id
     FROM journal_entries je
     INNER JOIN purchase_invoices pi ON CAST(pi.id AS TEXT) = CAST(je.reference_id AS TEXT)
     INNER JOIN chart_of_accounts parent
       ON CAST(parent.id AS TEXT) = CAST(jel.account_id AS TEXT) AND parent.code = '321'
     INNER JOIN chart_of_accounts leaf
       ON leaf.is_active = true AND leaf.is_header = false
      AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3
      AND (
        (NULLIF(TRIM(pi.supplier_account_code), '') IS NOT NULL
          AND leaf.code = TRIM(pi.supplier_account_code))
        OR LOWER(TRIM(leaf.name)) = LOWER(TRIM(pi.supplier_name))
      )
     WHERE CAST(jel.journal_entry_id AS TEXT) = CAST(je.id AS TEXT)`,
    // Payments → supplier/customer leaf
    `UPDATE journal_entry_lines jel
     SET account_id = leaf.id
     FROM journal_entries je
     INNER JOIN payments p ON CAST(p.id AS TEXT) = CAST(je.reference_id AS TEXT)
     INNER JOIN chart_of_accounts parent
       ON CAST(parent.id AS TEXT) = CAST(jel.account_id AS TEXT)
      AND parent.code IN ('321', '311')
     INNER JOIN chart_of_accounts leaf
       ON leaf.is_active = true AND leaf.is_header = false
      AND (
        (parent.code = '321' AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3)
        OR (parent.code = '311' AND leaf.code LIKE '311%' AND LENGTH(leaf.code) > 3)
      )
      AND LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(p.entity_name), ''), '')))
     WHERE CAST(jel.journal_entry_id AS TEXT) = CAST(je.id AS TEXT)
       AND NULLIF(TRIM(p.entity_name), '') IS NOT NULL
       AND LOWER(COALESCE(p.entity_type, '')) IN ('supplier', 'customer', 'client')`,
  ];

  for (const sql of statements) {
    try {
      const r = await db.query(sql);
      const n = Number(r.rowCount || r.changes || 0);
      total += n;
    } catch (e) {
      console.warn('[COA REPAIR] bulk remap skipped:', e.message);
    }
  }
  return total;
}

/**
 * @returns {{ moved: number, skipped: number, remaining: number, bulkMoved: number, details: string[] }}
 */
async function repairParentEntityCoaPostings(db, opts = {}) {
  const dryRun = opts.dryRun === true;
  const parentIds = await loadParentIds(db);
  if (parentIds.size === 0) {
    return { moved: 0, skipped: 0, remaining: 0, bulkMoved: 0, details: ['no parent 321/311 accounts'] };
  }

  let bulkMoved = 0;
  if (!dryRun) {
    bulkMoved = await bulkRemapByDocumentJoin(db);
  }

  const lines = await loadParentLines(db);
  let moved = 0;
  let skipped = 0;
  const details = [];
  if (bulkMoved > 0) details.push(`bulk SQL remapped ${bulkMoved} line(s)`);

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
      if (details.length < 40) {
        details.push(
          `unresolved ${row.entry_number || row.line_id}: ${parentCode} ref=${row.reference_type || '?'} “${cleanText(row.journal_description || row.line_description).slice(0, 60)}”`,
        );
      }
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

  const remaining = await countParentEntityLines(db);
  return { moved: moved + bulkMoved, skipped, remaining, bulkMoved, details };
}

async function countParentEntityLines(db) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
     FROM journal_entry_lines jel
     LEFT JOIN chart_of_accounts coa ON CAST(coa.id AS TEXT) = CAST(jel.account_id AS TEXT)
     WHERE CAST(coa.code AS TEXT) IN ('321', '311')
        OR CAST(jel.account_id AS TEXT) IN ('321', '311')`,
  ).catch(async () => {
    // SQLite may not like ::int
    const r2 = await db.query(
      `SELECT COUNT(*) AS n
       FROM journal_entry_lines jel
       LEFT JOIN chart_of_accounts coa ON CAST(coa.id AS TEXT) = CAST(jel.account_id AS TEXT)
       WHERE CAST(coa.code AS TEXT) IN ('321', '311')
          OR CAST(jel.account_id AS TEXT) IN ('321', '311')`,
    ).catch(() => ({ rows: [{ n: 0 }] }));
    return r2;
  });
  return Number(r.rows?.[0]?.n) || 0;
}

/**
 * Always attempt repair while residual parent lines exist.
 * Patch 024 marks “attempted”; residual keeps re-running each startup / CoA open.
 */
async function ensureParentEntityCoaRepaired(db) {
  const patchId = '024_repair_parent_entity_coa_v3';
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

  const result = await repairParentEntityCoaPostings(db, { dryRun: false });
  const remainingAfter = await countParentEntityLines(db);
  if (remainingAfter === 0) {
    await db.query('INSERT INTO schema_patches (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [patchId]);
  } else {
    console.warn(
      `[SCHEMA] Parent 321/311 still has ${remainingAfter} line(s) after repair — check journal descriptions / supplier names`,
    );
  }
  console.log(
    `[SCHEMA] Parent 321/311 COA repair v3: moved=${result.moved} bulk=${result.bulkMoved || 0} skipped=${result.skipped} remaining=${remainingAfter}`,
  );
  return { ...result, remaining: remainingAfter };
}

module.exports = {
  repairParentEntityCoaPostings,
  ensureParentEntityCoaRepaired,
  countParentEntityLines,
  isLeafCode,
  bulkRemapByDocumentJoin,
};
