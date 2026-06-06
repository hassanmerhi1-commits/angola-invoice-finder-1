/**
 * Supplier accounts-payable rows for reports, payments UI, and daily briefing.
 */
const { OPEN_ITEM_IS_DEBIT_SQL } = require('./openItemsSql');

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function mergePayableRows(openRows, orphanRows) {
  const byDoc = new Map();
  for (const row of [...(openRows || []), ...(orphanRows || [])]) {
    const key = String(row.document_id || row.id || '');
    if (!key || byDoc.has(key)) continue;
    byDoc.set(key, row);
  }
  return [...byDoc.values()];
}

/**
 * @param {import('../db')} db
 * @param {{ branchId?: string, sinceDays?: number|null, openLimit?: number, orphanLimit?: number }} options
 */
async function listSupplierPayables(db, options = {}) {
  const branchId = options.branchId ? String(options.branchId).trim() : '';
  const sinceDays = options.sinceDays ?? null;
  const since = sinceDays != null ? daysAgoIso(sinceDays) : null;
  const openLimit = options.openLimit ?? 500;
  const orphanLimit = options.orphanLimit ?? 500;

  const payablesParams = [];
  let payablesQuery = `
    SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
           oi.remaining_amount, oi.original_amount, oi.document_type,
           COALESCE(NULLIF(TRIM(s.name), ''), NULLIF(TRIM(pi.supplier_name), ''), 'Fornecedor') AS supplier_name,
           COALESCE(s.nif, pi.supplier_nif, '') AS supplier_nif,
           COALESCE(s.payment_terms, '30_days') AS payment_terms
    FROM open_items oi
    LEFT JOIN suppliers s ON s.id = oi.entity_id
    LEFT JOIN purchase_invoices pi ON pi.id = oi.document_id
    WHERE oi.entity_type = 'supplier'
      AND ${OPEN_ITEM_IS_DEBIT_SQL}
      AND oi.status != 'cleared'
      AND oi.remaining_amount > 0.01`;

  if (since) {
    payablesParams.push(since);
    payablesQuery += ` AND date(oi.document_date) >= date($${payablesParams.length})`;
  }
  if (branchId) {
    payablesParams.push(branchId);
    payablesQuery += ` AND (oi.branch_id = $${payablesParams.length} OR oi.branch_id IS NULL OR TRIM(COALESCE(oi.branch_id, '')) = '')`;
  }
  payablesQuery += ` ORDER BY oi.due_date ASC NULLS LAST, supplier_name, oi.document_date ASC LIMIT ${openLimit}`;

  let payablesOrphanQuery = `
    SELECT pi.id, pi.supplier_id AS entity_id, pi.id AS document_id, pi.invoice_number AS document_number,
           pi.date AS document_date, pi.payment_date AS due_date, pi.total AS remaining_amount,
           pi.total AS original_amount, 'purchase_invoice' AS document_type,
           COALESCE(NULLIF(TRIM(pi.supplier_name), ''), 'Fornecedor') AS supplier_name,
           COALESCE(s.nif, pi.supplier_nif, '') AS supplier_nif,
           COALESCE(s.payment_terms, '30_days') AS payment_terms
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON s.id = pi.supplier_id
    LEFT JOIN open_items oi ON oi.document_id = pi.id
      AND oi.entity_type = 'supplier'
      AND ${OPEN_ITEM_IS_DEBIT_SQL}
    WHERE COALESCE(pi.status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
      AND COALESCE(pi.total, 0) > 0.01
      AND TRIM(COALESCE(pi.supplier_id, '')) != ''
      AND oi.id IS NULL`;

  const payablesOrphanParams = [];
  if (since) {
    payablesOrphanParams.push(since);
    payablesOrphanQuery += ` AND date(pi.date) >= date($${payablesOrphanParams.length})`;
  }
  if (branchId) {
    payablesOrphanParams.push(branchId);
    payablesOrphanQuery += ` AND (pi.branch_id = $${payablesOrphanParams.length} OR pi.warehouse_id = $${payablesOrphanParams.length})`;
  }
  payablesOrphanQuery += ` ORDER BY pi.date DESC LIMIT ${orphanLimit}`;

  const [payables, payablesOrphan] = await Promise.all([
    db.query(payablesQuery, payablesParams),
    db.query(payablesOrphanQuery, payablesOrphanParams),
  ]);

  return mergePayableRows(payables.rows, payablesOrphan.rows);
}

module.exports = {
  listSupplierPayables,
  mergePayableRows,
};
