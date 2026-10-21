/**
 * Creating category 3211 must not die on "account already exists" when an old
 * compact supplier leaf already occupies that number.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('supplier COA claim compact codes', () => {
  let harness;
  let nextCompactChildCode;
  let claimChartAccountCode;
  let findEntityLeafCode;
  let ensureSupplierSubAccount;

  before(() => {
    harness = createSqliteHarness();
    ({
      nextCompactChildCode,
      claimChartAccountCode,
      findEntityLeafCode,
      ensureSupplierSubAccount,
    } = require(path.join(BACKEND_SRC, 'lib/entityCoaAccounts')));
  });

  after(() => harness.dispose());

  it('skips occupied compact slots when suggesting the next category', () => {
    assert.equal(nextCompactChildCode('321', ['3211', '3212', '32100001']), '3213');
    assert.equal(nextCompactChildCode('321', ['32100001']), '3211');
  });

  it('finds an old compact 3211 supplier leaf by name', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const name = `Old Fuel ${suffix}`;
    const leafId = randomUUID();
    await harness.withClient(async (client) => {
      const existing321 = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '321' LIMIT 1`);
      const id321 = existing321.rows[0]?.id || randomUUID();
      if (!existing321.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '321', 'Fornecedores - correntes', 'liability', 'credit', NULL, 2, 0, 1)`,
          [id321],
        );
      }
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '3211', $2, $3, 'liability', 'credit', $4, 3, 0, 1)`,
        [leafId, name, `NIF: 5417${suffix}`, id321],
      );
      const found = await findEntityLeafCode(client, '32', '321', name, `5417${suffix}`);
      assert.equal(found, '3211');
    });
  });

  it('moves an occupying 3211 leaf to 8 digits so a category can use 3211', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const name = `Compact Leaf ${suffix}`;
    const leafId = randomUUID();
    let recoded;
    await harness.withClient(async (client) => {
      const existing321 = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '321' LIMIT 1`);
      const id321 = existing321.rows[0]?.id || randomUUID();
      if (!existing321.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '321', 'Fornecedores - correntes', 'liability', 'credit', NULL, 2, 0, 1)`,
          [id321],
        );
      }
      await client.query(`DELETE FROM chart_of_accounts WHERE code = '3211'`);
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '3211', $2, $3, 'liability', 'credit', $4, 3, 0, 1)`,
        [leafId, name, `NIF: 5000${suffix}`, id321],
      );
      const claim = await claimChartAccountCode(client, { code: '3211', isHeader: true });
      assert.equal(claim.action, 'insert');
      assert.equal(claim.recoded?.oldCode, '3211');
      recoded = claim.recoded;
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '3211', 'Combustivel', 'liability', 'credit', $2, 3, 1, 1)`,
        [randomUUID(), id321],
      );
    });
    const leaf = await harness.db.query('SELECT code FROM chart_of_accounts WHERE id = $1', [leafId]);
    assert.equal(String(leaf.rows[0].code).length, 8);
    assert.equal(String(leaf.rows[0].code).startsWith('321'), true);
    assert.notEqual(leaf.rows[0].code, '3211');
    assert.equal(recoded.newCode, leaf.rows[0].code);
    const header = await harness.db.query(`SELECT name, is_header FROM chart_of_accounts WHERE code = '3211'`);
    assert.equal(header.rows[0].name, 'Combustivel');
  });

  it('reuses an existing 3211 header instead of saying the code is taken', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const rowId = randomUUID();
    await harness.withClient(async (client) => {
      await client.query(`DELETE FROM chart_of_accounts WHERE code = '3214'`);
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '3214', $2, 'liability', 'credit', NULL, 3, 1, 1)`,
        [rowId, `PGC leftover ${suffix}`],
      );
      const claim = await claimChartAccountCode(client, { code: '3214', isHeader: true });
      assert.equal(claim.action, 'reuse');
      assert.equal(claim.row.id, rowId);
    });
  });

  it('reactivates an unused inactive 3212 instead of colliding', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const rowId = randomUUID();
    await harness.withClient(async (client) => {
      await client.query(`DELETE FROM chart_of_accounts WHERE code = '3212'`);
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '3212', $2, 'liability', 'credit', NULL, 3, 1, 0)`,
        [rowId, `Dead category ${suffix}`],
      );
      const claim = await claimChartAccountCode(client, { code: '3212', isHeader: true });
      assert.equal(claim.action, 'reuse');
      assert.equal(claim.row.id, rowId);
    });
  });

  it('creates a new supplier under 321 without taking a 3211 leaf number', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const name = `Direct 321 ${suffix}`;
    let code = null;
    await harness.withClient(async (client) => {
      const existing321 = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '321' LIMIT 1`);
      const id321 = existing321.rows[0]?.id || randomUUID();
      if (!existing321.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '321', 'Fornecedores - correntes', 'liability', 'credit', NULL, 2, 0, 1)`,
          [id321],
        );
      }
      const existingCat = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '3211' LIMIT 1`);
      if (!existingCat.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '3211', 'Combustivel', 'liability', 'credit', $2, 3, 1, 1)`,
          [randomUUID(), id321],
        );
      }
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '32110001', 'Fuel Co', 'liability', 'credit', $2, 4, 0, 1)`,
        [randomUUID(), existingCat.rows[0]?.id || id321],
      ).catch(() => {});
      code = await ensureSupplierSubAccount(client, name, `6000${suffix}`, '321');
    });
    assert.ok(code);
    assert.equal(String(code).length, 8);
    assert.equal(String(code).startsWith('3211'), false);
  });
});
