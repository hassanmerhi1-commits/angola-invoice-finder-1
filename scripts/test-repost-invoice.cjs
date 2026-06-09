#!/usr/bin/env node
/** Simulate repost-accounting for one orphan invoice — surfaces the real error. */
const path = require('path');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:yel3an7azi@127.0.0.1:5432/kwanza_erp';
process.env.DB_ENGINE = 'postgres';

const db = require(path.join(__dirname, '../backend/src/db'));
const { processTransactionBody } = require(path.join(__dirname, '../backend/src/transactionProcessor'));
const { fromRow } = require(path.join(__dirname, '../backend/src/purchaseInvoiceMappers'));

async function buildBody(inv) {
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

async function main() {
  const invoiceNo = process.argv[2] || 'FC-MAIN-2026-3389';
  const saved = await db.query('SELECT * FROM purchase_invoices WHERE invoice_number = $1 LIMIT 1', [invoiceNo]);
  if (!saved.rows[0]) throw new Error(`Invoice not found: ${invoiceNo}`);
  const inv = fromRow(saved.rows[0]);
  console.log('Invoice', inv.invoiceNumber, 'lines', inv.lines?.length, 'warehouse', inv.warehouseId);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const body = await buildBody(inv);
    console.log('stockEntries', body.stockEntries.length, body.stockEntries[0]);
    const result = await processTransactionBody(client, body);
    await client.query('ROLLBACK');
    console.log('SUCCESS (rolled back):', JSON.stringify(result, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
