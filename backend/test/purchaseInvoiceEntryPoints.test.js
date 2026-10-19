/**
 * Every purchase-invoice entry point must use the protected posting service.
 * Isolated temp SQLite only.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, seedSupplierAndProduct, BACKEND_SRC } = require('./helpers/sqliteHarness');

const QTY = 10;
const UNIT_COST = 100;
const GOODS = QTY * UNIT_COST;

function assertIsolatedSqlite(harness) {
  assert.equal(process.env.DB_ENGINE, 'sqlite');
  assert.equal(process.env.DATABASE_URL, '');
  assert.notEqual(path.resolve(harness.testDbPath).toLowerCase(), path.resolve('C:\\nexor\\erp.db').toLowerCase());
}

async function insertPurchaseInvoice(client, fields) {
  const id = fields.id || randomUUID();
  await client.query(
    `INSERT INTO purchase_invoices (
       id, invoice_number, supplier_id, supplier_name, date, order_no,
       warehouse_id, branch_id, branch_name, lines_json,
       subtotal, iva_total, total, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'confirmed',$14)`,
    [
      id,
      fields.invoiceNumber,
      fields.supplierId,
      fields.supplierName,
      fields.date,
      fields.orderNo || '',
      fields.branchId,
      fields.branchId,
      'Main Branch',
      JSON.stringify(fields.lines),
      fields.subtotal,
      fields.taxAmount || 0,
      fields.total,
      fields.createdBy,
    ],
  );
  return { id, ...fields, warehouseId: fields.branchId, status: 'confirmed' };
}

async function stockQty(client, productId, warehouseId) {
  const res = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity ELSE -quantity END), 0) AS qty
     FROM stock_movements WHERE product_id = $1 AND warehouse_id = $2`,
    [productId, warehouseId],
  );
  return Number(res.rows[0].qty);
}

async function debit212(client, documentIds) {
  const ids = documentIds.map((id) => String(id));
  const res = await client.query(
    `SELECT COALESCE(SUM(jel.debit_amount), 0) AS amount
     FROM journal_entry_lines jel
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE TRIM(coa.code) = '212'
       AND CAST(je.reference_id AS TEXT) IN (${ids.map((_, i) => `$${i + 1}`).join(', ')})`,
    ids,
  );
  return Number(res.rows[0].amount);
}

describe('purchase invoice entry points', { concurrency: 1 }, () => {
  let harness;
  let engine;
  let processTransactionBody;
  let upsertPurchaseInvoice;
  let postPurchaseInvoiceAccountingPhased;

  before(() => {
    harness = createSqliteHarness();
    assertIsolatedSqlite(harness);
    engine = require(path.join(BACKEND_SRC, 'transactionEngine'));
    ({ processTransactionBody } = require(path.join(BACKEND_SRC, 'transactionProcessor')));
    ({ upsertPurchaseInvoice } = require(path.join(BACKEND_SRC, 'sync/purchaseInvoiceUpsert')));
    ({ postPurchaseInvoiceAccountingPhased } = require(path.join(BACKEND_SRC, 'lib/purchaseInvoicePosting')));
  });

  after(() => {
    harness?.dispose();
  });

  async function receivePurchaseOrder(client, seed) {
    const order = await engine.createPurchaseOrder(client, {
      supplierId: seed.supplierId,
      branchId: seed.branchId,
      createdBy: seed.userId,
      items: [{
        productId: seed.productId,
        productName: 'Entry Widget',
        sku: 'ENT-1',
        quantity: QTY,
        unitCost: UNIT_COST,
        taxRate: 0,
        subtotal: GOODS,
      }],
    });
    await engine.processPurchaseReceive(client, order.id, { [seed.productId]: QTY }, seed.userId);
    return order;
  }

  function invoiceLines(seed) {
    return [{
      productId: seed.productId,
      quantity: QTY,
      totalQty: QTY,
      unitPrice: UNIT_COST,
      total: GOODS,
    }];
  }

  it('processTransactionBody cannot double-receive after a PO receive', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-TX-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-04-01',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: invoiceLines(seed),
        subtotal: GOODS,
        total: GOODS,
      });

      const posted = await processTransactionBody(client, {
        transactionType: 'purchase_invoice',
        documentId: inv.id,
        documentNumber: inv.invoiceNumber,
        branchId: seed.branchId,
        userId: seed.userId,
        date: '2026-04-01',
        description: 'bypass attempt',
        stockEntries: [{
          productId: seed.productId,
          quantity: QTY,
          unitCost: UNIT_COST,
          direction: 'IN',
          warehouseId: seed.branchId,
        }],
        journalLines: [
          { accountCode: '212', debit: GOODS, credit: 0 },
          { accountCode: '321', debit: 0, credit: GOODS },
        ],
      });

      assert.equal(await stockQty(client, seed.productId, seed.branchId), QTY);
      assert.equal(await debit212(client, [order.id, inv.id]), GOODS);
      assert.equal(posted.success, true);
      assert.ok(posted.openItemId);
    });
  });

  it('processTransactionBody rejects a purchase_invoice without a saved header', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      await assert.rejects(
        () => processTransactionBody(client, {
          transactionType: 'purchase_invoice',
          documentId: randomUUID(),
          documentNumber: 'FC-MISSING',
          branchId: seed.branchId,
          userId: seed.userId,
          date: '2026-04-02',
          stockEntries: [{
            productId: seed.productId,
            quantity: QTY,
            unitCost: UNIT_COST,
            warehouseId: seed.branchId,
          }],
        }),
        /não encontrada|documentId/i,
      );
      assert.equal(await stockQty(client, seed.productId, seed.branchId), 0);
    });
  });

  it('standalone FC still posts stock, AP and GL through processTransactionBody', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const inv = await insertPurchaseInvoice(client, {
        invoiceNumber: 'FC-TX-SOLO',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-04-03',
        orderNo: '',
        branchId: seed.branchId,
        createdBy: seed.userId,
        lines: invoiceLines(seed),
        subtotal: GOODS,
        total: GOODS,
      });
      const posted = await processTransactionBody(client, {
        transactionType: 'purchase_invoice',
        documentId: inv.id,
        documentNumber: inv.invoiceNumber,
        branchId: seed.branchId,
        userId: seed.userId,
        date: '2026-04-03',
      });
      assert.equal(posted.success, true);
      assert.equal(await stockQty(client, seed.productId, seed.branchId), QTY);
      assert.ok(posted.openItemId);
      assert.ok(posted.journalEntryId);
    });
  });

  it('ingest-shaped upsert+post uses the protected service (no second IN)', async () => {
    await harness.withClient(async (client) => {
      const seed = await seedSupplierAndProduct(client);
      const supplier = await client.query('SELECT name FROM suppliers WHERE id = $1', [seed.supplierId]);
      const order = await receivePurchaseOrder(client, seed);
      const invoiceId = randomUUID();
      await upsertPurchaseInvoice(client, {
        id: invoiceId,
        invoiceNumber: 'FC-INGEST-1',
        supplierId: seed.supplierId,
        supplierName: supplier.rows[0].name,
        date: '2026-04-04',
        orderNo: '',
        warehouseId: seed.branchId,
        branchId: seed.branchId,
        lines: invoiceLines(seed),
        subtotal: GOODS,
        total: GOODS,
        status: 'confirmed',
        createdBy: seed.userId,
      });
      const saved = await client.query('SELECT * FROM purchase_invoices WHERE id = $1', [invoiceId]);
      const { fromRow } = require(path.join(BACKEND_SRC, 'purchaseInvoiceMappers'));
      const posted = await postPurchaseInvoiceAccountingPhased(client, fromRow(saved.rows[0]));
      assert.equal(posted.success, true);
      assert.equal(await stockQty(client, seed.productId, seed.branchId), QTY);
      assert.equal(await debit212(client, [order.id, invoiceId]), GOODS);
      assert.ok(posted.openItemId);
    });
  });
});
