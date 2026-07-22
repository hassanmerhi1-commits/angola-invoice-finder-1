/**
 * Customer receivables rows for reports, payments UI, and daily checklist.
 */
const { OPEN_ITEM_IS_DEBIT_SQL } = require('./openItemsSql');

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function mergeReceivableRows(openRows, orphanRows) {
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
async function listCustomerReceivables(db, options = {}) {
  const branchId = options.branchId ? String(options.branchId).trim() : '';
  const sinceDays = options.sinceDays ?? null;
  const since = sinceDays != null ? daysAgoIso(sinceDays) : null;
  const openLimit = options.openLimit ?? 500;
  const orphanLimit = options.orphanLimit ?? 200;

  const openParams = [];
  let openQuery = `
    SELECT oi.id, oi.entity_id, oi.document_id, oi.document_number, oi.document_date, oi.due_date,
           oi.remaining_amount, oi.original_amount, oi.document_type,
           COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(s.customer_name), ''), 'Cliente') AS client_name,
           COALESCE(c.nif, s.customer_nif, '') AS client_nif
    FROM open_items oi
    LEFT JOIN clients c ON c.id = oi.entity_id
    LEFT JOIN sales s ON s.id = oi.document_id
    WHERE oi.entity_type = 'customer'
      AND ${OPEN_ITEM_IS_DEBIT_SQL}
      AND oi.status != 'cleared'
      AND oi.remaining_amount > 0.01`;

  if (since) {
    openParams.push(since);
    openQuery += ` AND date(oi.document_date) >= date($${openParams.length})`;
  }
  if (branchId) {
    openParams.push(branchId);
    const { emptyBranchIdClause } = require('./sqlDialect');
    const emptyBranch = emptyBranchIdClause(db, 'oi.branch_id');
    const branchText = db.engine === 'postgres' ? 'oi.branch_id::text' : 'CAST(oi.branch_id AS TEXT)';
    openQuery += ` AND (${branchText} = $${openParams.length} OR ${emptyBranch})`;
  }
  openQuery += ` ORDER BY oi.due_date ASC NULLS LAST, client_name, oi.document_date ASC LIMIT ${openLimit}`;

  const openItems = await db.query(openQuery, openParams);

  let orphans = { rows: [] };
  try {
    let orphanQuery = `
      SELECT s.id, c.id AS entity_id, s.id AS document_id, s.invoice_number AS document_number,
             date(s.created_at) AS document_date, s.due_date,
             s.total AS remaining_amount, s.total AS original_amount, 'sale' AS document_type,
             COALESCE(NULLIF(TRIM(s.customer_name), ''), c.name, 'Cliente') AS client_name,
             COALESCE(s.customer_nif, c.nif, '') AS client_nif
      FROM sales s
      INNER JOIN clients c ON (
        (TRIM(COALESCE(s.client_id, '')) != '' AND c.id = s.client_id)
        OR (
          TRIM(COALESCE(s.customer_nif, '')) != ''
          AND TRIM(COALESCE(c.nif, '')) = TRIM(s.customer_nif)
        )
      )
      LEFT JOIN open_items oi ON oi.document_id = s.id
        AND oi.entity_type = 'customer'
        AND ${OPEN_ITEM_IS_DEBIT_SQL}
      WHERE s.status = 'completed'
        AND COALESCE(s.total, 0) > 0.01
        AND (
          LOWER(COALESCE(s.payment_method, '')) = 'credit'
          OR COALESCE(s.amount_paid, 0) < COALESCE(s.total, 0) - 0.01
        )
        AND (
          TRIM(COALESCE(s.client_id, '')) != ''
          OR TRIM(COALESCE(s.customer_nif, '')) != ''
        )
        AND oi.id IS NULL`;

    const orphanParams = [];
    if (since) {
      orphanParams.push(since);
      orphanQuery += ` AND date(s.created_at) >= date($${orphanParams.length})`;
    }
    if (branchId) {
      orphanParams.push(branchId);
      orphanQuery += ` AND s.branch_id = $${orphanParams.length}`;
    }
    orphanQuery += ` ORDER BY s.created_at DESC LIMIT ${orphanLimit}`;
    orphans = await db.query(orphanQuery, orphanParams);
  } catch (err) {
    console.warn('[RECEIVABLES] Sales orphan rows skipped:', err.message);
  }

  return mergeReceivableRows(openItems.rows, orphans.rows);
}

module.exports = {
  listCustomerReceivables,
  mergeReceivableRows,
};
