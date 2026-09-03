/**
 * Customer / supplier extracto.
 * Postgres stores client/supplier/open-item/payment ids as UUID — never TRIM() them raw.
 */

const { openItemDebitAmountCase } = require('./sqlDialect');

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

function txt(column) {
  return `TRIM(CAST(${column} AS TEXT))`;
}

function idsEqual(left, right) {
  return `LOWER(${txt(left)}) = LOWER(${txt(right)})`;
}

function nifKey(column) {
  return `REPLACE(${txt(column)}, ' ', '')`;
}

function placeholderNifSql(column) {
  const n = nifKey(column);
  return `(${n} = '' OR ${n} IN ('000000000','0000000000','111111111','1111111111','999999999','9999999999'))`;
}

function usableNifSql(column) {
  return `(NOT ${placeholderNifSql(column)})`;
}

function genericNameSql(column) {
  const n = `LOWER(${txt(column)})`;
  return `(${n} IN ('consumidor final','cliente','cliente final','walk-in','walk in','final test','consumidor','fornecedor','supplier'))`;
}

function usableNameSql(column) {
  return `(LENGTH(${txt(column)}) >= 4 AND NOT ${genericNameSql(column)})`;
}

function notVoidedSql(column) {
  return `LOWER(COALESCE(CAST(${column} AS TEXT), '')) NOT IN ('voided', 'cancelled', 'canceled')`;
}

function customerTypeSql(alias) {
  const col = alias ? `${alias}.entity_type` : 'entity_type';
  return `LOWER(${txt(col)}) IN ('customer', 'client')`;
}

function supplierTypeSql(alias) {
  const col = alias ? `${alias}.entity_type` : 'entity_type';
  return `LOWER(${txt(col)}) = 'supplier'`;
}

function keepListedParty(row) {
  const balance = Number(row?.balance || 0);
  if (Math.abs(balance) > 0.005) return true;
  if (isGenericPartyName(row?.name) && isPlaceholderNif(row?.nif)) return false;
  return true;
}

function mapPartyRows(rows) {
  return (rows || [])
    .map((row) => ({
      ...row,
      id: String(row.id || '').trim(),
      name: String(row.name || '').trim(),
      nif: String(row.nif || '').trim(),
      balance: Number(row.balance || 0),
    }))
    .filter((row) => row.id && keepListedParty(row));
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
    `SELECT id, name, nif FROM ${table} WHERE ${idsEqual('id', '$1')} LIMIT 1`,
    [entityId],
    `${table} lookup`,
  );
  return rows[0] || null;
}

function customerDocMatchSql(idParam, nifParam, nameParam) {
  const parts = [`${idsEqual('s.client_id', idParam)}`];
  if (nifParam) {
    parts.push(`(${usableNifSql('s.customer_nif')} AND ${nifKey('s.customer_nif')} = ${nifParam})`);
  }
  if (nameParam) {
    parts.push(`(${usableNameSql('s.customer_name')} AND LOWER(${txt('s.customer_name')}) = ${nameParam})`);
  }
  return parts.join(' OR ');
}

function supplierDocMatchSql(idParam, nifParam, nameParam) {
  const parts = [
    idsEqual('pi.supplier_id', idParam),
  ];
  if (nifParam) {
    parts.push(`(${usableNifSql('pi.supplier_nif')} AND ${nifKey('pi.supplier_nif')} = ${nifParam})`);
  }
  if (nameParam) {
    parts.push(`(${usableNameSql('pi.supplier_name')} AND LOWER(${txt('pi.supplier_name')}) = ${nameParam})`);
  }
  return parts.join(' OR ');
}

function bindIdentity(entityId, nif, name) {
  const params = [entityId];
  let nifParam = '';
  let nameParam = '';
  if (!isPlaceholderNif(nif)) {
    params.push(String(nif).replace(/\s/g, ''));
    nifParam = `$${params.length}`;
  }
  if (usablePartyName(name)) {
    params.push(String(name).trim().toLowerCase());
    nameParam = `$${params.length}`;
  }
  return { params, nifParam, nameParam };
}

async function queryOpenItems(db, party, entityId, nif, name) {
  const typeSql = party === 'supplier' ? supplierTypeSql() : customerTypeSql();
  const byEntity = await safeQuery(
    db,
    `SELECT id, document_type, document_id, document_number, document_date, due_date,
            original_amount, remaining_amount, is_debit, status, created_at
     FROM open_items
     WHERE ${typeSql} AND ${idsEqual('entity_id', '$1')}
     ORDER BY document_date ASC, created_at ASC`,
    [entityId],
    'open_items by entity',
  );

  const { params, nifParam, nameParam } = bindIdentity(entityId, nif, name);
  const extraSql = party === 'supplier'
    ? `SELECT oi.id, oi.document_type, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
              oi.original_amount, oi.remaining_amount, oi.is_debit, oi.status, oi.created_at
       FROM open_items oi
       JOIN purchase_invoices pi ON CAST(pi.id AS TEXT) = CAST(oi.document_id AS TEXT)
       WHERE ${notVoidedSql('pi.status')}
         AND (${supplierDocMatchSql('$1', nifParam, nameParam)})`
    : `SELECT oi.id, oi.document_type, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
              oi.original_amount, oi.remaining_amount, oi.is_debit, oi.status, oi.created_at
       FROM open_items oi
       JOIN sales s ON CAST(s.id AS TEXT) = CAST(oi.document_id AS TEXT)
       WHERE ${notVoidedSql('s.status')}
         AND (${customerDocMatchSql('$1', nifParam, nameParam)})`;
  const byDocs = await safeQuery(db, extraSql, params, 'open_items by documents');

  const seen = new Set();
  const merged = [];
  for (const row of [...byEntity, ...byDocs]) {
    const key = String(row.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  merged.sort((a, b) => String(a.document_date || '').localeCompare(String(b.document_date || '')));
  return merged;
}

async function queryPayments(db, party, entityId, name) {
  const typeSql = party === 'supplier' ? supplierTypeSql() : customerTypeSql();
  const params = [entityId];
  let nameClause = '';
  if (usablePartyName(name)) {
    params.push(String(name).trim().toLowerCase());
    nameClause = ` OR (${usableNameSql('entity_name')} AND LOWER(${txt('entity_name')}) = $${params.length})`;
  }
  const sql = `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at, entity_name
               FROM payments
               WHERE (${typeSql} AND ${idsEqual('entity_id', '$1')})
                 ${nameClause}
               ORDER BY created_at ASC`;
  return safeQuery(db, sql, params, 'payments');
}

async function queryCustomerSales(db, entityId, nif, name) {
  const { params, nifParam, nameParam } = bindIdentity(entityId, nif, name);
  const sql = `
    SELECT s.id, s.invoice_number, s.created_at, s.total, s.amount_paid, s.payment_method,
           s.status, s.customer_nif, s.customer_name, s.client_id
    FROM sales s
    WHERE ${notVoidedSql('s.status')}
      AND (${customerDocMatchSql('$1', nifParam, nameParam)})
    ORDER BY s.created_at ASC`;
  return safeQuery(db, sql, params, 'sales');
}

async function queryCustomerNotes(db, table, nif, name, saleIds) {
  const params = [];
  const parts = [];
  if (!isPlaceholderNif(nif)) {
    params.push(String(nif).replace(/\s/g, ''));
    parts.push(`(${usableNifSql('customer_nif')} AND ${nifKey('customer_nif')} = $${params.length})`);
  }
  if (usablePartyName(name)) {
    params.push(String(name).trim().toLowerCase());
    parts.push(`(${usableNameSql('customer_name')} AND LOWER(${txt('customer_name')}) = $${params.length})`);
  }
  if (saleIds.length) {
    const placeholders = saleIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
    parts.push(`CAST(original_invoice_id AS TEXT) IN (${placeholders})`);
    params.push(...saleIds);
  }
  if (!parts.length) return [];
  const sql = `
    SELECT id, document_number, total, issued_at, created_at, status, original_invoice_id,
           customer_nif, customer_name
    FROM ${table}
    WHERE LOWER(COALESCE(CAST(status AS TEXT), '')) IN ('issued', 'transmitted')
      AND (${parts.join(' OR ')})
    ORDER BY COALESCE(issued_at, created_at) ASC`;
  return safeQuery(db, sql, params, table);
}

async function querySupplierPurchases(db, entityId, nif, name) {
  const { params, nifParam, nameParam } = bindIdentity(entityId, nif, name);
  const sql = `
    SELECT id, invoice_number, date, created_at, total, status, supplier_id,
           supplier_account_code, supplier_nif, supplier_name
    FROM purchase_invoices pi
    WHERE ${notVoidedSql('status')}
      AND LOWER(COALESCE(CAST(status AS TEXT), '')) NOT IN ('draft')
      AND (${supplierDocMatchSql('$1', nifParam, nameParam)})
    ORDER BY COALESCE(date, created_at) ASC`;
  return safeQuery(db, sql, params, 'purchases');
}

async function loadAccountStatement(db, entityType, entityId) {
  const party = normalizeParty(entityType);
  const id = String(entityId || '').trim();
  const row = await loadPartyRow(db, party, id);
  const nif = String(row?.nif || '').replace(/\s/g, '').trim();
  const name = String(row?.name || '').trim();

  const [openItems, payments] = await Promise.all([
    queryOpenItems(db, party, id, nif, name),
    queryPayments(db, party, id, name),
  ]);

  let sales = [];
  let creditNotes = [];
  let debitNotes = [];
  let purchases = [];

  if (party === 'customer') {
    sales = await queryCustomerSales(db, id, nif, name);
    const saleIds = sales.map((s) => String(s.id)).filter(Boolean);
    creditNotes = await queryCustomerNotes(db, 'credit_notes', nif, name, saleIds);
    debitNotes = await queryCustomerNotes(db, 'debit_notes', nif, name, saleIds);
  } else {
    purchases = await querySupplierPurchases(db, id, nif, name);
  }

  return {
    openItems,
    payments,
    sales,
    creditNotes,
    debitNotes,
    purchases,
  };
}

async function listCustomerPartiesSql(db) {
  const amountCase = openItemDebitAmountCase(db, 'oi');
  const sql = `
    SELECT c.id, c.name, c.nif,
      COALESCE((
        SELECT SUM(${amountCase})
        FROM open_items oi
        WHERE ${customerTypeSql('oi')}
          AND ${idsEqual('oi.entity_id', 'c.id')}
          AND LOWER(COALESCE(CAST(oi.status AS TEXT), '')) <> 'cleared'
      ), 0) AS balance
    FROM clients c
    WHERE EXISTS (
      SELECT 1 FROM open_items oi
      WHERE ${customerTypeSql('oi')} AND ${idsEqual('oi.entity_id', 'c.id')}
    ) OR EXISTS (
      SELECT 1 FROM payments p
      WHERE ${customerTypeSql('p')} AND ${idsEqual('p.entity_id', 'c.id')}
    ) OR EXISTS (
      SELECT 1 FROM sales s
      WHERE ${notVoidedSql('s.status')}
        AND (
          ${idsEqual('s.client_id', 'c.id')}
          OR (${usableNifSql('c.nif')} AND ${usableNifSql('s.customer_nif')} AND ${nifKey('s.customer_nif')} = ${nifKey('c.nif')})
          OR (${usableNameSql('c.name')} AND ${usableNameSql('s.customer_name')} AND LOWER(${txt('s.customer_name')}) = LOWER(${txt('c.name')}))
        )
    )
    ORDER BY c.name`;
  return db.query(sql);
}

async function listSupplierPartiesSql(db) {
  const amountCase = openItemDebitAmountCase(db, 'oi');
  const sql = `
    SELECT s.id, s.name, s.nif,
      COALESCE((
        SELECT SUM(${amountCase})
        FROM open_items oi
        WHERE ${supplierTypeSql('oi')}
          AND ${idsEqual('oi.entity_id', 's.id')}
          AND LOWER(COALESCE(CAST(oi.status AS TEXT), '')) <> 'cleared'
      ), 0) AS balance
    FROM suppliers s
    WHERE EXISTS (
      SELECT 1 FROM open_items oi
      WHERE ${supplierTypeSql('oi')} AND ${idsEqual('oi.entity_id', 's.id')}
    ) OR EXISTS (
      SELECT 1 FROM payments p
      WHERE ${supplierTypeSql('p')} AND ${idsEqual('p.entity_id', 's.id')}
    ) OR EXISTS (
      SELECT 1 FROM purchase_invoices pi
      WHERE ${notVoidedSql('pi.status')}
        AND LOWER(COALESCE(CAST(pi.status AS TEXT), '')) NOT IN ('draft')
        AND (
          ${idsEqual('pi.supplier_id', 's.id')}
          OR (${usableNifSql('s.nif')} AND ${usableNifSql('pi.supplier_nif')} AND ${nifKey('pi.supplier_nif')} = ${nifKey('s.nif')})
          OR (${usableNameSql('s.name')} AND ${usableNameSql('pi.supplier_name')} AND LOWER(${txt('pi.supplier_name')}) = LOWER(${txt('s.name')}))
        )
    )
    ORDER BY s.name`;
  return db.query(sql);
}

async function collectIds(db, sql, label) {
  const rows = await safeQuery(db, sql, [], label);
  return rows.map((row) => String(row.id || '').trim()).filter(Boolean);
}

async function listPartiesByIds(db, table, ids, balanceSql) {
  if (!ids.length) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  return safeQuery(
    db,
    `SELECT t.id, t.name, t.nif, ${balanceSql} AS balance
     FROM ${table} t
     WHERE CAST(t.id AS TEXT) IN (${placeholders})
     ORDER BY t.name`,
    ids,
    `${table} by ids`,
  );
}

async function listStatementPartiesFallback(db, party) {
  const amountCase = openItemDebitAmountCase(db, 'oi');
  if (party === 'supplier') {
    const ids = new Set([
      ...(await collectIds(db, `SELECT CAST(entity_id AS TEXT) AS id FROM open_items WHERE ${supplierTypeSql()}`, 'supplier oi ids')),
      ...(await collectIds(db, `SELECT CAST(entity_id AS TEXT) AS id FROM payments WHERE ${supplierTypeSql()}`, 'supplier pay ids')),
      ...(await collectIds(db, `SELECT CAST(supplier_id AS TEXT) AS id FROM purchase_invoices WHERE ${notVoidedSql('status')} AND COALESCE(CAST(supplier_id AS TEXT), '') <> ''`, 'supplier fc ids')),
      ...(await collectIds(db, `
        SELECT CAST(s.id AS TEXT) AS id
        FROM suppliers s
        JOIN purchase_invoices pi
          ON ${usableNameSql('s.name')} AND ${usableNameSql('pi.supplier_name')}
         AND LOWER(${txt('pi.supplier_name')}) = LOWER(${txt('s.name')})
        WHERE ${notVoidedSql('pi.status')}`, 'supplier name ids')),
    ]);
    return listPartiesByIds(
      db,
      'suppliers',
      [...ids],
      `COALESCE((
        SELECT SUM(${amountCase}) FROM open_items oi
        WHERE ${supplierTypeSql('oi')} AND ${idsEqual('oi.entity_id', 't.id')}
          AND LOWER(COALESCE(CAST(oi.status AS TEXT), '')) <> 'cleared'
      ), 0)`,
    );
  }

  const ids = new Set([
    ...(await collectIds(db, `SELECT CAST(entity_id AS TEXT) AS id FROM open_items WHERE ${customerTypeSql()}`, 'customer oi ids')),
    ...(await collectIds(db, `SELECT CAST(entity_id AS TEXT) AS id FROM payments WHERE ${customerTypeSql()}`, 'customer pay ids')),
    ...(await collectIds(db, `SELECT CAST(client_id AS TEXT) AS id FROM sales WHERE ${notVoidedSql('status')} AND COALESCE(CAST(client_id AS TEXT), '') <> ''`, 'customer sale ids')),
    ...(await collectIds(db, `
      SELECT CAST(c.id AS TEXT) AS id
      FROM clients c
      JOIN sales s
        ON ${usableNameSql('c.name')} AND ${usableNameSql('s.customer_name')}
       AND LOWER(${txt('s.customer_name')}) = LOWER(${txt('c.name')})
      WHERE ${notVoidedSql('s.status')}`, 'customer name ids')),
  ]);
  return listPartiesByIds(
    db,
    'clients',
    [...ids],
    `COALESCE((
      SELECT SUM(${amountCase}) FROM open_items oi
      WHERE ${customerTypeSql('oi')} AND ${idsEqual('oi.entity_id', 't.id')}
        AND LOWER(COALESCE(CAST(oi.status AS TEXT), '')) <> 'cleared'
    ), 0)`,
  );
}

async function listStatementParties(db, entityType) {
  const party = normalizeParty(entityType);
  try {
    const result = party === 'supplier'
      ? await listSupplierPartiesSql(db)
      : await listCustomerPartiesSql(db);
    return mapPartyRows(result.rows);
  } catch (err) {
    console.warn('[accountStatement] parties query failed, using fallback:', err.message);
    return mapPartyRows(await listStatementPartiesFallback(db, party));
  }
}

module.exports = {
  normalizeParty,
  isPlaceholderNif,
  isGenericPartyName,
  loadAccountStatement,
  listStatementParties,
};
