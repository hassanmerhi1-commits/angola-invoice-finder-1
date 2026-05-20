/**
 * Reconcile supplier payable balance with open_items (invoice vs return).
 * Fixes stale suppliers.balance after purchase returns posted before open-item linking.
 */
const db = require('./db');

async function resolveSupplierPayableDocumentIds(invoiceId) {
  const ids = [];
  if (invoiceId) ids.push(String(invoiceId));

  try {
    const inv = await db.query(
      'SELECT order_no FROM purchase_invoices WHERE id = $1 LIMIT 1',
      [invoiceId]
    );
    const orderNo = String(inv.rows[0]?.order_no || '').trim();
    if (orderNo) {
      const po = await db.query(
        'SELECT id FROM purchase_orders WHERE order_number = $1 LIMIT 1',
        [orderNo]
      );
      if (po.rows[0]?.id) ids.push(String(po.rows[0].id));
    }
  } catch {
    /* optional tables */
  }

  return [...new Set(ids.filter(Boolean))];
}

async function findSupplierInvoiceOpenItem(invoiceId) {
  const documentIds = await resolveSupplierPayableDocumentIds(invoiceId);
  for (const docId of documentIds) {
    const invoiceOi = await db.query(
      `SELECT id, remaining_amount, entity_id FROM open_items
       WHERE entity_type = 'supplier'
         AND document_id = $1
         AND is_debit = 1
         AND status != 'cleared'
       ORDER BY created_at ASC
       LIMIT 1`,
      [docId]
    );
    if (invoiceOi.rows[0]) return invoiceOi.rows[0];
  }
  return null;
}

async function repairSupplierReturnOpenItems() {
  if (!await tableExists('open_items')) return { repaired: 0 };

  const linksResult = await db.query(
    `SELECT target_id AS invoice_id, source_id AS return_id
     FROM document_links
     WHERE target_type IN ('fatura_compra', 'purchase_invoice')`
  );
  let repaired = 0;

  for (const link of linksResult.rows || []) {
    const invoiceId = link.invoice_id;
    const returnId = link.return_id;
    if (!invoiceId || !returnId) continue;

    const invoiceRow = await findSupplierInvoiceOpenItem(invoiceId);
    const creditOi = await db.query(
      `SELECT id, remaining_amount FROM open_items
       WHERE document_id = $1
         AND (is_debit = 0 OR is_debit = FALSE)
         AND status != 'cleared'
       ORDER BY created_at ASC
       LIMIT 1`,
      [returnId]
    );

    const creditRow = creditOi.rows[0];
    if (!invoiceRow || !creditRow) continue;

    const invRem = Number(invoiceRow.remaining_amount || 0);
    const credRem = Number(creditRow.remaining_amount || 0);
    if (invRem <= 0 || credRem <= 0) continue;

    const applied = Math.min(invRem, credRem);
    const updateOi = `
      UPDATE open_items SET
        remaining_amount = remaining_amount - $1,
        status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
        cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE cleared_at END
      WHERE id = $2`;
    await db.query(updateOi, [applied, invoiceRow.id]);
    await db.query(updateOi, [applied, creditRow.id]);
    repaired += 1;
  }

  // Returns stored without document_links: match supplier_returns.purchase_order_id → invoice
  if (await tableExists('supplier_returns')) {
    const returnsResult = await db.query(
      `SELECT id, purchase_order_id AS invoice_id, supplier_id, total
       FROM supplier_returns
       WHERE status != 'cancelled' AND purchase_order_id IS NOT NULL AND TRIM(purchase_order_id) != ''`
    );

    for (const ret of returnsResult.rows || []) {
      const invoiceRow = await findSupplierInvoiceOpenItem(ret.invoice_id);
      if (!invoiceRow) continue;

      const returnAmount = Number(ret.total || 0);
      if (returnAmount <= 0) continue;

      const invRem = Number(invoiceRow.remaining_amount || 0);
      if (invRem <= 0) continue;

      const applied = Math.min(invRem, returnAmount);

      await db.query(
        `UPDATE open_items SET
           remaining_amount = remaining_amount - $1,
           status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
           cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE cleared_at END
         WHERE id = $2`,
        [applied, invoiceRow.id]
      );

      // Clear orphan credit open item for this return document if present
      const creditOi = await db.query(
        `SELECT id, remaining_amount FROM open_items
         WHERE document_id = $1 AND (is_debit = 0 OR is_debit = FALSE) AND status != 'cleared'
         LIMIT 1`,
        [ret.id]
      );
      if (creditOi.rows[0]) {
        const credRem = Number(creditOi.rows[0].remaining_amount || 0);
        const credApplied = Math.min(credRem, applied);
        if (credApplied > 0) {
          await db.query(
            `UPDATE open_items SET
               remaining_amount = remaining_amount - $1,
               status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
               cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE cleared_at END
             WHERE id = $2`,
            [credApplied, creditOi.rows[0].id]
          );
        }
      }

      repaired += 1;
    }
  }

  return { repaired };
}

async function backfillSupplierBalancesFromOpenItems() {
  if (!await tableExists('suppliers') || !await tableExists('open_items')) return { updated: 0 };

  const result = await db.query(
    `UPDATE suppliers SET balance = COALESCE((
       SELECT SUM(CASE WHEN oi.is_debit = 1 OR oi.is_debit = TRUE THEN oi.remaining_amount ELSE -oi.remaining_amount END)
       FROM open_items oi
       WHERE oi.entity_type = 'supplier' AND oi.entity_id = suppliers.id
     ), 0)`
  );

  return { updated: result.rowCount || 0 };
}

async function tableExists(name) {
  if (db.engine === 'postgres') {
    const r = await db.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`,
      [name]
    );
    return r.rows.length > 0;
  }
  const r = await db.query(
    `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = $1 LIMIT 1`,
    [name]
  );
  return r.rows.length > 0;
}

async function runSupplierBalanceRepair() {
  try {
    const linkRepair = await repairSupplierReturnOpenItems();
    const balanceSync = await backfillSupplierBalancesFromOpenItems();
    if (linkRepair.repaired > 0 || balanceSync.updated > 0) {
      console.log(
        `[DB] Supplier balance repair: ${linkRepair.repaired} return(s) applied to invoice open items, ${balanceSync.updated} supplier balance(s) synced`
      );
    }
    return { ...linkRepair, ...balanceSync };
  } catch (error) {
    console.warn('[DB] Supplier balance repair skipped:', error.message);
    return { repaired: 0, updated: 0, error: error.message };
  }
}

module.exports = {
  runSupplierBalanceRepair,
  repairSupplierReturnOpenItems,
  backfillSupplierBalancesFromOpenItems,
};
