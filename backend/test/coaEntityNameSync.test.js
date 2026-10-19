/**
 * Renaming a 32x / 31x leaf in the chart must rename the matching supplier / client.
 * Isolated temp SQLite only.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

function assertIsolatedSqlite(harness) {
  assert.equal(process.env.DB_ENGINE, 'sqlite');
  assert.equal(process.env.DATABASE_URL, '');
  assert.notEqual(path.resolve(harness.testDbPath).toLowerCase(), path.resolve('C:\\nexor\\erp.db').toLowerCase());
}

describe('COA entity name sync', () => {
  let harness;
  let syncLinkedEntityNameFromCoa;
  let deleteLinkedEntityFromCoa;

  before(() => {
    harness = createSqliteHarness();
    assertIsolatedSqlite(harness);
    ({
      syncLinkedEntityNameFromCoa,
      deleteLinkedEntityFromCoa,
    } = require(path.join(BACKEND_SRC, 'lib/entityCoaAccounts')));
  });

  after(() => harness.dispose());

  it('renames the supplier when the 32x leaf name changes (NIF match)', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const supplierId = randomUUID();
    const nif = `5417${suffix}`;
    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'a@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [supplierId, `Old Supplier ${suffix}`, nif],
      );
      const result = await syncLinkedEntityNameFromCoa(client, {
        code: '32100091',
        oldName: `Old Supplier ${suffix}`,
        newName: `New Supplier ${suffix}`,
        description: `NIF: ${nif}`,
      });
      assert.equal(result.table, 'suppliers');
      assert.equal(result.updated, 1);
    });
    const row = await harness.db.query('SELECT name FROM suppliers WHERE id = $1', [supplierId]);
    assert.equal(row.rows[0].name, `New Supplier ${suffix}`);
  });

  it('renames the unique supplier when only the old name matches', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const supplierId = randomUUID();
    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'b@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [supplierId, `Solo Name ${suffix}`, `5001${suffix}`],
      );
      const result = await syncLinkedEntityNameFromCoa(client, {
        code: '32100092',
        oldName: `Solo Name ${suffix}`,
        newName: `Renamed Solo ${suffix}`,
      });
      assert.equal(result.updated, 1);
    });
    const row = await harness.db.query('SELECT name FROM suppliers WHERE id = $1', [supplierId]);
    assert.equal(row.rows[0].name, `Renamed Solo ${suffix}`);
  });

  it('does not rename two suppliers that share the same old name', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const a = randomUUID();
    const b = randomUUID();
    const shared = `Shared ${suffix}`;
    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'c@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [a, shared, `5002${suffix}`],
      );
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'd@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [b, shared, `5003${suffix}`],
      );
      const result = await syncLinkedEntityNameFromCoa(client, {
        code: '32100093',
        oldName: shared,
        newName: `Should Not Apply ${suffix}`,
      });
      assert.equal(result.updated, 0);
    });
    const rows = await harness.db.query('SELECT name FROM suppliers WHERE id IN ($1, $2)', [a, b]);
    assert.equal(rows.rows.every((r) => r.name === shared), true);
  });

  it('ignores PGC header codes such as 321', async () => {
    const result = await syncLinkedEntityNameFromCoa(harness.db, {
      code: '321',
      oldName: 'Fornecedores',
      newName: 'Should stay',
    });
    assert.equal(result.table, null);
    assert.equal(result.updated, 0);
  });

  it('deletes the matching supplier row when the 32x leaf is deleted', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const supplierId = randomUUID();
    const nif = `5418${suffix}`;
    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'e@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [supplierId, `Delete Me ${suffix}`, nif],
      );
      const result = await deleteLinkedEntityFromCoa(client, {
        code: '32100094',
        name: `Delete Me ${suffix}`,
        description: `NIF: ${nif}`,
      });
      assert.equal(result.table, 'suppliers');
      assert.equal(result.updated, 1);
    });
    const row = await harness.db.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
    assert.equal(row.rows.length, 0);
  });

  it('does not delete two suppliers that share the same name', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const a = randomUUID();
    const b = randomUUID();
    const shared = `Twin ${suffix}`;
    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'f@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [a, shared, `5004${suffix}`],
      );
      await client.query(
        `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
         VALUES ($1, $2, $3, 'g@test.ao', 1, 0, datetime('now'), datetime('now'))`,
        [b, shared, `5005${suffix}`],
      );
      const result = await deleteLinkedEntityFromCoa(client, {
        code: '32100095',
        name: shared,
      });
      assert.equal(result.updated, 0);
    });
    const rows = await harness.db.query('SELECT id FROM suppliers WHERE id IN ($1, $2)', [a, b]);
    assert.equal(rows.rows.length, 2);
  });
});
