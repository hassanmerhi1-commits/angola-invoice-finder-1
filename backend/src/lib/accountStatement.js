/**
 * Customer / supplier extracto.
 * Compare ids as text with dashes stripped — live data mixes UUID and
 * dashless TEXT keys from the SQLite era. Never use `$1::uuid`.
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

function asText(expr) {
  return `CAST(${expr} AS TEXT)`;
}

function idKey(expr) {
  return `REPLACE(LOWER(TRIM(${asText(expr)})), '-', '')`;
}

function idEq(column, param = '$1') {
  return `${idKey(column)} = ${idKey(param)}`;
}

function customerTypeSql(column = 'entity_type') {
  return `LOWER(TRIM(${asText(column)})) IN ('customer', 'client')`;
}

function supplierTypeSql(column = 'entity_type') {
  return `LOWER(TRIM(${asText(column)})) = 'supplier'`;
}

function notVoidedSql(column) {
  return `LOWER(COALESCE(${column}, '')) NOT IN ('voided', 'cancelled', 'canceled')`;
}

function notDraftSql(column) {
  return `LOWER(COALESCE(${column}, '')) NOT IN ('draft', 'voided', 'cancelled', 'canceled')`;
}

function hasLinkedIdSql(column) {
  return `TRIM(COALESCE(${asText(column)}, '')) <> ''`;
}

function missingLinkedIdSql(column) {
  return `TRIM(COALESCE(${asText(column)}, '')) = ''`;
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

function idVariants(entityId) {
  const raw = String(entityId || '').trim();
  if (!raw) return [];
  const nodash = raw.replace(/-/g, '').toLowerCase();
  const variants = new Set([raw, raw.toLowerCase(), nodash]);
  if (/^[0-9a-f]{32}$/i.test(nodash)) {
    variants.add(`${nodash.slice(0, 8)}-${nodash.slice(8, 12)}-${nodash.slice(12, 16)}-${nodash.slice(16, 20)}-${nodash.slice(20)}`);
  }
  return [...variants].filter(Boolean);
}

async function runQuery(db, sql, params, errors, label) {
  try {
    return (await db.query(sql, params)).rows || [];
  } catch (err) {
    const message = `${label}: ${err.message}`;
    errors.push(message);
    console.warn('[accountStatement]', message);
    return [];
  }
}

async function loadPartyRow(db, party, entityId, errors) {
  const table = party === 'supplier' ? 'suppliers' : 'clients';
  const rows = await runQuery(
    db,
    `SELECT id, name, nif FROM ${table} WHERE ${idEq('id')} LIMIT 1`,
    [entityId],
    errors,
    `${table} lookup`,
  );
  return rows[0] || null;
}

async function queryOpenItems(db, party, entityId, errors) {
  const variants = idVariants(entityId);
  const keys = [...new Set(variants.map((id) => id.replace(/-/g, '').toLowerCase()))];
  if (!keys.length) return [];
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const typeSql = party === 'supplier' ? supplierTypeSql() : customerTypeSql();

  let rows = await runQuery(
    db,
    `SELECT id, entity_type, document_type, document_id, document_number, document_date, due_date,
            original_amount, remaining_amount, is_debit, status, created_at
     FROM open_items
     WHERE ${idKey('entity_id')} IN (${placeholders})
     ORDER BY document_date ASC, created_at ASC`,
    keys,
    errors,
    'open_items',
  );
  if (rows.length) {
    const typed = rows.filter((row) => {
      const t = String(row.entity_type || '').trim().toLowerCase();
      return party === 'supplier' ? t === 'supplier' : (t === 'customer' || t === 'client' || !t);
    });
    return typed.length ? typed : rows;
  }

  return runQuery(
    db,
    `SELECT id, document_type, document_id, document_number, document_date, due_date,
            original_amount, remaining_amount, is_debit, status, created_at
     FROM open_items
     WHERE ${typeSql} AND ${idEq('entity_id')}
     ORDER BY document_date ASC, created_at ASC`,
    [entityId],
    errors,
    'open_items typed',
  );
}

async function queryPayments(db, party, entityId, errors) {
  const variants = idVariants(entityId);
  const keys = [...new Set(variants.map((id) => id.replace(/-/g, '').toLowerCase()))];
  if (!keys.length) return [];
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  return runQuery(
    db,
    `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at, entity_name
     FROM payments
     WHERE ${idKey('entity_id')} IN (${placeholders})
     ORDER BY created_at ASC`,
    keys,
    errors,
    'payments',
  );
}

async function queryCustomerSales(db, entityId, name, errors) {
  const params = [entityId];
  let nameClause = '';
  if (usablePartyName(name)) {
    params.push(String(name).trim().toLowerCase());
    nameClause = ` OR LOWER(TRIM(customer_name)) = $${params.length}`;
  }
  return runQuery(
    db,
    `SELECT id, invoice_number, created_at, total, amount_paid, payment_method,
            status, customer_nif, customer_name, client_id
     FROM sales
     WHERE ${notVoidedSql('status')}
       AND (${idEq('client_id')} ${nameClause})
     ORDER BY created_at ASC`,
    params,
    errors,
    'sales',
  );
}

async function queryCustomerNotes(db, table, saleIds, errors) {
  if (!saleIds.length) return [];
  const placeholders = saleIds.map((_, i) => `$${i + 1}`).join(', ');
  return runQuery(
    db,
    `SELECT id, document_number, total, issued_at, created_at, status, original_invoice_id,
            customer_nif, customer_name
     FROM ${table}
     WHERE LOWER(COALESCE(status, '')) IN ('issued', 'transmitted')
       AND ${asText('original_invoice_id')} IN (${placeholders})
     ORDER BY COALESCE(issued_at, created_at) ASC`,
    saleIds,
    errors,
    table,
  );
}

async function querySupplierPurchases(db, entityId, name, errors) {
  const params = [entityId];
  let nameClause = '';
  if (usablePartyName(name)) {
    params.push(String(name).trim().toLowerCase());
    nameClause = ` OR LOWER(TRIM(supplier_name)) = $${params.length}`;
  }
  return runQuery(
    db,
    `SELECT id, invoice_number, date, created_at, total, status, supplier_id,
            supplier_account_code, supplier_nif, supplier_name
     FROM purchase_invoices
     WHERE ${notDraftSql('status')}
       AND (${idEq('supplier_id')} ${nameClause})
     ORDER BY COALESCE(date, created_at) ASC`,
    params,
    errors,
    'purchases',
  );
}

async function loadAccountStatement(db, entityType, entityId) {
  const party = normalizeParty(entityType);
  const id = String(entityId || '').trim();
  const errors = [];
  const [row, openItems, payments] = await Promise.all([
    loadPartyRow(db, party, id, errors),
    queryOpenItems(db, party, id, errors),
    queryPayments(db, party, id, errors),
  ]);
  const name = String(row?.name || '').trim();

  if (party === 'supplier') {
    let supplierIds = [id];
    try {
      const { resolveSupplierEntityIds } = require('../supplierBalanceRepair');
      supplierIds = await resolveSupplierEntityIds(id);
    } catch (err) {
      errors.push(`supplier ids: ${err.message}`);
    }
    const purchases = [];
    const seen = new Set();
    for (const supplierId of supplierIds.length ? supplierIds : [id]) {
      for (const purchase of await querySupplierPurchases(db, supplierId, name, errors)) {
        const key = String(purchase.id || purchase.invoice_number || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        purchases.push(purchase);
      }
    }
    return {
      openItems,
      payments,
      sales: [],
      creditNotes: [],
      debitNotes: [],
      purchases,
      _errors: errors,
    };
  }

  const sales = await queryCustomerSales(db, id, name, errors);
  const saleIds = sales.map((s) => String(s.id)).filter(Boolean);
  const [creditNotes, debitNotes] = await Promise.all([
    queryCustomerNotes(db, 'credit_notes', saleIds, errors),
    queryCustomerNotes(db, 'debit_notes', saleIds, errors),
  ]);
  return {
    openItems,
    payments,
    sales,
    creditNotes,
    debitNotes,
    purchases: [],
    _errors: errors,
  };
}

async function loadPartiesByIds(db, table, ids, balanceColumn, errors) {
  const unique = [...new Set(
    (ids || [])
      .map((id) => String(id || '').trim())
      .filter((id) => id && id.replace(/-/g, '').length >= 8),
  )];
  if (!unique.length) return [];
  const keys = unique.map((id) => id.replace(/-/g, '').toLowerCase());
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  return runQuery(
    db,
    `SELECT id, name, nif, COALESCE(${balanceColumn}, 0) AS balance
     FROM ${table}
     WHERE ${idKey('id')} IN (${placeholders})
     ORDER BY name`,
    keys,
    errors,
    `${table} by ids`,
  );
}

async function collectTextIds(db, sql, params, errors, label) {
  const rows = await runQuery(db, sql, params, errors, label);
  return rows.map((row) => String(row.id || '').trim()).filter(Boolean);
}

async function listCustomerParties(db) {
  const errors = [];
  const linkedIds = await collectTextIds(
    db,
    `SELECT ${asText('entity_id')} AS id
     FROM open_items
     WHERE ${customerTypeSql()}
     UNION
     SELECT ${asText('entity_id')}
     FROM payments
     WHERE ${customerTypeSql()}
     UNION
     SELECT ${asText('client_id')}
     FROM sales
     WHERE ${hasLinkedIdSql('client_id')}
       AND ${notVoidedSql('status')}`,
    [],
    errors,
    'customer linked ids',
  );
  return loadPartiesByIds(db, 'clients', linkedIds, 'current_balance', errors);
}

async function listSupplierParties(db) {
  const errors = [];
  const linkedIds = await collectTextIds(
    db,
    `SELECT ${asText('entity_id')} AS id
     FROM open_items
     WHERE ${supplierTypeSql()}
     UNION
     SELECT ${asText('entity_id')}
     FROM payments
     WHERE ${supplierTypeSql()}
     UNION
     SELECT ${asText('supplier_id')}
     FROM purchase_invoices
     WHERE ${hasLinkedIdSql('supplier_id')}
       AND ${notDraftSql('status')}`,
    [],
    errors,
    'supplier linked ids',
  );
  const namedIds = await collectTextIds(
    db,
    `SELECT ${asText('s.id')} AS id
     FROM suppliers s
     JOIN purchase_invoices pi
       ON ${missingLinkedIdSql('pi.supplier_id')}
      AND LOWER(TRIM(pi.supplier_name)) = LOWER(TRIM(s.name))
     WHERE ${notDraftSql('pi.status')}
       AND LENGTH(TRIM(s.name)) >= 4`,
    [],
    errors,
    'supplier name ids',
  );
  return loadPartiesByIds(db, 'suppliers', [...linkedIds, ...namedIds], 'balance', errors);
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
  idVariants,
  loadAccountStatement,
  listStatementParties,
};
