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
  ensureSupplierSubAccount,
  ensureClientSubAccount,
  SUPPLIER_PARENT_CODE,
  CLIENT_PARENT_CODE,
  SUPPLIER_GROUP_CODE,
  CLIENT_GROUP_CODE,
} = require('./entityCoaAccounts');

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Strip common company suffixes so "ATLAS LDA" matches leaf "ATLAS". */
function normalizeEntityName(value) {
  return cleanText(value)
    .replace(/[.,]/g, ' ')
    .replace(/\b(lda|ltda|sa|s\.a|sarl|llc|inc|co)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function namesLooselyMatch(a, b) {
  const na = normalizeEntityName(a);
  const nb = normalizeEntityName(b);
  if (!na || !nb || na.length < 3 || nb.length < 3) return false;
  if (na === nb) return true;
  if (na.length >= 5 && nb.includes(na)) return true;
  if (nb.length >= 5 && na.includes(nb)) return true;
  return false;
}

function isLeafCode(code, parentCode) {
  const c = cleanText(code);
  if (!c || c === parentCode) return false;
  if (parentCode === '321') return /^321\d{5,}$/i.test(c);
  if (parentCode === '311') return /^311\d{5,}$/i.test(c);
  return c.startsWith(parentCode) && c.length > parentCode.length;
}

/** Parent lines may store UUID or legacy PGC code in account_id. */
function parentAccountMatchSql(parentAlias = 'parent') {
  return `(
    CAST(jel.account_id AS TEXT) = CAST(${parentAlias}.id AS TEXT)
    OR CAST(jel.account_id AS TEXT) = CAST(${parentAlias}.code AS TEXT)
  )`;
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
    `SELECT p.entity_type, p.entity_id, p.entity_name,
            COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(c.name), '')) AS master_name
     FROM journal_entries je
     INNER JOIN payments p ON CAST(p.id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(p.entity_id AS TEXT)
     LEFT JOIN clients c ON CAST(c.id AS TEXT) = CAST(p.entity_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 1`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));
  const row = r.rows?.[0];
  if (!row) return null;

  let entityType = String(row.entity_type || '').toLowerCase();
  if (entityType === 'client') entityType = 'customer';
  if (!entityType || !['supplier', 'customer'].includes(entityType)) {
    if (row.master_name && row.entity_id) {
      // Infer from which master table matched
      const sup = await client.query(
        `SELECT 1 FROM suppliers WHERE CAST(id AS TEXT) = CAST($1 AS TEXT) LIMIT 1`,
        [row.entity_id],
      ).catch(() => ({ rows: [] }));
      entityType = sup.rows?.[0] ? 'supplier' : 'customer';
    } else {
      return null;
    }
  }

  const name = cleanText(row.master_name) || cleanText(row.entity_name);
  const code = await safeResolveEntity(client, entityType, row.entity_id, name);
  const parent = entityType === 'supplier' ? '321' : '311';
  if (isLeafCode(code, parent)) return code;

  // Fuzzy fallback onto an existing leaf by master/payment name
  if (name) {
    const fuzzy = await resolveLeafFromExistingName(client, parent, name);
    if (fuzzy) return fuzzy;
    try {
      const created = entityType === 'supplier'
        ? await ensureSupplierSubAccount(client, name, null)
        : await ensureClientSubAccount(client, name, null);
      if (isLeafCode(created, parent)) return created;
    } catch (_) { /* ignore */ }
  }
  return null;
}

/** Match "Pagamento PAG-2026-00655 - ATLAS" via payment_number in journal text. */
async function resolveLeafFromPaymentNumber(client, parentCode, description) {
  const desc = cleanText(description);
  if (!desc) return null;
  const tokens = desc.match(/\bPAG[- ]?\d{4}[- ]?\d+\b/gi) || [];
  for (const raw of tokens) {
    const num = raw.replace(/\s+/g, '').toUpperCase();
    const variants = [num, raw.trim(), num.replace(/^PAG/, 'PAG-')];
    for (const v of variants) {
      const r = await client.query(
        `SELECT p.entity_type, p.entity_id, p.entity_name,
                COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(c.name), '')) AS master_name
         FROM payments p
         LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(p.entity_id AS TEXT)
         LEFT JOIN clients c ON CAST(c.id AS TEXT) = CAST(p.entity_id AS TEXT)
         WHERE UPPER(REPLACE(TRIM(COALESCE(p.payment_number, '')), ' ', '')) = UPPER(REPLACE($1, ' ', ''))
            OR UPPER(TRIM(COALESCE(p.payment_number, ''))) = UPPER($1)
         LIMIT 1`,
        [v],
      ).catch(() => ({ rows: [] }));
      const row = r.rows?.[0];
      if (!row) continue;
      let entityType = String(row.entity_type || '').toLowerCase();
      if (entityType === 'client') entityType = 'customer';
      if (!['supplier', 'customer'].includes(entityType)) {
        entityType = parentCode === '311' ? 'customer' : 'supplier';
      }
      const name = cleanText(row.master_name) || cleanText(row.entity_name);
      const code = await safeResolveEntity(client, entityType, row.entity_id, name);
      const parent = entityType === 'supplier' ? '321' : '311';
      if (parent === parentCode && isLeafCode(code, parent)) return code;
    }
  }
  return null;
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
  const tokens = [
    ...(desc.match(/\b(?:FC|OC|PO|CP|FR|FT|PP)[-/\s]?\d[\w/-]*/gi) || []),
    // Stock Adjust In docs: MKFR26/3324, FT5326S44847N/3222, CDG2026/565
    ...(desc.match(/\b[A-Z]{0,6}\d[\w./-]{2,}\b/gi) || []),
  ];
  const seen = new Set();
  for (const raw of tokens) {
    const num = raw.replace(/\s+/g, '').toUpperCase();
    if (seen.has(num) || num.length < 4) continue;
    seen.add(num);
    const variants = [num, raw.trim(), num.replace(/^(FC|OC|FR|FT|PP)/, '$1-')];
    for (const v of variants) {
      const pi = await client.query(
        `SELECT supplier_id, supplier_name, supplier_account_code
         FROM purchase_invoices
         WHERE UPPER(REPLACE(TRIM(COALESCE(invoice_number, '')), ' ', '')) = UPPER(REPLACE($1, ' ', ''))
            OR UPPER(TRIM(COALESCE(invoice_number, ''))) = UPPER($1)
            OR UPPER(REPLACE(TRIM(COALESCE(invoice_number, '')), ' ', '')) LIKE '%' || UPPER(REPLACE($1, ' ', '')) || '%'
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
        COALESCE(
          NULLIF(TRIM(p.supplier_name), ''),
          NULLIF(TRIM(s.name), '')
        ) AS supplier_name
     FROM journal_entries je
     INNER JOIN stock_movements sm
       ON CAST(sm.reference_id AS TEXT) = CAST(je.reference_id AS TEXT)
       OR CAST(sm.id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN products p ON CAST(p.id AS TEXT) = CAST(sm.product_id AS TEXT)
     LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(p.supplier_id AS TEXT)
     WHERE CAST(je.id AS TEXT) = CAST($1 AS TEXT)
     LIMIT 20`,
    [journalEntryId],
  ).catch(() => ({ rows: [] }));

  for (const row of r.rows || []) {
    const name = cleanText(row.supplier_name);
    if (!row.supplier_id && !name) continue;
    const code = await safeResolveEntity(client, 'supplier', row.supplier_id, name);
    if (isLeafCode(code, '321')) return code;
  }
  return null;
}

/**
 * Match stock_movements by reference_number tokens from "Entrada inventário FR MKFR26/3324".
 */
async function resolveLeafFromStockReferenceNumber(client, description) {
  const desc = cleanText(description);
  if (!desc) return null;
  const tokens = [
    ...(desc.match(/\b(?:FR|FT|PP|FC|OC|PO)[-/\s]?\S+/gi) || []),
    ...(desc.match(/\b[A-Z]{0,6}\d[\w./-]{2,}\b/gi) || []),
  ]
    .map((t) => cleanText(t).replace(/^FR\s+/i, '').trim())
    .filter((t) => t.length >= 4);

  const seen = new Set();
  for (const token of tokens) {
    const key = token.toUpperCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);

    const r = await client.query(
      `SELECT DISTINCT
          COALESCE(NULLIF(TRIM(p.supplier_id), ''), NULL) AS supplier_id,
          COALESCE(NULLIF(TRIM(p.supplier_name), ''), NULLIF(TRIM(s.name), '')) AS supplier_name
       FROM stock_movements sm
       LEFT JOIN products p ON CAST(p.id AS TEXT) = CAST(sm.product_id AS TEXT)
       LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(p.supplier_id AS TEXT)
       WHERE UPPER(REPLACE(TRIM(COALESCE(sm.reference_number, '')), ' ', '')) LIKE '%' || $1 || '%'
          OR UPPER(TRIM(COALESCE(sm.reference_number, ''))) = UPPER($2)
       LIMIT 12`,
      [key, token],
    ).catch(() => ({ rows: [] }));

    for (const row of r.rows || []) {
      if (!row.supplier_id && !cleanText(row.supplier_name)) continue;
      const code = await safeResolveEntity(client, 'supplier', row.supplier_id, row.supplier_name);
      if (isLeafCode(code, '321')) return code;
    }
  }
  return null;
}

const CLASSIFY_LEAF_NAMES = {
  '321': 'Fornecedores - por classificar',
  '311': 'Clientes - por classificar',
};

/** Last-resort leaf so parent 321/311 never keeps residual postings. */
async function ensureClassifyLeaf(client, parentCode) {
  const name = CLASSIFY_LEAF_NAMES[parentCode] || `Por classificar (${parentCode})`;
  try {
    if (parentCode === '321') {
      const code = await ensureSupplierSubAccount(client, name, null);
      return isLeafCode(code, '321') ? code : null;
    }
    if (parentCode === '311') {
      const code = await ensureClientSubAccount(client, name, null);
      return isLeafCode(code, '311') ? code : null;
    }
  } catch (e) {
    console.warn('[COA REPAIR] ensureClassifyLeaf:', e.message);
  }
  return null;
}

/**
 * Match EXISTING leaf names inside the full journal/line text.
 * Prefer longest name (≥5 chars) to avoid matching "LDA" / "COM".
 */
async function resolveLeafFromExistingName(client, parentCode, description) {
  const desc = cleanText(description);
  if (!desc || desc.length < 3) return null;
  const group = parentCode === CLIENT_PARENT_CODE ? CLIENT_GROUP_CODE : SUPPLIER_GROUP_CODE;
  const parent = parentCode === CLIENT_PARENT_CODE ? CLIENT_PARENT_CODE : SUPPLIER_PARENT_CODE;
  const descNorm = normalizeEntityName(desc);

  const r = await client.query(
    `SELECT code, name
     FROM chart_of_accounts
     WHERE code LIKE $1
       AND code <> $2
       AND LENGTH(code) > LENGTH($2)
       AND is_header = false
       AND is_active = true
       AND LENGTH(TRIM(name)) >= 3
       AND (
         LOWER($3) LIKE '%' || LOWER(TRIM(name)) || '%'
         OR LOWER(TRIM(name)) LIKE '%' || LOWER($3) || '%'
       )
     ORDER BY LENGTH(TRIM(name)) DESC
     LIMIT 25`,
    [`${group}%`, parent, desc],
  );
  // Prefer longest exact/loose match (avoid short false hits like "COM")
  let best = null;
  let bestLen = 0;
  for (const row of r.rows || []) {
    const name = cleanText(row.name);
    if (name.length < 4 && !desc.toLowerCase().includes(name.toLowerCase())) continue;
    if (namesLooselyMatch(desc, name) || desc.toLowerCase().includes(name.toLowerCase())) {
      if (name.length > bestLen) {
        best = row.code;
        bestLen = name.length;
      }
    }
  }
  if (best) return best;

  // Normalized scan when SQL LIKE missed suffix differences
  const allLeaves = await client.query(
    `SELECT code, name FROM chart_of_accounts
     WHERE code LIKE $1 AND code <> $2 AND LENGTH(code) > LENGTH($2)
       AND is_header = false AND is_active = true AND LENGTH(TRIM(name)) >= 4`,
    [`${group}%`, parent],
  ).catch(() => ({ rows: [] }));
  for (const row of allLeaves.rows || []) {
    const nn = normalizeEntityName(row.name);
    if (!nn || nn.length < 4) continue;
    if (descNorm === nn || descNorm.includes(nn) || nn.includes(descNorm)) {
      if (nn.length > bestLen) {
        best = row.code;
        bestLen = nn.length;
      }
    }
  }
  if (best) return best;

  const table = parentCode === CLIENT_PARENT_CODE ? 'clients' : 'suppliers';
  const ent = await client.query(
    `SELECT id, name, nif FROM ${table}
     WHERE is_active = true
       AND LENGTH(TRIM(name)) >= 4
       AND (
         LOWER($1) LIKE '%' || LOWER(TRIM(name)) || '%'
         OR LOWER(TRIM(name)) LIKE '%' || LOWER($1) || '%'
       )
     ORDER BY LENGTH(TRIM(name)) DESC
     LIMIT 8`,
    [desc],
  ).catch(() => ({ rows: [] }));
  for (const e of ent.rows || []) {
    if (!namesLooselyMatch(desc, e.name) && !desc.toLowerCase().includes(cleanText(e.name).toLowerCase())) {
      continue;
    }
    const code = await findEntityLeafCode(client, group, parent, e.name, e.nif);
    if (code) return code;
    try {
      const created = parentCode === '311'
        ? await ensureClientSubAccount(client, e.name, e.nif)
        : await ensureSupplierSubAccount(client, e.name, e.nif);
      if (isLeafCode(created, parentCode)) return created;
    } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * Stock Adjust In journals: "Entrada inventário FR MKFR26/2816 MERHAT"
 * → supplier hint "MERHAT" (strip doc type + number tokens).
 */
function extractStockEntrySupplierHint(description) {
  const desc = cleanText(description);
  // May appear after a line-description prefix ("… — Entrada inventário …")
  const m = desc.match(/entrada\s+invent[aá]rio\s+(.+)$/i);
  if (!m) return null;
  let rest = m[1].trim();
  // Drop leading type tokens (may repeat: FT FT5326…)
  for (let i = 0; i < 3; i += 1) {
    const next = rest.replace(/^(FR|PP|FT|FC|OC|PO|AJ|GR)\s+/i, '').trim();
    if (next === rest) break;
    rest = next;
  }
  // Drop document number token(s) that contain digits
  for (let i = 0; i < 2; i += 1) {
    const next = rest.replace(/^\S*\d\S*(?:\s+|$)/, '').trim();
    if (next === rest) break;
    rest = next;
  }
  if (rest.length >= 3 && !/^(entrada|fornecedor|invent)/i.test(rest)) return rest;
  return null;
}

function extractEntityHint(description) {
  const desc = cleanText(description);
  if (!desc || desc.length < 3) return null;

  const stockHint = extractStockEntrySupplierHint(desc);
  if (stockHint) return stockHint;

  const patterns = [
    /(?:fornecedor|supplier|cliente|customer|client)\s*[:\-]?\s*(.+)$/i,
    /(?:compra|purchase|pagamento|payment|recebimento|receipt|fc|oc)\s+[^\-–—]+[\-–—]\s*(.+)$/i,
    /(?:entrada\s+invent[aá]rio|stock\s+in)\s+[^\-–—]+[\-–—]\s*(.+)$/i,
    /^(.+?)\s*[\-–—]\s*(.+)$/,
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

  // 2) Patterned / stock-entry hint
  const hint = extractEntityHint(full);
  if (!hint) return null;

  const byHint = await resolveLeafFromExistingName(client, parentCode, hint);
  if (byHint) return byHint;

  // 3) Create leaf when we have a usable entity hint (stock Adjust In or other)
  if (parentCode === '321' && hint) {
    try {
      const created = await ensureSupplierSubAccount(client, hint, null);
      if (isLeafCode(created, '321')) return created;
    } catch (e) {
      console.warn('[COA REPAIR] ensureSupplierSubAccount:', e.message);
    }
  }
  if (parentCode === '311' && hint) {
    try {
      const created = await ensureClientSubAccount(client, hint, null);
      if (isLeafCode(created, '311')) return created;
    } catch (_) { /* ignore */ }
  }
  return null;
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
  if (!leafCode) leafCode = await resolveLeafFromPaymentNumber(db, parentCode, text);
  if (!leafCode) leafCode = await resolveLeafFromPurchaseInvoice(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromPurchaseOrder(db, row.journal_entry_id);
  if (!leafCode) leafCode = await resolveLeafFromOpenItem(db, row.journal_entry_id);
  if (!leafCode && parentCode === '321') {
    leafCode = await resolveLeafFromStockMovement(db, row.journal_entry_id);
  }
  if (!leafCode && parentCode === '321') {
    leafCode = await resolveLeafFromStockReferenceNumber(db, text);
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
  // Postgres: target table "jel" must not appear in FROM joins — only in WHERE.
  const parentMatch = parentAccountMatchSql('parent');
  const statements = [
    // PO → supplier leaf (exact or supplier master)
    `UPDATE journal_entry_lines AS jel
     SET account_id = leaf.id
     FROM journal_entries je
     INNER JOIN purchase_orders po ON CAST(po.id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(po.supplier_id AS TEXT)
     INNER JOIN chart_of_accounts parent ON parent.code = '321'
     INNER JOIN chart_of_accounts leaf
       ON leaf.is_active = true AND leaf.is_header = false
      AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3
      AND (
        LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(po.supplier_name), ''), '')))
        OR LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(s.name), ''), '')))
      )
     WHERE CAST(jel.journal_entry_id AS TEXT) = CAST(je.id AS TEXT)
       AND ${parentMatch}
       AND (
         NULLIF(TRIM(po.supplier_name), '') IS NOT NULL
         OR NULLIF(TRIM(s.name), '') IS NOT NULL
       )`,
    // PI → supplier leaf (code, invoice name, or supplier master)
    `UPDATE journal_entry_lines AS jel
     SET account_id = leaf.id
     FROM journal_entries je
     INNER JOIN purchase_invoices pi ON CAST(pi.id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN suppliers s ON CAST(s.id AS TEXT) = CAST(pi.supplier_id AS TEXT)
     INNER JOIN chart_of_accounts parent ON parent.code = '321'
     INNER JOIN chart_of_accounts leaf
       ON leaf.is_active = true AND leaf.is_header = false
      AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3
      AND (
        (NULLIF(TRIM(pi.supplier_account_code), '') IS NOT NULL
          AND leaf.code = TRIM(pi.supplier_account_code))
        OR LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(pi.supplier_name, '')))
        OR LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(s.name, '')))
      )
     WHERE CAST(jel.journal_entry_id AS TEXT) = CAST(je.id AS TEXT)
       AND ${parentMatch}`,
    // Payments → leaf via entity_name or suppliers/clients master
    `UPDATE journal_entry_lines AS jel
     SET account_id = leaf.id
     FROM journal_entries je
     INNER JOIN payments p ON CAST(p.id AS TEXT) = CAST(je.reference_id AS TEXT)
     LEFT JOIN suppliers s
       ON LOWER(COALESCE(p.entity_type, '')) = 'supplier'
      AND CAST(s.id AS TEXT) = CAST(p.entity_id AS TEXT)
     LEFT JOIN clients c
       ON LOWER(COALESCE(p.entity_type, '')) IN ('customer', 'client')
      AND CAST(c.id AS TEXT) = CAST(p.entity_id AS TEXT)
     INNER JOIN chart_of_accounts parent ON parent.code IN ('321', '311')
     INNER JOIN chart_of_accounts leaf
       ON leaf.is_active = true AND leaf.is_header = false
      AND (
        (parent.code = '321' AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3)
        OR (parent.code = '311' AND leaf.code LIKE '311%' AND LENGTH(leaf.code) > 3)
      )
      AND (
        LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(p.entity_name), ''), '')))
        OR LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(s.name), ''), '')))
        OR LOWER(TRIM(leaf.name)) = LOWER(TRIM(COALESCE(NULLIF(TRIM(c.name), ''), '')))
      )
     WHERE CAST(jel.journal_entry_id AS TEXT) = CAST(je.id AS TEXT)
       AND ${parentMatch}
       AND (
         NULLIF(TRIM(p.entity_name), '') IS NOT NULL
         OR NULLIF(TRIM(s.name), '') IS NOT NULL
         OR NULLIF(TRIM(c.name), '') IS NOT NULL
       )`,
    // Leaf name appears in journal/line description (longest name wins via DISTINCT ON)
    `UPDATE journal_entry_lines AS jel
     SET account_id = matched.leaf_id
     FROM (
       SELECT DISTINCT ON (jel2.id)
              jel2.id AS line_id,
              leaf.id AS leaf_id
       FROM journal_entry_lines jel2
       INNER JOIN journal_entries je ON CAST(je.id AS TEXT) = CAST(jel2.journal_entry_id AS TEXT)
       INNER JOIN chart_of_accounts parent ON parent.code IN ('321', '311')
       INNER JOIN chart_of_accounts leaf
         ON leaf.is_active = true AND leaf.is_header = false
        AND (
          (parent.code = '321' AND leaf.code LIKE '321%' AND LENGTH(leaf.code) > 3)
          OR (parent.code = '311' AND leaf.code LIKE '311%' AND LENGTH(leaf.code) > 3)
        )
        AND LENGTH(TRIM(leaf.name)) >= 5
        AND (
          LOWER(COALESCE(je.description, '')) LIKE '%' || LOWER(TRIM(leaf.name)) || '%'
          OR LOWER(COALESCE(jel2.description, '')) LIKE '%' || LOWER(TRIM(leaf.name)) || '%'
        )
       WHERE (
         CAST(jel2.account_id AS TEXT) = CAST(parent.id AS TEXT)
         OR CAST(jel2.account_id AS TEXT) = CAST(parent.code AS TEXT)
       )
       ORDER BY jel2.id, LENGTH(TRIM(leaf.name)) DESC
     ) matched
     WHERE jel.id = matched.line_id`,
  ];

  for (const sql of statements) {
    try {
      const r = await db.query(sql);
      const n = Number(r.rowCount || r.changes || 0);
      total += n;
      if (n > 0) console.log(`[COA REPAIR] bulk remap +${n}`);
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
  const classifyOrphans = opts.classifyOrphans !== false;
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

    let viaClassify = false;
    if (!leafCode || !isLeafCode(leafCode, parentCode)) {
      if (classifyOrphans) {
        if (dryRun) {
          details.push(
            `would classify ${row.entry_number || row.line_id}: ${parentCode} → “${CLASSIFY_LEAF_NAMES[parentCode] || 'por classificar'}”`,
          );
          moved += 1;
          continue;
        }
        leafCode = await ensureClassifyLeaf(db, parentCode);
        viaClassify = !!leafCode;
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
      details.push(
        `moved ${row.entry_number}: ${parentCode} → ${leafCode}${viaClassify ? ' (por classificar)' : ''} (D${debit}/C${credit})`,
      );
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
  const patchId = '027_repair_parent_entity_coa_v6';
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
    `[SCHEMA] Parent 321/311 COA repair v6: moved=${result.moved} bulk=${result.bulkMoved || 0} skipped=${result.skipped} remaining=${remainingAfter}`,
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
