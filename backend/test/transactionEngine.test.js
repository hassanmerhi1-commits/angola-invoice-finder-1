/**
 * Transaction engine integration tests (SQLite, real schema).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, seedSupplierAndProduct, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('transactionEngine', { concurrency: 1 }, () => {
  let harness;
  let engine;

  before(() => {
    harness = createSqliteHarness();
    engine = require(path.join(BACKEND_SRC, 'transactionEngine'));
  });

  after(() => {
    harness?.dispose();
  });

  it('records stock IN and reports quantity via getStock', async () => {
    await harness.withClient(async (client) => {
      const { productId, branchId, userId } = await seedSupplierAndProduct(client);

      await engine.recordStockMovement(client, {
        productId,
        warehouseId: branchId,
        movementType: 'IN',
        quantity: 25,
        unitCost: 10,
        referenceType: 'adjustment',
        referenceId: randomUUID(),
        referenceNumber: 'ADJ-001',
        createdBy: userId,
      });

      const stock = await engine.getStock(productId, branchId);
      assert.equal(stock, 25);
    });
  });

  it('allows stock OUT on filial row when legacy stock lives on another SKU row', async () => {
    await harness.withClient(async (client) => {
      const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
      const sku = `OMO-${suffix}`;
      const filialId = randomUUID();
      const catalogId = randomUUID();

      await client.query(
        `INSERT INTO branches (id, code, name, is_active, created_at, updated_at)
         VALUES ($1, 'SOYO', 'Soyo', 1, datetime('now'), datetime('now'))`,
        [filialId],
      );

      await client.query(
        `INSERT INTO products (id, name, sku, stock, cost, is_active, branch_id, created_at, updated_at)
         VALUES ($1, 'Detergente OMO HQ', $2, 10, 5, 1, NULL, datetime('now'), datetime('now'))`,
        [catalogId, sku],
      );

      await client.query(
        `INSERT INTO products (id, name, sku, stock, cost, is_active, branch_id, created_at, updated_at)
         VALUES ($1, 'Detergente OMO', $2, 0, 5, 1, $3, datetime('now'), datetime('now'))`,
        [randomUUID(), sku, filialId],
      );

      await engine.recordStockMovement(client, {
        productId: catalogId,
        warehouseId: filialId,
        movementType: 'OUT',
        quantity: 2,
        unitCost: 5,
        referenceType: 'sale',
        referenceId: randomUUID(),
        referenceNumber: 'POS-TEST',
        createdBy: 'user-admin',
      });

      const filialRows = await client.query(
        `SELECT stock FROM products WHERE LOWER(TRIM(sku)) = LOWER($1) AND branch_id = $2`,
        [sku, filialId],
      );
      assert.ok(filialRows.rows.length >= 1);
      for (const row of filialRows.rows) {
        assert.ok(Number(row.stock) >= 0);
      }
      assert.equal(await engine.getStock(catalogId, filialId), 8);
    });
  });

  it('rejects stock OUT when quantity exceeds available', async () => {
    await harness.withClient(async (client) => {
      const { productId, branchId, userId } = await seedSupplierAndProduct(client);

      await engine.recordStockMovement(client, {
        productId,
        warehouseId: branchId,
        movementType: 'IN',
        quantity: 5,
        unitCost: 10,
        referenceType: 'adjustment',
        referenceId: randomUUID(),
        referenceNumber: 'ADJ-002',
        createdBy: userId,
      });

      await assert.rejects(
        () =>
          engine.recordStockMovement(client, {
            productId,
            warehouseId: branchId,
            movementType: 'OUT',
            quantity: 100,
            unitCost: 10,
            referenceType: 'sale',
            referenceId: randomUUID(),
            referenceNumber: 'SALE-001',
            createdBy: userId,
          }),
        (err) => /stock insuficiente/i.test(err.message),
      );
    });
  });

  it('clears supplier invoice open item when payment is applied', async () => {
    await harness.withClient(async (client) => {
      const { supplierId, branchId, userId } = await seedSupplierAndProduct(client);
      const invoiceId = randomUUID();
      const invoiceNumber = 'PINV-TEST-001';
      const amount = 1500;

      await engine.createOpenItem(client, {
        entityType: 'supplier',
        entityId: supplierId,
        documentType: 'purchase_invoice',
        documentId: invoiceId,
        documentNumber: invoiceNumber,
        documentDate: new Date().toISOString().split('T')[0],
        originalAmount: amount,
        isDebit: true,
        branchId,
      });

      await engine.processPayment(client, {
        paymentType: 'payment',
        entityType: 'supplier',
        entityId: supplierId,
        entityName: 'Test Supplier Ltd',
        paymentMethod: 'cash',
        amount,
        branchId,
        createdBy: userId,
        invoiceIds: [invoiceId],
      });

      const openResult = await client.query(
        `SELECT remaining_amount, status FROM open_items WHERE document_id = $1`,
        [invoiceId],
      );
      assert.equal(openResult.rows.length, 1);
      assert.ok(Number(openResult.rows[0].remaining_amount) <= 0.01);
      assert.equal(openResult.rows[0].status, 'cleared');
    });
  });
});
