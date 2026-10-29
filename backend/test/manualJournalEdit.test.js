/**
 * A journal typed by hand (adjustment) can be edited in place.
 * A sale journal cannot.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('manual journal edit', () => {
  let harness;
  let createJournalEntry;
  let updateJournalEntry;

  before(() => {
    harness = createSqliteHarness();
    ({ createJournalEntry, updateJournalEntry } = require(path.join(BACKEND_SRC, 'accounting')));
  });

  after(() => harness.dispose());

  async function balanceOf(client, code) {
    const row = await client.query(
      'SELECT current_balance FROM chart_of_accounts WHERE code = $1',
      [code],
    );
    return Number(row.rows[0]?.current_balance || 0);
  }

  it('replaces lines and date on a typed journal and moves the account balances', async () => {
    await harness.withClient(async (client) => {
      const beforeCash = await balanceOf(client, '451');
      const beforeIncome = await balanceOf(client, '613');

      const created = await createJournalEntry(client, {
        description: 'Ajuste de caixa',
        referenceType: 'adjustment',
        branchId: null,
        entryDate: '2026-10-20',
        lines: [
          { accountCode: '451', description: 'Ajuste de caixa', debit: 100, credit: 0 },
          { accountCode: '613', description: 'Ajuste de caixa', debit: 0, credit: 100 },
        ],
      });

      const updated = await updateJournalEntry(client, created.id, {
        description: 'Ajuste corrigido',
        entryDate: '2026-10-21',
        lines: [
          { accountCode: '451', description: 'Ajuste corrigido', debit: 40, credit: 0 },
          { accountCode: '613', description: 'Ajuste corrigido', debit: 0, credit: 40 },
        ],
      });

      assert.equal(updated.entry_number, created.entry_number);
      assert.equal(updated.total_debit, 40);
      assert.equal(updated.total_credit, 40);

      const header = await client.query(
        'SELECT entry_date, description, reference_type FROM journal_entries WHERE id = $1',
        [created.id],
      );
      assert.equal(String(header.rows[0].entry_date).slice(0, 10), '2026-10-21');
      assert.equal(header.rows[0].description, 'Ajuste corrigido');
      assert.equal(header.rows[0].reference_type, 'adjustment');

      const lines = await client.query(
        `SELECT coa.code AS code, jel.debit_amount AS debit, jel.credit_amount AS credit
           FROM journal_entry_lines jel
           JOIN chart_of_accounts coa ON coa.id = jel.account_id
          WHERE jel.journal_entry_id = $1
          ORDER BY jel.debit_amount DESC`,
        [created.id],
      );
      assert.equal(lines.rows.length, 2);
      assert.equal(lines.rows[0].code, '451');
      assert.equal(Number(lines.rows[0].debit), 40);
      assert.equal(lines.rows[1].code, '613');
      assert.equal(Number(lines.rows[1].credit), 40);

      assert.equal(await balanceOf(client, '451'), beforeCash + 40);
      assert.equal(await balanceOf(client, '613'), beforeIncome - 40);
    });
  });

  it('refuses to edit a sale journal', async () => {
    await harness.withClient(async (client) => {
      const created = await createJournalEntry(client, {
        description: 'Venda',
        referenceType: 'sale',
        branchId: null,
        entryDate: '2026-10-20',
        lines: [
          { accountCode: '451', description: 'Venda', debit: 10, credit: 0 },
          { accountCode: '613', description: 'Venda', debit: 0, credit: 10 },
        ],
      });
      await assert.rejects(
        () => updateJournalEntry(client, created.id, {
          description: 'Venda alterada',
          entryDate: '2026-10-20',
          lines: [
            { accountCode: '451', description: 'Venda alterada', debit: 5, credit: 0 },
            { accountCode: '613', description: 'Venda alterada', debit: 0, credit: 5 },
          ],
        }),
        /Cannot edit/i,
      );
    });
  });
});
