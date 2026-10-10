/**
 * Qtd detalhada must match HQ inventory-grid totals (movement ledger, incl. -dup-).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('stockBySku vs inventory grid', { concurrency: 1 }, () => {
  let harness;
  let listStockBySku;
  let resolveProductIdsForMovementSku;

  before(() => {
    harness = createSqliteHarness();
    ({ listStockBySku } = require(path.join(BACKEND_SRC, 'lib/stockBySku')));
    ({ resolveProductIdsForMovementSku } = require(path.join(BACKEND_SRC, 'lib/productSkuResolve')));
  });

  after(() => {
    harness?.dispose();
  });

  it('includes -dup- copies and warehouse ledger, not stale products.stock', async () => {
    await harness.withClient(async (client) => {
      const hqId = 'branch-main';
      const filialId = randomUUID();
      const catalogId = randomUUID();
      const dupId = randomUUID();
      const sku = `101000080-${randomUUID().slice(0, 8)}`;
      const filialCode = `SY${randomUUID().replace(/-/g, '').slice(0, 6)}`;

      await client.query(
        `INSERT INTO branches (id, code, name, is_main, is_active, created_at, updated_at)
         VALUES ($1, $2, 'Soyo 01', 0, 1, datetime('now'), datetime('now'))`,
        [filialId, filialCode],
      );

      await client.query(
        `INSERT INTO products (id, name, sku, stock, cost, is_active, branch_id, created_at, updated_at)
         VALUES ($1, 'Artigo HQ', $2, 31473, 1, 1, $3, datetime('now'), datetime('now'))`,
        [catalogId, sku, hqId],
      );
      await client.query(
        `INSERT INTO products (id, name, sku, stock, cost, is_active, branch_id, created_at, updated_at)
         VALUES ($1, 'Artigo dup', $2, 0, 1, 1, $3, datetime('now'), datetime('now'))`,
        [dupId, `${sku}-DUP-${dupId.replace(/-/g, '').slice(0, 8)}`, filialId],
      );

      await client.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_at)
         VALUES ($1, $2, $3, 'IN', 31473, 1, 'adjustment', $4, datetime('now'))`,
        [randomUUID(), catalogId, hqId, randomUUID()],
      );
      await client.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_at)
         VALUES ($1, $2, $3, 'IN', 3868, 1, 'adjustment', $4, datetime('now'))`,
        [randomUUID(), dupId, filialId.replace(/-/g, ''), randomUUID()],
      );

      const ids = await resolveProductIdsForMovementSku(client, sku, catalogId);
      assert.ok(ids.includes(catalogId));
      assert.ok(ids.includes(dupId));

      const { rows } = await listStockBySku(client, sku, catalogId);
      const byCode = new Map(rows.map((r) => [String(r.branchCode), r.stock]));
      assert.equal(byCode.get('MAIN'), 31473);
      assert.equal(byCode.get(filialCode), 3868);
      const total = rows.reduce((sum, r) => sum + Number(r.stock || 0), 0);
      assert.equal(total, 35341);
    });
  });
});
