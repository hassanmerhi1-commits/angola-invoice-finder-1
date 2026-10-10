/**
 * Branch inventory grid: one row per SKU, qty from this warehouse's ledger, catalog SKUs at 0.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('branch inventory grid', { concurrency: 1 }, () => {
  let harness;
  let listGrid;

  before(() => {
    harness = createSqliteHarness();
    const cols = harness.db.sqlite.pragma('table_info(products)').map((c) => c.name);
    if (!cols.includes('vat_override')) {
      harness.db.sqlite.exec('ALTER TABLE products ADD COLUMN vat_override INTEGER DEFAULT 0');
    }
    ({ listProductsForBranchInventoryGrid: listGrid } = require(path.join(BACKEND_SRC, 'routes/products')));
  });

  after(() => {
    harness?.dispose();
  });

  it('picks the local row, ignores -DUP- copies for display and keeps catalog SKUs at 0', async () => {
    const hqId = 'branch-main';
    const filialId = randomUUID();
    const tag = randomUUID().slice(0, 6);
    const sku = (s) => `${s}-${tag}`;
    const ids = {
      catalogOnly: randomUUID(),
      sharedCatalog: randomUUID(),
      sharedLocal: randomUUID(),
      dupCatalog: randomUUID(),
      dupCopy: randomUUID(),
      inactiveLocal: randomUUID(),
    };

    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO branches (id, code, name, is_main, is_active, created_at, updated_at)
         VALUES ($1, $2, 'Soyo 02', 0, 1, datetime('now'), datetime('now'))`,
        [filialId, `SY${tag}`],
      );
      const product = (id, name, s, branchId, active = 1) => client.query(
        `INSERT INTO products (id, name, sku, stock, cost, price, is_active, branch_id, created_at, updated_at)
         VALUES ($1, $2, $3, 999, 10, 25, $4, $5, datetime('now'), datetime('now'))`,
        [id, name, s, active, branchId],
      );
      const movement = (productId, warehouseId, type, qty) => client.query(
        `INSERT INTO stock_movements
           (id, product_id, warehouse_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 1, 'adjustment', $6, datetime('now'))`,
        [randomUUID(), productId, warehouseId, type, qty, randomUUID()],
      );

      await product(ids.catalogOnly, 'Catalog only', sku('A'), hqId);
      await movement(ids.catalogOnly, hqId, 'IN', 40);

      await product(ids.sharedCatalog, 'Shared HQ', sku('B'), hqId);
      await product(ids.sharedLocal, 'Shared local', sku('B'), filialId);
      await movement(ids.sharedLocal, filialId, 'IN', 9);
      await movement(ids.sharedLocal, filialId, 'OUT', 2);

      await product(ids.dupCatalog, 'Dup master', sku('C'), hqId);
      await product(ids.dupCopy, 'Dup copy', `${sku('C')}-DUP-${tag}`, filialId);
      await movement(ids.dupCopy, filialId, 'IN', 3);

      await product(ids.inactiveLocal, 'Old local', sku('D'), filialId, 0);
      await movement(ids.inactiveLocal, filialId, 'IN', 5);
    });

    const filial = new Map((await listGrid(filialId))
      .filter((r) => String(r.sku).endsWith(tag) || String(r.sku).includes(`${tag}-DUP-`))
      .map((r) => [String(r.sku).replace(/-DUP-.*$/i, ''), r]));

    assert.equal(filial.get(sku('A'))?.id, ids.catalogOnly);
    assert.equal(Number(filial.get(sku('A'))?.stock), 0, 'HQ stock must not leak into the filial');
    assert.equal(filial.get(sku('A'))?.branch_id, filialId);

    assert.equal(filial.get(sku('B'))?.id, ids.sharedLocal);
    assert.equal(Number(filial.get(sku('B'))?.stock), 7);

    assert.equal(filial.get(sku('C'))?.id, ids.dupCatalog, '-DUP- copy is never the display row');
    assert.equal(Number(filial.get(sku('C'))?.stock), 3, 'qty posted on the -DUP- copy still counts');

    assert.equal(filial.get(sku('D'))?.id, ids.inactiveLocal, 'inactive row with stock here stays visible');
    assert.equal(Number(filial.get(sku('D'))?.stock), 5);

    const hq = new Map((await listGrid(hqId)).map((r) => [String(r.sku), r]));
    assert.equal(Number(hq.get(sku('A'))?.stock), 40);
    assert.equal(Number(hq.get(sku('B'))?.stock), 0);
  });
});
