#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function loadDbUrl() {
  const envPath = process.env.NEXOR_DATABASE_ENV || 'C:\\NEXOR ERP\\database.env';
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^DATABASE_URL=(.+)$/);
    if (m) return m[1].trim();
  }
  return process.env.DATABASE_URL || '';
}

async function main() {
  process.env.DATABASE_URL = loadDbUrl();
  process.env.DB_ENGINE = 'postgres';
  const db = require(path.join(__dirname, '../backend/src/db'));
  const { fromRow } = require(path.join(__dirname, '../backend/src/purchaseInvoiceMappers'));
  const { processTransactionBody } = require(path.join(__dirname, '../backend/src/transactionProcessor'));

  const invNo = process.argv[2] || 'FC-MAIN-2026-3389';
  const saved = await db.query('SELECT * FROM purchase_invoices WHERE invoice_number = $1', [invNo]);
  if (!saved.rows[0]) throw new Error(`Invoice not found: ${invNo}`);
  const inv = fromRow(saved.rows[0]);

  const lines = Array.isArray(inv.lines) ? inv.lines : [];
  const warehouseId = inv.warehouseId || inv.branchId;
  const body = {
    transactionType: 'purchase_invoice',
    documentId: inv.id,
    documentNumber: inv.invoiceNumber,
    branchId: inv.branchId || warehouseId,
    userId: inv.createdBy || 'system',
    date: inv.date,
    currency: inv.currency || 'KZ',
    description: `Test repost ${inv.invoiceNumber}`,
    amount: Number(inv.total || 0),
    stockEntries: lines
      .filter((l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: Number(l.totalQty || l.quantity || 0),
        unitCost: Number(l.unitPrice || 0),
        direction: 'IN',
        warehouseId,
      })),
    priceUpdates: lines
      .filter((l) => l.productId && Number(l.totalQty || l.quantity || 0) > 0)
      .map((l) => ({
        productId: l.productId,
        newUnitCost: Number(l.unitPrice || 0),
        quantityReceived: Number(l.totalQty || l.quantity || 0),
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

  const before = await db.query(
    'SELECT COUNT(*)::int AS c FROM stock_movements WHERE reference_id = $1',
    [inv.id],
  );
  console.log('Before:', before.rows[0].c, 'movements for', inv.id);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const txResult = await processTransactionBody(client, body);
    const inTx = await client.query(
      'SELECT COUNT(*)::int AS c FROM stock_movements WHERE reference_id = $1',
      [inv.id],
    );
    console.log('In transaction (before commit):', inTx.rows[0].c, 'txResult', txResult);
    await client.query('COMMIT');
    console.log('COMMIT ok');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const after = await db.query(
    'SELECT COUNT(*)::int AS c FROM stock_movements WHERE reference_id = $1',
    [inv.id],
  );
  console.log('After commit (pool.query):', after.rows[0].c);

  const je = await db.query(
    'SELECT COUNT(*)::int AS c FROM journal_entries WHERE reference_id = $1',
    [inv.id],
  );
  console.log('Journal entries:', je.rows[0].c);

  await db.pool.end();
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
