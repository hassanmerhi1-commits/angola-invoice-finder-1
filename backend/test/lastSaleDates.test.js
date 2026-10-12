/**
 * Dead-stock report: last sale per canonical SKU, across every branch row of the SKU.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('last sale dates by SKU', { concurrency: 1 }, () => {
  let harness;
  let loadLastSaleDates;

  before(() => {
    harness = createSqliteHarness();
    ({ loadLastSaleDatesBySku: loadLastSaleDates } = require(path.join(BACKEND_SRC, 'routes/products')));
  });

  after(() => {
    harness?.dispose();
  });

  it('merges -DUP- rows, falls back to the product SKU, skips voided and filters by branch', async () => {
    const tag = randomUUID().slice(0, 6).toLowerCase();
    const filialA = randomUUID();
    const filialB = randomUUID();
    const productNoLineSku = randomUUID();

    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO products (id, name, sku, stock, cost, price, is_active, branch_id, created_at, updated_at)
         VALUES ($1, 'From product', $2, 0, 1, 2, 1, $3, datetime('now'), datetime('now'))`,
        [productNoLineSku, `p-${tag}`, filialA],
      );
      const sale = async (branchId, createdAt, status, items) => {
        const saleId = randomUUID();
        await client.query(
          `INSERT INTO sales (id, invoice_number, branch_id, total, status, created_at, updated_at)
           VALUES ($1, $2, $3, 10, $4, $5, $5)`,
          [saleId, `FT-${saleId.slice(0, 6)}`, branchId, status, createdAt],
        );
        for (const item of items) {
          await client.query(
            `INSERT INTO sale_items (id, sale_id, product_id, product_name, sku, quantity, unit_price, subtotal)
             VALUES ($1, $2, $3, 'x', $4, 1, 10, 10)`,
            [randomUUID(), saleId, item.productId || null, item.sku ?? null],
          );
        }
      };
      const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

      await sale(filialA, daysAgo(40), 'completed', [{ sku: `S-${tag}` }]);
      await sale(filialB, daysAgo(5), 'completed', [{ sku: `S-${tag}-DUP-${tag}` }]);
      await sale(filialA, daysAgo(1), 'voided', [{ sku: `S-${tag}` }]);
      await sale(filialA, daysAgo(3), 'completed', [{ productId: productNoLineSku, sku: '' }]);
      await sale(filialA, daysAgo(500), 'completed', [{ sku: `OLD-${tag}` }]);
    });

    const all = new Map((await loadLastSaleDates(null)).map((r) => [r.sku_key, r.last_sale]));
    const recent = all.get(`s-${tag}`);
    assert.ok(recent, 'SKU with a -DUP- copy is one key');
    const ageDays = (Date.now() - new Date(recent).getTime()) / 86_400_000;
    assert.ok(ageDays > 4 && ageDays < 6, `newest non-voided sale wins (got ${ageDays.toFixed(1)} days)`);
    assert.ok(all.has(`p-${tag}`), 'line without SKU uses its product SKU');
    assert.ok(!all.has(`old-${tag}`), 'sales older than a year are ignored');

    const onlyA = new Map((await loadLastSaleDates(filialA)).map((r) => [r.sku_key, r.last_sale]));
    const ageA = (Date.now() - new Date(onlyA.get(`s-${tag}`)).getTime()) / 86_400_000;
    assert.ok(ageA > 39 && ageA < 41, 'branch filter excludes the other filial');
  });
});
