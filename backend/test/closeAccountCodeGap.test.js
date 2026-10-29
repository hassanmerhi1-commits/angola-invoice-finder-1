/**
 * Deleting an 8-digit leaf closes the gap under the same parent only.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('close deleted leaf code gap', () => {
  let harness;
  let closeDeletedLeafCodeGap;
  let compactLeafCodeGaps;

  before(() => {
    harness = createSqliteHarness();
    ({ closeDeletedLeafCodeGap, compactLeafCodeGaps } = require(path.join(BACKEND_SRC, 'lib/entityCoaAccounts')));
  });

  after(() => harness.dispose());

  it('moves later siblings down and leaves another group alone', async () => {
    const parentId = randomUUID();
    const otherParentId = randomUUID();
    const deletedId = randomUUID();
    const keepId = randomUUID();
    const thirdId = randomUUID();
    const fourthId = randomUUID();
    const otherLeafId = randomUUID();
    const journalId = randomUUID();

    await harness.withClient(async (client) => {
      const existingParent = await client.query(
        `SELECT id FROM chart_of_accounts WHERE code = '111' LIMIT 1`,
      );
      const landId = existingParent.rows?.[0]?.id || parentId;
      if (!existingParent.rows?.[0]) {
        await client.query(
          `INSERT INTO chart_of_accounts
             (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, '111', 'Land', 'asset', 'debit', NULL, 2, 1, 1)`,
          [parentId],
        );
      }
      await client.query(
        `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '1111', 'Group', 'asset', 'debit', $2, 3, 1, 1)`,
        [otherParentId, landId],
      );
      const leaves = [
        [keepId, '11100001', 'First', landId],
        [deletedId, '11100002', 'Second', landId],
        [thirdId, '11100003', 'Third', landId],
        [fourthId, '11100004', 'Fourth', landId],
        [otherLeafId, '11110001', 'Other group', otherParentId],
      ];
      for (const [id, code, name, parent] of leaves) {
        await client.query(
          `INSERT INTO chart_of_accounts
             (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, $2, $3, 'asset', 'debit', $4, 3, 0, 1)`,
          [id, code, name, parent],
        );
      }
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, description, is_posted)
         VALUES ($1, $2, date('now'), 'gap test', 1)`,
        [journalId, `JE-${deletedId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, '11100003', 10, 0)`,
        [randomUUID(), journalId],
      );

      const moved = await closeDeletedLeafCodeGap(client, {
        id: deletedId,
        code: '11100002',
        parent_id: landId,
        is_header: false,
      });
      assert.deepEqual(moved.map((row) => row.newCode), ['11100002', '11100003']);
    });

    const rows = await harness.db.query(
      `SELECT id, code FROM chart_of_accounts WHERE id IN ($1, $2, $3, $4, $5)`,
      [keepId, deletedId, thirdId, fourthId, otherLeafId],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row.code]));
    assert.equal(byId.get(keepId), '11100001');
    assert.equal(byId.get(thirdId), '11100002');
    assert.equal(byId.get(fourthId), '11100003');
    assert.equal(byId.get(otherLeafId), '11110001');
    assert.notEqual(byId.get(deletedId), '11100002');

    const line = await harness.db.query(
      'SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1',
      [journalId],
    );
    assert.equal(String(line.rows[0].account_id), '11100002');
  });

  it('packs existing holes so 00005 is followed by the next account, on every parent', async () => {
    const parentId = randomUUID();
    const otherParentId = randomUUID();
    const firstId = randomUUID();
    const hiddenId = randomUUID();
    const jumpedId = randomUUID();
    const otherLeafId = randomUUID();
    const keptJournalId = randomUUID();
    const hiddenJournalId = randomUUID();

    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '918', 'Gap parent', 'asset', 'debit', NULL, 2, 1, 1)`,
        [parentId],
      );
      await client.query(
        `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '9181', 'Other group', 'asset', 'debit', $2, 3, 1, 1)`,
        [otherParentId, parentId],
      );
      const leaves = [
        [firstId, '91800005', 'Fifth', parentId, 1],
        [hiddenId, '91800006', 'Hidden', parentId, 0],
        [jumpedId, '91800014', 'Fourteenth', parentId, 1],
        [otherLeafId, '91810001', 'Other group leaf', otherParentId, 1],
      ];
      for (const [id, code, name, parent, active] of leaves) {
        await client.query(
          `INSERT INTO chart_of_accounts
             (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, $2, $3, 'asset', 'debit', $4, 4, 0, $5)`,
          [id, code, name, parent, active],
        );
      }
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, description, is_posted)
         VALUES ($1, $2, date('now'), 'kept', 1)`,
        [keptJournalId, `JE-${keptJournalId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, description, is_posted)
         VALUES ($1, $2, date('now'), 'hidden', 1)`,
        [hiddenJournalId, `JE-${hiddenJournalId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, '91800014', 10, 0)`,
        [randomUUID(), keptJournalId],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, '91800006', 4, 0)`,
        [randomUUID(), hiddenJournalId],
      );

      const moved = await compactLeafCodeGaps(client);
      const packed = moved.filter((row) => String(row.oldCode).startsWith('918') && !String(row.newCode).startsWith('z'));
      assert.deepEqual(
        packed.map((row) => `${row.oldCode}->${row.newCode}`).sort(),
        ['91800005->91800001', '91800014->91800002'],
      );
    });

    const rows = await harness.db.query(
      `SELECT id, code FROM chart_of_accounts WHERE id IN ($1, $2, $3, $4)`,
      [firstId, hiddenId, jumpedId, otherLeafId],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row.code]));
    assert.equal(byId.get(firstId), '91800001');
    assert.equal(byId.get(jumpedId), '91800002');
    assert.equal(byId.get(otherLeafId), '91810001');
    assert.equal(String(byId.get(hiddenId)).startsWith('z'), true);

    const kept = await harness.db.query(
      'SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1',
      [keptJournalId],
    );
    const hidden = await harness.db.query(
      'SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1',
      [hiddenJournalId],
    );
    assert.equal(String(kept.rows[0].account_id), '91800002');
    assert.equal(String(hidden.rows[0].account_id), String(byId.get(hiddenId)));

    const again = await harness.withClient(async (client) => compactLeafCodeGaps(client));
    assert.equal(again.length, 0);
  });

  it('does not mix history when one account takes the number another account leaves', async () => {
    const parentId = randomUUID();
    const lowId = randomUUID();
    const highId = randomUUID();
    const lowJournalId = randomUUID();
    const highJournalId = randomUUID();

    await harness.withClient(async (client) => {
      await client.query(
        `INSERT INTO chart_of_accounts
           (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
         VALUES ($1, '919', 'Chain parent', 'asset', 'debit', NULL, 2, 1, 1)`,
        [parentId],
      );
      for (const [id, code, name] of [
        [lowId, '91900002', 'Low'],
        [highId, '91900004', 'High'],
      ]) {
        await client.query(
          `INSERT INTO chart_of_accounts
             (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
           VALUES ($1, $2, $3, 'asset', 'debit', $4, 3, 0, 1)`,
          [id, code, name, parentId],
        );
      }
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, description, is_posted)
         VALUES ($1, $2, date('now'), 'low', 1)`,
        [lowJournalId, `JE-${lowJournalId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, description, is_posted)
         VALUES ($1, $2, date('now'), 'high', 1)`,
        [highJournalId, `JE-${highJournalId.slice(0, 8)}`],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, '91900002', 2, 0)`,
        [randomUUID(), lowJournalId],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
         VALUES ($1, $2, '91900004', 4, 0)`,
        [randomUUID(), highJournalId],
      );
      await compactLeafCodeGaps(client);
    });

    const low = await harness.db.query(
      'SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1',
      [lowJournalId],
    );
    const high = await harness.db.query(
      'SELECT account_id FROM journal_entry_lines WHERE journal_entry_id = $1',
      [highJournalId],
    );
    assert.equal(String(low.rows[0].account_id), '91900001');
    assert.equal(String(high.rows[0].account_id), '91900002');
  });

  it('still renumbers the chart when a journal line rejects a code written into a UUID column', async () => {
    const parentId = randomUUID();
    const leafId = randomUUID();
    const codes = new Map([
      [parentId, '311'],
      [leafId, '31100005'],
    ]);
    const client = {
      async query(sql, params = []) {
        const text = String(sql);
        if (/^SAVEPOINT/i.test(text) || /^RELEASE SAVEPOINT/i.test(text) || /^ROLLBACK TO SAVEPOINT/i.test(text)) {
          return { rows: [] };
        }
        if (/SELECT id, code, parent_id/i.test(text)) {
          return {
            rows: [
              { id: parentId, code: '311', parent_id: null, is_header: true, is_active: true },
              { id: leafId, code: codes.get(leafId), parent_id: parentId, is_header: false, is_active: true },
            ],
          };
        }
        if (/UPDATE journal_entry_lines/i.test(text)) {
          throw new Error('invalid input syntax for type uuid');
        }
        if (/UPDATE chart_of_accounts SET code/i.test(text)) {
          codes.set(params[1], params[0]);
          return { rows: [] };
        }
        if (/UPDATE (purchase_invoices|bank_accounts|expenses)/i.test(text)) {
          return { rows: [] };
        }
        throw new Error(`unexpected sql: ${text}`);
      },
    };
    const moved = await compactLeafCodeGaps(client);
    assert.equal(codes.get(leafId), '31100001');
    assert.ok(moved.some((row) => row.oldCode === '31100005' && row.newCode === '31100001'));
  });
});
