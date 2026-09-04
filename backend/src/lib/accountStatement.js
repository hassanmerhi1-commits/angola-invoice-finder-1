/**
 * Customer / supplier extracto.
 * Keep lookups on indexed id columns. CAST/TRIM on UUID columns cannot use
 * Postgres indexes and made the customers tab scan every sale for every client.
 */

const PLACEHOLDER_NIFS = new Set([
  '000000000',
  '0000000000',
  '111111111',
  '1111111111',
  '999999999',
  '9999999999',
]);

const GENERIC_PARTY_NAMES = new Set([
  'consumidor final',
  'cliente',
  'cliente final',
  'walk-in',
  'walk in',
  'final test',
  'consumidor',
  'fornecedor',
  'supplier',
]);

function isPg(db) {
  return db?.engine === 'postgres';
}

function normalizeParty(entityType) {
  const raw = String(entityType || '').trim().toLowerCase();
  if (raw === 'supplier' || raw === 'fornecedor') return 'supplier';
  return 'customer';
}

function isPlaceholderNif(nif) {
  const n = String(nif || '').replace(/\s/g, '');
  if (!n) return true;
  if (/^(.)\1+$/.test(n)) return true;
  return PLACEHOLDER_NIFS.has(n);
}

function isGenericPartyName(name) {
  return GENERIC_PARTY_NAMES.has(String(name || '').trim().toLowerCase().replace(/\s+/g, ' '));
}

function usablePartyName(name) {
  const n = String(name || '').trim();
  return n.length >= 4 && !isGenericPartyName(n);
}

function asText(db, expr) {
  return isPg(db) ? `${expr}::text` : `CAST(${expr} AS TEXT)`;
}

/** Indexed equality for UUID/text id columns. Never TRIM/CAST a UUID. */
function idEq(db, column, param = '$1') {
  if (isPg(db)) return `${column} = ${param}::uuid`;
  return `${column} = ${param}`;
}

function customerTypeSql(column = 'entity_type') {
  return `${column} IN ('customer', 'client')`;
}

function supplierTypeSql(column = 'entity_type') {
  return `${column} = 'supplier'`;
}

function notVoidedSql(column) {
  return `LOWER(COALESCE(${column}, '')) NOT IN ('voided', 'cancelled', 'canceled')`;
}

function notDraftSql(column) {
  return `LOWER(COALESCE(${column}, '')) NOT IN ('draft', 'voided', 'cancelled', 'canceled')`;
}

function hasLinkedIdSql(db, column) {
  if (isPg(db)) return `${column} IS NOT NULL`;
  return `TRIM(COALESCE(${column}, '')) <> ''`;
}

function missingLinkedIdSql(db, column) {
  if (isPg(db)) return `${column} IS NULL`;
  return `TRIM(COALESCE(${column}, '')) = ''`;
}

function keepListedParty(row) {
  const balance = Number(row?.balance || 0);
  if (Math.abs(balance) > 0.005) return true;
  if (isGenericPartyName(row?.name) && isPlaceholderNif(row?.nif)) return false;
  return true;
}

function mapPartyRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const mapped = {
      ...row,
      id: String(row.id || '').trim(),
      name: String(row.name || '').trim(),
      nif: String(row.nif || '').trim(),
      balance: Number(row.balance || 0),
    };
    if (!mapped.id || seen.has(mapped.id) || !keepListedParty(mapped)) continue;
    seen.add(mapped.id);
    out.push(mapped);
  }
  return out;
}

async function safeQuery(db, sql, params = [], label = 'query') {
  try {
    return (await db.query(sql, params)).rows || [];
  } catch (err) {
    console.warn(`[accountStatement] ${label} skipped:`, err.message);
    return [];
  }
}

async function loadPartyRow(db, party, entityId) {
  const table = party === 'supplier' ? 'suppliers' : 'clients';
  const rows = await safeQuery(
    db,
    `SELECT id, name, nif FROM ${table} WHERE ${idEq(db, 'id')} LIMIT 1`,
    [entityId],
    `${table} lookup`,
  );
  return rows[0] || null;
}

async function queryOpenItems(db, party, entityId) {
  const typeSql = party === 'supplier' ? supplierTypeSql() : customerTypeSql();
  return safeQuery(
    db,
    `SELECT id, document_type, document_id, document_number, document_date, due_date,
            original_amount, remaining_amount, is_debit, status, created_at
     FROM open_items
     WHERE ${typeSql} AND ${idEq(db, 'entity_id')}
     ORDER BY document_date ASC, created_at ASC`,
    [entityId],
    'open_items',
  );
}

async function queryPayments(db, party, entityId) {
  const typeSql = party === 'supplier' ? supplierTypeSql() : customerTypeSql();
  return safeQuery(
    db,
    `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at, entity_name
     FROM payments
     WHERE ${typeSql} AND ${idEq(db, 'entity_id')}
     ORDER BY created_at ASC`,
    [entityId],
    'payments',
  );
}

async function queryCustomerSales(db, entityId, name) {
  const byId = await safeQuery(
    db,
    `SELECT s.id, s.invoice_number, s.created_at, s.total, s.amount_paid, s.payment_method,
            s.status, s.customer_nif, s.customer_name, s.client_id
     FROM sales s
     WHERE ${notVoidedSql('s.status')}
       AND ${idEq(db, 's.client_id')}
     ORDER BY s.created_at ASC`,
    [entityId],
    'sales by client_id',
  );
  if (byId.length || !usablePartyName(name)) return byId;

  return safeQuery(
    db,
    `SELECT s.id, s.invoice_number, s.created_at, s.total, s.amount_paid, s.payment_method,
            s.status, s.customer_nif, s.customer_name, s.client_id
     FROM sales s
     WHERE ${notVoidedSql('s.status')}
       AND ${missingLinkedIdSql(db, 's.client_id')}
       AND LOWER(TRIM(s.customer_name)) = $2
     ORDER BY s.created_at ASC
     LIMIT 2000`,
    [entityId, String(name).trim().toLowerCase()],
    'sales by name',
  );
}

async function queryCustomerNotes(db, table, saleIds) {
  if (!saleIds.length) return [];
  const placeholders = saleIds.map((_, i) => `$${i + 1}`).join(', ');
  return safeQuery(
    db,
    `SELECT id, document_number, total, issued_at, created_at, status, original_invoice_id,
            customer_nif, customer_name
     FROM ${table}
     WHERE LOWER(COALESCE(status, '')) IN ('issued', 'transmitted')
       AND ${asText(db, 'original_invoice_id')} IN (${placeholders})
     ORDER BY COALESCE(issued_at, created_at) ASC`,
    saleIds,
    table,
  );
}

async function querySupplierPurchases(db, entityId, name) {
  const byId = await safeQuery(
    db,
    `SELECT id, invoice_number, date, created_at, total, status, supplier_id,
            supplier_account_code, supplier_nif, supplier_name
     FROM purchase_invoices
     WHERE ${notDraftSql('status')}
       AND supplier_id = $1
     ORDER BY COALESCE(date, created_at) ASC`,
    [entityId],
    'purchases by supplier_id',
  );
  if (byId.length || !usablePartyName(name)) return byId;

  return safeQuery(
    db,
    `SELECT id, invoice_number, date, created_at, total, status, supplier_id,
            supplier_account_code, supplier_nif, supplier_name
     FROM purchase_invoices
     WHERE ${notDraftSql('status')}
       AND ${missingLinkedIdSql(db, 'supplier_id')}
       AND LOWER(TRIM(supplier_name)) = $2
     ORDER BY COALESCE(date, created_at) ASC
     LIMIT 2000`,
    [entityId, String(name).trim().toLowerCase()],
    'purchases by name',
  );
}

async function loadAccountStatement(db, entityType, entityId) {
  const party = normalizeParty(entityType);
  const id = String(entityId || '').trim();
  const [row, openItems, payments] = await Promise.all([
    loadPartyRow(db, party, id),
    queryOpenItems(db, party, id),
    queryPayments(db, party, id),
  ]);
  const name = String(row?.name || '').trim();

  if (party === 'supplier') {
    return {
      openItems,
      payments,
      sales: [],
      creditNotes: [],
      debitNotes: [],
      purchases: await querySupplierPurchases(db, id, name),
    };
  }

  const sales = await queryCustomerSales(db, id, name);
  const saleIds = sales.map((s) => String(s.id)).filter(Boolean);
  const [creditNotes, debitNotes] = await Promise.all([
    queryCustomerNotes(db, 'credit_notes', saleIds),
    queryCustomerNotes(db, 'debit_notes', saleIds),
  ]);
  return {
    openItems,
    payments,
    sales,
    creditNotes,
    debitNotes,
    purchases: [],
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadPartiesByIds(db, table, ids, balanceColumn) {
  const unique = [...new Set(
    (ids || [])
      .map((id) => String(id || '').trim())
      .filter((id) => id && UUID_RE.test(id)),
  )];
  if (!unique.length) return [];
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(', ');
  const idFilter = isPg(db)
    ? `id IN (${unique.map((_, i) => `$${i + 1}::uuid`).join(', ')})`
    : `id IN (${placeholders})`;
  return safeQuery(
    db,
    `SELECT id, name, nif, COALESCE(${balanceColumn}, 0) AS balance
     FROM ${table}
     WHERE ${idFilter}
     ORDER BY name`,
    unique,
    `${table} by ids`,
  );
}

async function collectTextIds(db, sql, params, label) {
  const rows = await safeQuery(db, sql, params, label);
  return rows.map((row) => String(row.id || '').trim()).filter(Boolean);
}

async function listCustomerParties(db) {
  const linkedIds = await collectTextIds(
    db,
    `SELECT ${asText(db, 'entity_id')} AS id
     FROM open_items
     WHERE ${customerTypeSql()}
     UNION
     SELECT ${asText(db, 'entity_id')}
     FROM payments
     WHERE ${customerTypeSql()}
     UNION
     SELECT ${asText(db, 'client_id')}
     FROM sales
     WHERE ${hasLinkedIdSql(db, 'client_id')}
       AND ${notVoidedSql('status')}`,
    [],
    'customer linked ids',
  );

  return loadPartiesByIds(db, 'clients', linkedIds, 'current_balance');
}

async function listSupplierParties(db) {
  const linkedIds = await collectTextIds(
    db,
    `SELECT ${asText(db, 'entity_id')} AS id
     FROM open_items
     WHERE ${supplierTypeSql()}
     UNION
     SELECT ${asText(db, 'entity_id')}
     FROM payments
     WHERE ${supplierTypeSql()}
     UNION
     SELECT supplier_id
     FROM purchase_invoices
     WHERE ${hasLinkedIdSql(db, 'supplier_id')}
       AND ${notDraftSql('status')}`,
    [],
    'supplier linked ids',
  );

  const namedIds = await collectTextIds(
    db,
    `SELECT ${asText(db, 's.id')} AS id
     FROM suppliers s
     JOIN purchase_invoices pi
       ON ${missingLinkedIdSql(db, 'pi.supplier_id')}
      AND LOWER(TRIM(pi.supplier_name)) = LOWER(TRIM(s.name))
     WHERE ${notDraftSql('pi.status')}
       AND LENGTH(TRIM(s.name)) >= 4`,
    [],
    'supplier name ids',
  );

  return loadPartiesByIds(db, 'suppliers', [...linkedIds, ...namedIds], 'balance');
}

async function listStatementParties(db, entityType) {
  const party = normalizeParty(entityType);
  const rows = party === 'supplier'
    ? await listSupplierParties(db)
    : await listCustomerParties(db);
  return mapPartyRows(rows);
}

module.exports = {
  normalizeParty,
  isPlaceholderNif,
  isGenericPartyName,
  loadAccountStatement,
  listStatementParties,
};
