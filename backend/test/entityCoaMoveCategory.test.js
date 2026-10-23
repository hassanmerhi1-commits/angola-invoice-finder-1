/**
 * Supplier leaves under 321 can move into a category (3211) and keep their journals.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('supplier COA category move', () => {
  let harness;
  let nextEntityAccountCode;
  let moveEntityLeafToParent;
  let ensureSupplierSubAccount;

  before(() => {
    harness = createSqliteHarness();
    ({
      nextEntityAccountCode,
      moveEntityLeafToParent,
      ensureSupplierSubAccount,
    } = require(path.join(BACKEND_SRC, 'lib/entityCoaAccounts')));
  });

  after(() => harness.dispose());

  it('does not steal 3211 leaf numbers when allocating under 321', () => {
    const next = nextEntityAccountCode('321', ['32100001', '32110001'], ['3211']);
    assert.equal(next, '32100002');
  });

  it('moves a 321 leaf under 3211 and rewrites stored codes', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const parent321 = randomUUID();
    const cat3211 = randomUUID();
    const leafId = randomUUID();
    const journalId = randomUUID();
    const invoiceId = randomUUID();
    const name = `Fuel Co ${suffix}`;
    const nif = `5417${suffix}`;

    await harness.withClient(async (client) => {
      const existing321 = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '321' LIMIT 1`);
      const id321 = existing321.rows[0]?.id || parent321;
      if (!existing321.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '321', 'Fornecedores - correntes', 'liability', 'credit', NULL, 2, 0, 1)`,
          [id321],
        );
      }
      const existingCat = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '3211' LIMIT 1`);
      const idCat = existingCat.rows[0]?.id || cat3211;
      if (!existingCat.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '3211', 'Combustivel', 'liability', 'credit', $2, 3, 1, 1)`,
          [idCat, id321],
        );
      }
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, description, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, $2, $3, $4, 'liability', 'credit', $5, 3, 0, 1)`,
        [leafId, `32100${suffix.slice(0, 3)}`.slice(0, 8).padEnd(8, '0'), name, `NIF: ${nif}`, id321],
      );
      const leafCode = (await client.query(`SELECT code FROM chart_of_accounts WHERE id = $1`, [leafId])).rows[0].code;
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, description, is_posted)
         VALUES ($1, $2, date('now'), 'test', 1)`,
        [journalId, `JE-${suffix}`],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, $3, 0, 100)`,
        [randomUUID(), journalId, leafCode],
      );
      await client.query(
        `INSERT INTO purchase_invoices (id, invoice_number, supplier_account_code, supplier_name, date, total, status)
         VALUES ($1, $2, $3, $4, date('now'), 100, 'posted')`,
        [invoiceId, `FC-${suffix}`, leafCode, name],
      ).catch(() => {});

      const moved = await moveEntityLeafToParent(client, {
        accountId: leafId,
        parentCode: '3211',
      });
      assert.equal(moved.moved, true);
      assert.equal(moved.oldCode, leafCode);
      assert.equal(moved.newCode.startsWith('3211'), true);
      assert.equal(moved.newCode.length, 8);
      assert.equal(moved.parentCode, '3211');
    });

    const acc = await harness.db.query('SELECT code, parent_id FROM chart_of_accounts WHERE id = $1', [leafId]);
    assert.equal(String(acc.rows[0].code).startsWith('3211'), true);
    assert.equal(acc.rows[0].code.length, 8);

    const line = await harness.db.query(
      `SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [journalId],
    );
    assert.equal(String(line.rows[0].account_id), acc.rows[0].code);
  });

  it('creates a new supplier leaf under the chosen category', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const name = `Oil Depot ${suffix}`;
    let code = null;
    await harness.withClient(async (client) => {
      code = await ensureSupplierSubAccount(client, name, `5000${suffix}`, '3211');
    });
    assert.equal(String(code).startsWith('3211'), true);
    assert.equal(String(code).length, 8);
  });

  it('moves a cash leaf under a cash category with an 8-digit leaf code', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const parent45 = randomUUID();
    const catId = randomUUID();
    const leafId = randomUUID();
    const leafCode = `45${suffix.replace(/\D/g, '').slice(0, 2) || '88'}`;

    await harness.withClient(async (client) => {
      const existing45 = await client.query(`SELECT id FROM chart_of_accounts WHERE code = '45' LIMIT 1`);
      const id45 = existing45.rows[0]?.id || parent45;
      if (!existing45.rows[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '45', 'CAIXA', 'asset', 'debit', NULL, 1, 1, 1)`,
          [id45],
        );
      }
      const catCode = `459${suffix.slice(0, 1)}`;
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, $2, 'Caixa Soyo', 'asset', 'debit', $3, 2, 1, 1)`,
        [catId, catCode, id45],
      );
      await client.query(
        `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, $2, 'Caixa extra', 'asset', 'debit', $3, 2, 0, 1)`,
        [leafId, leafCode, id45],
      );

      const moved = await moveEntityLeafToParent(client, {
        accountId: leafId,
        parentCode: catCode,
      });
      assert.equal(moved.moved, true);
      assert.equal(moved.oldCode, leafCode);
      assert.equal(moved.newCode, `${catCode}${String(1).padStart(8 - catCode.length, '0')}`);
    });
  });
});
