/**
 * Trial balance date window must not include out-of-range journal lines.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');
const { journalFilteredSumSql, journalThroughEndJoinSql } = require(path.join(BACKEND_SRC, 'lib/journalPeriodSums'));

describe('trialBalance date filter', { concurrency: 1 }, () => {
  let harness;
  let createJournalEntry;

  before(() => {
    harness = createSqliteHarness();
    ({ createJournalEntry } = require(path.join(BACKEND_SRC, 'accounting')));
  });

  after(() => {
    harness?.dispose();
  });

  async function trialCredits(client, code, startDate, endDate) {
    const sums = journalFilteredSumSql();
    const result = await client.query(
      `
        SELECT ${sums.totalCredits}
        FROM chart_of_accounts coa
        LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
        LEFT JOIN journal_entries je
          ON je.id = jel.journal_entry_id AND je.is_posted = true
          AND je.entry_date BETWEEN $2 AND $3
        WHERE coa.code = $1
        GROUP BY coa.id
      `,
      [code, startDate, endDate],
    );
    return Number(result.rows[0]?.total_credits || 0);
  }

  it('excludes credits posted outside the requested period', async () => {
    await harness.withClient(async (client) => {
      await createJournalEntry(client, {
        description: 'Jan sale',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-01-15',
        lines: [
          { accountCode: '451', debit: 100, credit: 0 },
          { accountCode: '613', debit: 0, credit: 100 },
        ],
      });
      await createJournalEntry(client, {
        description: 'March sale',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-03-15',
        lines: [
          { accountCode: '451', debit: 50, credit: 0 },
          { accountCode: '613', debit: 0, credit: 50 },
        ],
      });

      const january = await trialCredits(client, '613', '2026-01-01', '2026-01-31');
      const march = await trialCredits(client, '613', '2026-03-01', '2026-03-31');
      const q1 = await trialCredits(client, '613', '2026-01-01', '2026-03-31');

      assert.equal(january, 100);
      assert.equal(march, 50);
      assert.equal(q1, 150);
    });
  });

  it('period trial balance debit totals equal credit totals for posted lines', async () => {
    await harness.withClient(async (client) => {
      const sums = journalFilteredSumSql();
      const result = await client.query(
        `
          SELECT
            COALESCE(SUM(m.total_debits), 0) AS d,
            COALESCE(SUM(m.total_credits), 0) AS c
          FROM (
            SELECT ${sums.totalDebits}, ${sums.totalCredits}
            FROM chart_of_accounts coa
            LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
            LEFT JOIN journal_entries je
              ON je.id = jel.journal_entry_id AND je.is_posted = true
              AND je.entry_date BETWEEN $1 AND $2
            GROUP BY coa.id
          ) m
        `,
        ['2026-01-01', '2026-03-31'],
      );
      assert.equal(Number(result.rows[0].d), Number(result.rows[0].c));
    });
  });

  async function accountBalance(client, code, startDate, endDate) {
    const hasPeriod = Boolean(startDate && endDate);
    let sums = journalFilteredSumSql();
    let closeJoin = '';
    const params = [code];
    let dateFilter = '';
    if (hasPeriod) {
      dateFilter = 'AND je.entry_date BETWEEN $2 AND $3';
      params.push(startDate, endDate);
      closeJoin = journalThroughEndJoinSql({ alias: 'je_close', endDateParam: '$3' });
      sums = journalFilteredSumSql({ periodAlias: 'je', closeAlias: 'je_close' });
    }
    const result = await client.query(
      `
        SELECT
          ${sums.totalDebits},
          ${sums.totalCredits},
          ${sums.currentBalance}
        FROM chart_of_accounts coa
        LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
        LEFT JOIN journal_entries je
          ON je.id = jel.journal_entry_id AND je.is_posted = true ${dateFilter}
        ${closeJoin}
        WHERE coa.code = $1
        GROUP BY coa.id
      `,
      params,
    );
    return result.rows[0];
  }

  it('dated GET /:id/balance current_balance is closing through period end', async () => {
    await harness.withClient(async (client) => {
      await client.query(`UPDATE chart_of_accounts SET opening_balance = 100, current_balance = 0 WHERE code = '613'`);
      await client.query(`UPDATE chart_of_accounts SET opening_balance = 0, current_balance = 0 WHERE code = '451'`);
      await client.query(
        `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (
           SELECT id FROM journal_entries WHERE reference_type = 'adjustment'
         )`,
      );
      await client.query(`DELETE FROM journal_entries WHERE reference_type = 'adjustment'`);
      await createJournalEntry(client, {
        description: 'Jan sale',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-01-15',
        lines: [
          { accountCode: '451', debit: 80, credit: 0 },
          { accountCode: '613', debit: 0, credit: 80 },
        ],
      });
      await createJournalEntry(client, {
        description: 'March sale',
        referenceType: 'adjustment',
        branchId: 'branch-main',
        entryDate: '2026-03-15',
        lines: [
          { accountCode: '451', debit: 50, credit: 0 },
          { accountCode: '613', debit: 0, credit: 50 },
        ],
      });

      const march = await accountBalance(client, '613', '2026-03-01', '2026-03-31');
      assert.equal(Number(march.total_credits), 50, 'period credits only');
      assert.equal(Number(march.current_balance), 230, 'closing = opening + journals through end');

      const undated = await accountBalance(client, '613');
      assert.ok(Number(undated.total_credits) >= 130, 'undated includes prior journals');
      assert.equal(Number(undated.current_balance), 230);
    });
  });
});
