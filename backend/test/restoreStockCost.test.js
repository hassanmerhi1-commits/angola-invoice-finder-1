const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, seedSupplierAndProduct, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('restoreStockAtCurrentCost', { concurrency: 1 }, () => {
  let harness;
  let engine;

  before(() => {
    harness = createSqliteHarness();
    engine = require(path.join(BACKEND_SRC, 'transactionEngine'));
  });

  after(() => {
    harness?.dispose();
  });

  it('uses avg_cost, never posts a zero-cost IN that would dilute WAC', async () => {
    await harness.withClient(async (client) => {
      const { productId, branchId, userId } = await seedSupplierAndProduct(client);
      await client.query(
        `UPDATE products SET stock = 10, cost = 8, avg_cost = 8 WHERE id = $1`,
        [productId],
      );

      const cogs = await engine.restoreStockAtCurrentCost(client, {
        productId,
        warehouseId: branchId,
        quantity: 2,
        referenceType: 'void',
        referenceId: randomUUID(),
        referenceNumber: 'FT-VOID-1',
        createdBy: userId,
        notes: 'test void restore',
      });

      assert.equal(cogs, 16);

      const mov = await client.query(
        `SELECT unit_cost, quantity, movement_type FROM stock_movements
         WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [productId],
      );
      assert.equal(String(mov.rows[0].movement_type).toUpperCase(), 'IN');
      assert.equal(Number(mov.rows[0].unit_cost), 8);
      assert.notEqual(Number(mov.rows[0].unit_cost), 0);

      const prod = await client.query(`SELECT avg_cost, cost FROM products WHERE id = $1`, [productId]);
      assert.ok(Math.abs(Number(prod.rows[0].avg_cost) - 8) < 0.0001);
    });
  });

  it('productInventoryUnitCost prefers avg_cost over last purchase cost', () => {
    assert.equal(engine.productInventoryUnitCost({ cost: 3, avg_cost: 9 }), 9);
    assert.equal(engine.productInventoryUnitCost({ cost: 3, avg_cost: null }), 3);
    assert.equal(engine.productInventoryUnitCost(null), 0);
  });
});
