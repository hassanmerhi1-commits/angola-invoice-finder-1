/**
 * Backfill customer receivable open items for credit sales that posted without one.
 */
const db = require('./db');
const { OPEN_ITEM_IS_DEBIT_SQL } = require('./lib/openItemsSql');
const { normalizeSqlDate } = require('./lib/dateSql');
const { createOpenItem, syncClientBalanceFromOpenItems } = require('./transactionEngine');

async function tableExists(name) {
  try {
    const r = await db.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
      [name],
    );
    return (r.rows || []).length > 0;
  } catch {
    return false;
  }
}

/**
 * Credit / on-account sales saved without an open item (schema bug, old deploy, etc.).
 */
async function backfillMissingCustomerOpenItems() {
  if (!(await tableExists('open_items')) || !(await tableExists('sales'))) {
    return { created: 0, skipped: 0 };
  }

  const missing = await db.query(
    `SELECT s.id, s.invoice_number, s.client_id, s.branch_id, s.total, s.due_date,
            date(s.created_at) AS document_date
     FROM sales s
     LEFT JOIN open_items oi ON oi.document_id = s.id
       AND oi.entity_type = 'customer'
       AND ${OPEN_ITEM_IS_DEBIT_SQL}
     WHERE s.status = 'completed'
       AND LOWER(COALESCE(s.payment_method, '')) = 'credit'
       AND TRIM(COALESCE(s.client_id, '')) != ''
       AND COALESCE(s.total, 0) > 0.01
       AND oi.id IS NULL
     ORDER BY s.created_at ASC
     LIMIT 500`,
  );

  const rows = missing.rows || [];
  if (!rows.length) return { created: 0, skipped: 0 };

  const client = await db.pool.connect();
  let created = 0;
  let skipped = 0;
  const touchedClients = new Set();

  try {
    await client.query('BEGIN');
    for (const sale of rows) {
      const docDate = normalizeSqlDate(sale.document_date, { allowNull: false });
      const dueDate = normalizeSqlDate(sale.due_date);
      try {
        await createOpenItem(client, {
          entityType: 'customer',
          entityId: String(sale.client_id),
          documentType: 'invoice',
          documentId: String(sale.id),
          documentNumber: String(sale.invoice_number || sale.id),
          documentDate: docDate,
          dueDate,
          originalAmount: Number(sale.total || 0),
          isDebit: true,
          branchId: sale.branch_id || null,
        });
        created += 1;
        touchedClients.add(String(sale.client_id));
      } catch (err) {
        if (/já registado|already|duplicate/i.test(String(err.message || ''))) {
          skipped += 1;
          continue;
        }
        throw err;
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (touchedClients.size > 0) {
    const syncClient = await db.pool.connect();
    try {
      for (const clientId of touchedClients) {
        try {
          await syncClientBalanceFromOpenItems(syncClient, clientId);
        } catch (_) {
          /* best effort */
        }
      }
    } finally {
      syncClient.release();
    }
  }

  if (created > 0) {
    console.log(`[DB] Backfilled ${created} customer receivable open item(s) from credit sales`);
  }
  return { created, skipped };
}

module.exports = {
  backfillMissingCustomerOpenItems,
};
