/**
 * Customer / supplier extracto: open items, payments, plus invoices that
 * never created an open item (cash POS sales, settled purchases).
 */

function normalizeParty(entityType) {
  const raw = String(entityType || '').trim().toLowerCase();
  if (raw === 'supplier' || raw === 'fornecedor') return 'supplier';
  return 'customer';
}

function entityTypesSql(party) {
  return party === 'supplier' ? `('supplier')` : `('customer', 'client')`;
}

function notVoidedSql(column) {
  return `LOWER(COALESCE(${column}, '')) NOT IN ('voided', 'cancelled', 'canceled')`;
}

async function loadPartyRow(db, party, entityId) {
  const table = party === 'supplier' ? 'suppliers' : 'clients';
  const result = await db.query(
    `SELECT id, name, nif FROM ${table} WHERE id = $1 LIMIT 1`,
    [entityId],
  );
  return result.rows[0] || null;
}

async function queryOpenItems(db, party, entityId, dateFrom, dateTo) {
  const types = entityTypesSql(party);
  let sql = `SELECT id, document_type, document_id, document_number, document_date, due_date,
                    original_amount, remaining_amount, is_debit, status, created_at
             FROM open_items
             WHERE LOWER(TRIM(COALESCE(entity_type, ''))) IN ${types}
               AND entity_id = $1`;
  const params = [entityId];
  let idx = 2;
  if (dateFrom) {
    sql += ` AND document_date >= $${idx++}`;
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ` AND document_date <= $${idx++}`;
    params.push(dateTo);
  }
  sql += ' ORDER BY document_date ASC, created_at ASC';
  return (await db.query(sql, params)).rows;
}

async function queryPayments(db, party, entityId, dateFrom, dateTo) {
  const types = entityTypesSql(party);
  let sql = `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at
             FROM payments
             WHERE LOWER(TRIM(COALESCE(entity_type, ''))) IN ${types}
               AND entity_id = $1`;
  const params = [entityId];
  let idx = 2;
  if (dateFrom) {
    sql += ` AND created_at >= $${idx++}`;
    params.push(`${dateFrom}T00:00:00`);
  }
  if (dateTo) {
    sql += ` AND created_at <= $${idx++}`;
    params.push(`${dateTo}T23:59:59`);
  }
  sql += ' ORDER BY created_at ASC';
  return (await db.query(sql, params)).rows;
}

async function queryCustomerSales(db, entityId, nif) {
  const params = [entityId];
  let nifClause = '';
  if (nif) {
    params.push(nif);
    nifClause = ` OR REPLACE(TRIM(COALESCE(s.customer_nif, '')), ' ', '') = $${params.length}`;
  }
  const sql = `
    SELECT s.id, s.invoice_number, s.created_at, s.total, s.amount_paid, s.payment_method,
           s.status, s.customer_nif, s.customer_name, s.client_id
    FROM sales s
    WHERE ${notVoidedSql('s.status')}
      AND (
        TRIM(COALESCE(s.client_id, '')) = $1
        ${nifClause}
      )
    ORDER BY s.created_at ASC`;
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    console.warn('[accountStatement] sales query skipped:', err.message);
    return [];
  }
}

async function queryCustomerNotes(db, table, entityId, nif, saleIds) {
  const params = [];
  const parts = [];
  if (nif) {
    params.push(nif);
    parts.push(`REPLACE(TRIM(COALESCE(customer_nif, '')), ' ', '') = $${params.length}`);
  }
  if (saleIds.length) {
    const placeholders = saleIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
    parts.push(`original_invoice_id IN (${placeholders})`);
    params.push(...saleIds);
  }
  if (!parts.length) return [];
  const sql = `
    SELECT id, document_number, total, issued_at, created_at, status, original_invoice_id,
           customer_nif, customer_name
    FROM ${table}
    WHERE LOWER(COALESCE(status, '')) IN ('issued', 'transmitted')
      AND (${parts.join(' OR ')})
    ORDER BY COALESCE(issued_at, created_at) ASC`;
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    console.warn(`[accountStatement] ${table} query skipped:`, err.message);
    return [];
  }
}

async function querySupplierPurchases(db, entityId, nif) {
  const params = [entityId];
  let nifClause = '';
  if (nif) {
    params.push(nif);
    nifClause = ` OR REPLACE(TRIM(COALESCE(supplier_nif, '')), ' ', '') = $${params.length}`;
  }
  const sql = `
    SELECT id, invoice_number, date, created_at, total, status, supplier_id,
           supplier_account_code, supplier_nif, supplier_name
    FROM purchase_invoices
    WHERE ${notVoidedSql('status')}
      AND LOWER(COALESCE(status, '')) NOT IN ('draft')
      AND (
        TRIM(COALESCE(supplier_id, '')) = $1
        OR TRIM(COALESCE(supplier_account_code, '')) = $1
        ${nifClause}
      )
    ORDER BY COALESCE(date, created_at) ASC`;
  try {
    return (await db.query(sql, params)).rows;
  } catch (err) {
    console.warn('[accountStatement] purchases query skipped:', err.message);
    return [];
  }
}

async function loadAccountStatement(db, entityType, entityId, { dateFrom, dateTo } = {}) {
  const party = normalizeParty(entityType);
  const id = String(entityId || '').trim();
  const [openItems, payments, row] = await Promise.all([
    queryOpenItems(db, party, id, dateFrom, dateTo),
    queryPayments(db, party, id, dateFrom, dateTo),
    loadPartyRow(db, party, id),
  ]);
  const nif = String(row?.nif || '').replace(/\s/g, '').trim();

  let sales = [];
  let creditNotes = [];
  let debitNotes = [];
  let purchases = [];

  if (party === 'customer') {
    sales = await queryCustomerSales(db, id, nif);
    const saleIds = sales.map((s) => String(s.id)).filter(Boolean);
    creditNotes = await queryCustomerNotes(db, 'credit_notes', id, nif, saleIds);
    debitNotes = await queryCustomerNotes(db, 'debit_notes', id, nif, saleIds);
  } else {
    purchases = await querySupplierPurchases(db, id, nif);
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

async function listStatementParties(db, entityType) {
  const party = normalizeParty(entityType);
  if (party === 'supplier') {
    const sql = `
      WITH ids AS (
        SELECT DISTINCT TRIM(entity_id) AS id
        FROM open_items
        WHERE LOWER(TRIM(COALESCE(entity_type, ''))) = 'supplier'
          AND TRIM(COALESCE(entity_id, '')) != ''
        UNION
        SELECT DISTINCT TRIM(entity_id)
        FROM payments
        WHERE LOWER(TRIM(COALESCE(entity_type, ''))) = 'supplier'
          AND TRIM(COALESCE(entity_id, '')) != ''
        UNION
        SELECT DISTINCT TRIM(supplier_id)
        FROM purchase_invoices
        WHERE TRIM(COALESCE(supplier_id, '')) != ''
          AND ${notVoidedSql('status')}
          AND LOWER(COALESCE(status, '')) NOT IN ('draft')
        UNION
        SELECT DISTINCT TRIM(supplier_account_code)
        FROM purchase_invoices
        WHERE TRIM(COALESCE(supplier_account_code, '')) != ''
          AND ${notVoidedSql('status')}
          AND LOWER(COALESCE(status, '')) NOT IN ('draft')
        UNION
        SELECT s.id
        FROM purchase_invoices pi
        JOIN suppliers s
          ON REPLACE(TRIM(COALESCE(pi.supplier_nif, '')), ' ', '')
           = REPLACE(TRIM(COALESCE(s.nif, '')), ' ', '')
        WHERE TRIM(COALESCE(pi.supplier_nif, '')) != ''
          AND ${notVoidedSql('pi.status')}
          AND LOWER(COALESCE(pi.status, '')) NOT IN ('draft')
      )
      SELECT s.id, s.name, s.nif, COALESCE(s.balance, 0) AS balance
      FROM suppliers s
      INNER JOIN ids ON ids.id = s.id
      ORDER BY s.name`;
    try {
      return (await db.query(sql)).rows;
    } catch (err) {
      console.warn('[accountStatement] supplier parties fallback:', err.message);
      const fallback = `
        SELECT DISTINCT s.id, s.name, s.nif, COALESCE(s.balance, 0) AS balance
        FROM suppliers s
        WHERE EXISTS (
          SELECT 1 FROM open_items oi
          WHERE oi.entity_type = 'supplier' AND oi.entity_id = s.id
        ) OR EXISTS (
          SELECT 1 FROM payments p
          WHERE p.entity_type = 'supplier' AND p.entity_id = s.id
        ) OR EXISTS (
          SELECT 1 FROM purchase_invoices pi
          WHERE pi.supplier_id = s.id AND ${notVoidedSql('pi.status')}
        )
        ORDER BY s.name`;
      return (await db.query(fallback)).rows;
    }
  }

  const sql = `
    WITH ids AS (
      SELECT DISTINCT TRIM(entity_id) AS id
      FROM open_items
      WHERE LOWER(TRIM(COALESCE(entity_type, ''))) IN ('customer', 'client')
        AND TRIM(COALESCE(entity_id, '')) != ''
      UNION
      SELECT DISTINCT TRIM(entity_id)
      FROM payments
      WHERE LOWER(TRIM(COALESCE(entity_type, ''))) IN ('customer', 'client')
        AND TRIM(COALESCE(entity_id, '')) != ''
      UNION
      SELECT DISTINCT TRIM(client_id)
      FROM sales
      WHERE TRIM(COALESCE(client_id, '')) != ''
        AND ${notVoidedSql('status')}
      UNION
      SELECT c.id
      FROM sales s
      JOIN clients c
        ON REPLACE(TRIM(COALESCE(s.customer_nif, '')), ' ', '')
         = REPLACE(TRIM(COALESCE(c.nif, '')), ' ', '')
      WHERE TRIM(COALESCE(s.customer_nif, '')) != ''
        AND ${notVoidedSql('s.status')}
    )
    SELECT c.id, c.name, c.nif, COALESCE(c.current_balance, 0) AS balance
    FROM clients c
    INNER JOIN ids ON ids.id = c.id
    ORDER BY c.name`;
  try {
    return (await db.query(sql)).rows;
  } catch (err) {
    console.warn('[accountStatement] customer parties fallback:', err.message);
    const fallback = `
      SELECT DISTINCT c.id, c.name, c.nif, COALESCE(c.current_balance, 0) AS balance
      FROM clients c
      WHERE EXISTS (
        SELECT 1 FROM open_items oi
        WHERE LOWER(TRIM(COALESCE(oi.entity_type, ''))) IN ('customer', 'client')
          AND oi.entity_id = c.id
      ) OR EXISTS (
        SELECT 1 FROM payments p
        WHERE LOWER(TRIM(COALESCE(p.entity_type, ''))) IN ('customer', 'client')
          AND p.entity_id = c.id
      ) OR EXISTS (
        SELECT 1 FROM sales s
        WHERE s.client_id = c.id AND ${notVoidedSql('s.status')}
      )
      ORDER BY c.name`;
    return (await db.query(fallback)).rows;
  }
}

module.exports = {
  normalizeParty,
  loadAccountStatement,
  listStatementParties,
};
