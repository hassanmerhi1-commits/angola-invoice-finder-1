/**
 * Reconcile supplier payable balance with open_items (invoice vs return).
 * Fixes stale suppliers.balance after purchase returns posted before open-item linking.
 */
const db = require('./db');
const { OPEN_ITEM_IS_DEBIT_SQL } = require('./lib/openItemsSql');
const { createOpenItem, syncSupplierBalanceFromOpenItems } = require('./transactionEngine');

const UPDATE_OPEN_ITEM_REMAINING = `
  UPDATE open_items SET
    remaining_amount = remaining_amount - $1,
    status = CASE WHEN remaining_amount - $1 <= 0.01 THEN 'cleared' ELSE 'partial' END,
    cleared_at = CASE WHEN remaining_amount - $1 <= 0.01 THEN CURRENT_TIMESTAMP ELSE cleared_at END
  WHERE id = $2`;

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
    await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, invoiceRow.id]);
    await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, creditRow.id]);
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

      await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, invoiceRow.id]);

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
          await db.query(UPDATE_OPEN_ITEM_REMAINING, [credApplied, creditOi.rows[0].id]);
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
       SELECT SUM(
         CASE WHEN oi.is_debit = 1 OR oi.is_debit = TRUE THEN oi.remaining_amount ELSE -oi.remaining_amount END
       )
       FROM open_items oi
       WHERE oi.entity_type = 'supplier' AND oi.entity_id = suppliers.id
         AND oi.status != 'cleared'
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

async function fixMisclassifiedSupplierReturnOpenItems() {
  if (!await tableExists('open_items')) return { fixed: 0 };

  const result = await db.query(
    `UPDATE open_items SET is_debit = 0
     WHERE entity_type = 'supplier'
       AND (is_debit = 1 OR is_debit = TRUE)
       AND (
         document_type IN ('credit_note', 'supplier_return', 'purchase_return')
         OR document_id IN (
           SELECT source_id FROM document_links
           WHERE target_type IN ('fatura_compra', 'purchase_invoice')
         )
       )`
  );
  return { fixed: result.rowCount || 0 };
}

/**
 * Payments recorded without selecting invoices leave matching debit/credit open items uncleared.
 * Apply unallocated payment credits to open supplier invoices (FIFO).
 */
async function zeroClearedOpenItemRemainders() {
  if (!await tableExists('open_items')) return { fixed: 0 };
  const result = await db.query(
    `UPDATE open_items SET remaining_amount = 0
     WHERE status = 'cleared' AND remaining_amount > 0.01`,
  );
  return { fixed: result.rowCount || 0 };
}

/** Net supplier credits (payments, returns) against open payables until balanced. */
async function netSupplierOpenItems() {
  if (!await tableExists('open_items')) return { repaired: 0 };

  const entities = await db.query(
    `SELECT DISTINCT entity_id FROM open_items
     WHERE entity_type = 'supplier' AND status != 'cleared' AND remaining_amount > 0.01`,
  );

  let repaired = 0;
  for (const row of entities.rows || []) {
    const entityId = row.entity_id;
    let progressed = true;
    while (progressed) {
      progressed = false;
      const debit = await db.query(
        `SELECT id, remaining_amount FROM open_items
         WHERE entity_type = 'supplier' AND entity_id = $1
           AND (is_debit = 1 OR is_debit = TRUE)
           AND status != 'cleared' AND remaining_amount > 0.01
         ORDER BY document_date ASC LIMIT 1`,
        [entityId],
      );
      const credit = await db.query(
        `SELECT id, remaining_amount FROM open_items
         WHERE entity_type = 'supplier' AND entity_id = $1
           AND (is_debit = 0 OR is_debit = FALSE)
           AND status != 'cleared' AND remaining_amount > 0.01
         ORDER BY document_date ASC LIMIT 1`,
        [entityId],
      );
      if (!debit.rows[0] || !credit.rows[0]) break;

      const applied = Math.min(
        Number(debit.rows[0].remaining_amount || 0),
        Number(credit.rows[0].remaining_amount || 0),
      );
      if (applied <= 0.001) break;

      await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, debit.rows[0].id]);
      await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, credit.rows[0].id]);
      repaired += 1;
      progressed = true;
    }
  }

  return { repaired };
}

/**
 * PO receipt and purchase invoice can both create payables.
 * When an FC exists for the same order number, clear the duplicate PO open item.
 */
async function deduplicateSupplierPoInvoiceOpenItems() {
  if (!await tableExists('open_items') || !await tableExists('purchase_orders')) {
    return { cleared: 0 };
  }

  let cleared = 0;
  const poItems = await db.query(
    `SELECT oi.id AS po_oi_id, oi.entity_id, oi.remaining_amount, po.order_number
     FROM open_items oi
     INNER JOIN purchase_orders po ON po.id = oi.document_id
     WHERE oi.entity_type = 'supplier'
       AND (oi.is_debit = 1 OR oi.is_debit = TRUE)
       AND oi.status != 'cleared'
       AND oi.remaining_amount > 0.01`,
  );

  for (const row of poItems.rows || []) {
    const orderNo = String(row.order_number || '').trim();
    if (!orderNo) continue;

    let invId = null;
    try {
      const inv = await db.query(
        'SELECT id FROM purchase_invoices WHERE order_no = $1 LIMIT 1',
        [orderNo],
      );
      invId = inv.rows[0]?.id;
    } catch {
      continue;
    }
    if (!invId) continue;

    const invOi = await db.query(
      `SELECT id FROM open_items
       WHERE entity_type = 'supplier' AND entity_id = $1 AND document_id = $2
         AND (is_debit = 1 OR is_debit = TRUE)
       LIMIT 1`,
      [row.entity_id, invId],
    );
    if (!invOi.rows[0]) continue;

    await db.query(
      `UPDATE open_items SET remaining_amount = 0, status = 'cleared', cleared_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.po_oi_id],
    );
    cleared += 1;
  }

  return { cleared };
}

/** PO receipt and purchase invoice can both create payables; clear PO when invoice is already settled. */
async function clearOrphanPurchaseOrderOpenItems() {
  if (!await tableExists('open_items') || !await tableExists('purchase_orders')) {
    return { cleared: 0 };
  }

  let cleared = 0;
  const poItems = await db.query(
    `SELECT oi.id AS po_oi_id, oi.entity_id, oi.remaining_amount, po.id AS po_id, po.order_number
     FROM open_items oi
     INNER JOIN purchase_orders po ON po.id = oi.document_id
     WHERE oi.entity_type = 'supplier'
       AND (oi.is_debit = 1 OR oi.is_debit = TRUE)
       AND oi.status != 'cleared'
       AND oi.remaining_amount > 0.01`,
  );

  for (const row of poItems.rows || []) {
    const orderNo = String(row.order_number || '').trim();
    if (!orderNo) continue;

    let invId = null;
    try {
      const inv = await db.query(
        'SELECT id FROM purchase_invoices WHERE order_no = $1 LIMIT 1',
        [orderNo],
      );
      invId = inv.rows[0]?.id;
    } catch {
      continue;
    }
    if (!invId) continue;

    const invOi = await db.query(
      `SELECT id, status, remaining_amount FROM open_items
       WHERE entity_type = 'supplier' AND entity_id = $1 AND document_id = $2
         AND (is_debit = 1 OR is_debit = TRUE)
       ORDER BY created_at DESC LIMIT 1`,
      [row.entity_id, invId],
    );
    const invRow = invOi.rows[0];
    if (!invRow) continue;

    const invRem = Number(invRow.remaining_amount || 0);
    const invCleared = invRow.status === 'cleared' || invRem <= 0.01;
    if (!invCleared) continue;

    const poRem = Number(row.remaining_amount || 0);
    if (poRem <= 0.01) continue;

    await db.query(
      `UPDATE open_items SET remaining_amount = 0, status = 'cleared', cleared_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [row.po_oi_id],
    );
    cleared += 1;
  }

  return { cleared };
}

async function repairUnallocatedSupplierPayments() {
  if (!await tableExists('open_items')) return { repaired: 0 };

  const payments = await db.query(
    `SELECT id, entity_id, remaining_amount, document_number
     FROM open_items
     WHERE entity_type = 'supplier'
       AND document_type = 'payment'
       AND (is_debit = 0 OR is_debit = FALSE)
       AND status != 'cleared'
       AND remaining_amount > 0.01
     ORDER BY document_date ASC`
  );

  let repaired = 0;

  for (const pay of payments.rows || []) {
    let remaining = Number(pay.remaining_amount || 0);
    if (remaining <= 0.01) continue;

    const debits = await db.query(
      `SELECT id, remaining_amount FROM open_items
       WHERE entity_type = 'supplier' AND entity_id = $1
         AND (is_debit = 1 OR is_debit = TRUE)
         AND status != 'cleared'
         AND remaining_amount > 0.01
       ORDER BY document_date ASC`,
      [pay.entity_id],
    );

    for (const inv of debits.rows || []) {
      if (remaining <= 0.001) break;
      const invRem = Number(inv.remaining_amount || 0);
      if (invRem <= 0.001) continue;
      const applied = Math.min(remaining, invRem);
      await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, inv.id]);
      await db.query(UPDATE_OPEN_ITEM_REMAINING, [applied, pay.id]);
      remaining -= applied;
      repaired += 1;
    }
  }

  return { repaired };
}

/**
 * Purchase invoices saved without processTransaction never created supplier open_items.
 * Creates missing debit open items so AP reports and Payments work.
 */
async function backfillMissingSupplierOpenItems() {
  if (!(await tableExists('open_items')) || !(await tableExists('purchase_invoices'))) {
    return { created: 0, skipped: 0 };
  }

  const missing = await db.query(
    `SELECT pi.id, pi.invoice_number, pi.supplier_id, pi.supplier_name, pi.date, pi.payment_date,
            pi.total, pi.branch_id, pi.currency
     FROM purchase_invoices pi
     LEFT JOIN open_items oi ON oi.document_id = pi.id
       AND oi.entity_type = 'supplier'
       AND ${OPEN_ITEM_IS_DEBIT_SQL}
     WHERE COALESCE(pi.status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
       AND COALESCE(pi.total, 0) > 0.01
       AND TRIM(COALESCE(pi.supplier_id, '')) != ''
       AND oi.id IS NULL
     ORDER BY pi.date ASC
     LIMIT 500`,
  );

  const rows = missing.rows || [];
  if (!rows.length) return { created: 0, skipped: 0 };

  const client = await db.pool.connect();
  let created = 0;
  let skipped = 0;
  const touchedSuppliers = new Set();

  try {
    await client.query('BEGIN');
    for (const pi of rows) {
      const docDate = String(pi.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const dueDate = pi.payment_date ? String(pi.payment_date).slice(0, 10) : null;
      try {
        await createOpenItem(client, {
          entityType: 'supplier',
          entityId: String(pi.supplier_id),
          documentType: 'invoice',
          documentId: String(pi.id),
          documentNumber: String(pi.invoice_number || pi.id),
          documentDate: docDate,
          dueDate,
          originalAmount: Number(pi.total || 0),
          isDebit: true,
          branchId: pi.branch_id || null,
          currency: pi.currency || 'AOA',
        });
        created += 1;
        touchedSuppliers.add(String(pi.supplier_id));
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

  if (touchedSuppliers.size > 0) {
    const syncClient = await db.pool.connect();
    try {
      for (const supplierId of touchedSuppliers) {
        try {
          await syncSupplierBalanceFromOpenItems(syncClient, supplierId);
        } catch (_) {
          /* best effort */
        }
      }
    } finally {
      syncClient.release();
    }
  }

  if (created > 0) {
    console.log(`[DB] Backfilled ${created} supplier payable open item(s) from purchase_invoices`);
  }
  return { created, skipped };
}

async function runSupplierBalanceRepair() {
  try {
    const backfill = await backfillMissingSupplierOpenItems();
    const zeroed = await zeroClearedOpenItemRemainders();
    const misclassified = await fixMisclassifiedSupplierReturnOpenItems();
    const poDeduped = await deduplicateSupplierPoInvoiceOpenItems();
    const poCleared = await clearOrphanPurchaseOrderOpenItems();
    const linkRepair = await repairSupplierReturnOpenItems();
    const paymentRepair = await repairUnallocatedSupplierPayments();
    const netted = await netSupplierOpenItems();
    const balanceSync = await backfillSupplierBalancesFromOpenItems();
    if (
      backfill.created > 0 ||
      zeroed.fixed > 0 ||
      misclassified.fixed > 0 ||
      poCleared.cleared > 0 ||
      linkRepair.repaired > 0 ||
      paymentRepair.repaired > 0 ||
      netted.repaired > 0 ||
      balanceSync.updated > 0
    ) {
      console.log(
        `[DB] Supplier balance repair: ${backfill.created} payable backfill(s), ${zeroed.fixed} cleared-row fix(es), ${misclassified.fixed} return reclass, ${poDeduped.cleared} PO/FC dedup(s), ${poCleared.cleared} orphan PO clear(s), ${linkRepair.repaired} return link(s), ${paymentRepair.repaired} payment alloc(s), ${netted.repaired} credit/debit net(s), ${balanceSync.updated} balance sync(s)`
      );
    }
    return { ...backfill, ...zeroed, ...misclassified, ...poCleared, ...linkRepair, ...paymentRepair, ...netted, ...balanceSync };
  } catch (error) {
    console.warn('[DB] Supplier balance repair skipped:', error.message);
    return { repaired: 0, updated: 0, error: error.message };
  }
}

module.exports = {
  runSupplierBalanceRepair,
  backfillMissingSupplierOpenItems,
  repairSupplierReturnOpenItems,
  repairUnallocatedSupplierPayments,
  backfillSupplierBalancesFromOpenItems,
};
