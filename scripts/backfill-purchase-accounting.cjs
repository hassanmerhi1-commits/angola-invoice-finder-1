#!/usr/bin/env node
/** Post stock/payables for purchase invoices that were saved without accounting. */
const path = require('path');
const fs = require('fs');

function loadDbUrl() {
  const envPath = process.env.NEXOR_DATABASE_ENV || 'C:\\NEXOR ERP\\database.env';
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL=(.+)$/);
      if (m) return m[1].trim();
    }
  }
  return process.env.DATABASE_URL || '';
}

async function main() {
  const url = loadDbUrl();
  if (!url) throw new Error('DATABASE_URL not found');
  process.env.DATABASE_URL = url;
  process.env.DB_ENGINE = 'postgres';

  const db = require(path.join(__dirname, '../backend/src/db'));
  const { fromRow } = require(path.join(__dirname, '../backend/src/purchaseInvoiceMappers'));
  const { processTransactionBody } = require(path.join(__dirname, '../backend/src/transactionProcessor'));

  function buildBody(inv) {
    const lines = Array.isArray(inv.lines) ? inv.lines : [];
    const warehouseId = inv.warehouseId || inv.branchId;
    const stockEntries = lines
      .filter((l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0)
      .map((l) => ({
        productId: l.productId,
        productName: l.description || '',
        productSku: l.productCode || '',
        quantity: Number(l.totalQty || l.quantity || 0),
        unitCost: Number(l.unitPrice || 0),
        direction: 'IN',
        warehouseId,
      }));
    return {
      transactionType: 'purchase_invoice',
      documentId: inv.id,
      documentNumber: inv.invoiceNumber,
      branchId: inv.branchId || warehouseId,
      userId: inv.createdBy || 'system',
      userName: inv.createdByName || '',
      date: inv.date,
      currency: inv.currency || 'KZ',
      description: `Fatura de Compra ${inv.invoiceNumber}`,
      amount: Number(inv.total || 0),
      stockEntries,
      priceUpdates: stockEntries.map((e) => ({
        productId: e.productId,
        newUnitCost: e.unitCost,
        quantityReceived: e.quantity,
        updateAvgCost: true,
      })),
      journalLines: (inv.journalLines || []).map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountName,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        note: l.note,
      })),
      openItem: {
        entityType: 'supplier',
        entityId: inv.supplierId,
        entityName: inv.supplierName,
        documentType: 'invoice',
        originalAmount: Number(inv.total || 0),
        isDebit: true,
        dueDate: inv.paymentDate,
        currency: inv.currency === 'KZ' ? 'AOA' : inv.currency,
      },
      entityBalanceUpdate: {
        entityType: 'supplier',
        entityId: inv.supplierId,
        entityName: inv.supplierName,
        amount: Number(inv.total || 0),
      },
    };
  }

  const missing = await db.query(
    `SELECT pi.id, pi.invoice_number
     FROM purchase_invoices pi
     LEFT JOIN stock_movements sm
       ON sm.reference_id = pi.id
      AND sm.reference_type IN ('purchase_invoice', 'purchase')
     WHERE COALESCE(pi.status, 'confirmed') NOT IN ('cancelled', 'voided', 'draft')
       AND sm.id IS NULL
     ORDER BY pi.created_at DESC
     LIMIT 200`,
  );

  console.log(`Found ${missing.rows.length} invoice(s) without stock movements`);
  let posted = 0;
  let failed = 0;

  for (const row of missing.rows) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const saved = await client.query('SELECT * FROM purchase_invoices WHERE id = $1', [row.id]);
      const inv = fromRow(saved.rows[0]);
      const result = await processTransactionBody(client, buildBody(inv));
      await client.query('COMMIT');
      posted += 1;
      console.log('OK', inv.invoiceNumber, 'stock=', result.stockMovementIds?.length);
    } catch (err) {
      await client.query('ROLLBACK');
      failed += 1;
      console.error('FAIL', row.invoice_number, err.message);
    } finally {
      client.release();
    }
  }

  console.log(`Done: posted=${posted} failed=${failed}`);
  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
