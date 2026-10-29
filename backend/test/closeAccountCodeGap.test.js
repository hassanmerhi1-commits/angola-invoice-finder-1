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

  before(() => {
    harness = createSqliteHarness();
    ({ closeDeletedLeafCodeGap } = require(path.join(BACKEND_SRC, 'lib/entityCoaAccounts')));
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
});
