/**
 * Resetting practice data clears every transaction and every saved balance,
 * keeps products / customers / suppliers / chart, and re-posts stock to 261.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('transaction data reset', { concurrency: 1 }, () => {
  let harness;
  let resetTransactionData;

  before(() => {
    harness = createSqliteHarness();
    ({ resetTransactionData } = require(path.join(BACKEND_SRC, 'lib/transactionDataReset')));
  });

  after(() => harness.dispose());

  async function count(client, table, where = '') {
    const r = await client.query(`SELECT COUNT(*) AS n FROM ${table} ${where}`);
    return Number(r.rows[0].n);
  }

  async function accountId(client, code) {
    const r = await client.query('SELECT id FROM chart_of_accounts WHERE code = $1', [code]);
    return r.rows[0]?.id;
  }

  async function seedPracticeData(client) {
    const productId = randomUUID();
    await client.query(
      `INSERT INTO products (id, name, sku, stock, cost, avg_cost, is_active, branch_id, created_at, updated_at)
       VALUES ($1, 'Reset Widget', $2, 10, 50, 40, 1, 'branch-main', datetime('now'), datetime('now'))`,
      [productId, `RST-${productId.slice(0, 8)}`],
    );

    const saleId = randomUUID();
    await client.query(
      `INSERT INTO sales (id, invoice_number, branch_id, total, payment_method)
       VALUES ($1, 'FR-SEDE-2026-00007', 'branch-main', 114, 'cash')`,
      [saleId],
    );
    await client.query(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, unit_price)
       VALUES ($1, $2, $3, 'Reset Widget', 1, 100)`,
      [randomUUID(), saleId, productId],
    );

    const entryId = randomUUID();
    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, total_debit, total_credit, branch_id)
       VALUES ($1, 'VD-2026-00007', '2026-11-01', 'Venda', 'sale', $2, 114, 114, 'branch-main')`,
      [entryId, saleId],
    );
    const cashId = await accountId(client, '261');
    await client.query(
      `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount)
       VALUES ($1, $2, $3, 114, 0)`,
      [randomUUID(), entryId, cashId],
    );
    await client.query('UPDATE chart_of_accounts SET current_balance = 999 WHERE code IN ($1, $2)', ['261', '811']);

    await client.query(
      `INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
       VALUES ($1, 'invoice_receipt', 'FR', 2026, 'branch-main', 7)`,
      [randomUUID()],
    );
    await client.query(
      `INSERT INTO agt_transmissions (id, invoice_number, transmission_type, request_payload, response_payload, agt_status)
       VALUES ($1, 'FR-SEDE-2026-00007', 'register', '{}', '{"simulated":true}', 'accepted')`,
      [randomUUID()],
    );
    return { productId };
  }

  it('clears transactions, zeroes balances and posts the stock to 261', async () => {
    const { productId } = await harness.withClient(seedPracticeData);

    const result = await harness.withClient((client) =>
      resetTransactionData(client, { engine: 'sqlite', postOpeningStock: true }),
    );

    await harness.withClient(async (client) => {
      assert.equal(await count(client, 'sales'), 0);
      assert.equal(await count(client, 'sale_items'), 0);
      assert.equal(await count(client, 'agt_transmissions'), 0);
      assert.equal(await count(client, 'products', `WHERE id = '${productId}'`), 1);

      const seq = await client.query(
        "SELECT current_number FROM document_sequences WHERE document_type = 'invoice_receipt'",
      );
      assert.equal(Number(seq.rows[0].current_number), 0);

      const entries = await client.query('SELECT reference_type, total_debit FROM journal_entries');
      assert.equal(entries.rows.length, 1);
      assert.equal(entries.rows[0].reference_type, 'opening_balance');
      assert.equal(Number(entries.rows[0].total_debit), 400);

      const balances = await client.query(
        "SELECT code, current_balance FROM chart_of_accounts WHERE code IN ('261', '811') ORDER BY code",
      );
      assert.deepEqual(
        balances.rows.map((r) => [r.code, Number(r.current_balance)]),
        [['261', 400], ['811', -400]],
      );
      const other = await count(
        client,
        'chart_of_accounts',
        "WHERE code NOT IN ('261', '811') AND COALESCE(current_balance, 0) <> 0",
      );
      assert.equal(other, 0);
    });

    assert.equal(result.openingStock.posted.length, 1);
    assert.equal(result.deleted.sales, 1);
  });

  it('empties Postgres tables in one TRUNCATE without the 30s limit', async () => {
    const sql = [];
    const client = {
      async query(text) {
        const q = String(text);
        sql.push(q);
        if (q.includes('to_regclass')) return { rows: [{ t: 'x' }] };
        if (q.includes('COUNT(*)')) return { rows: [{ n: 3 }] };
        return { rows: [], rowCount: 0 };
      },
    };
    const result = await resetTransactionData(client, { engine: 'postgres' });
    assert.ok(sql.includes('SET LOCAL statement_timeout = 0'));
    const truncates = sql.filter((q) => q.startsWith('TRUNCATE'));
    assert.equal(truncates.length, 1);
    assert.ok(truncates[0].includes('journal_entry_lines') && truncates[0].includes('sales'));
    assert.equal(sql.some((q) => /^DELETE FROM sales\b/.test(q)), false);
    assert.equal(result.deleted.sales, 3);
  });

  it('refuses when documents were really sent to AGT', async () => {
    await harness.withClient((client) =>
      client.query(
        `INSERT INTO agt_transmissions (id, invoice_number, transmission_type, request_payload, response_payload, agt_code, agt_status)
         VALUES ($1, 'FR-SEDE-2026-00008', 'register', '{}', '{"requestID":"abc"}', 'abc', 'accepted')`,
        [randomUUID()],
      ),
    );
    await assert.rejects(
      () => harness.withClient((client) => resetTransactionData(client, { engine: 'sqlite' })),
      (err) => err.code === 'AGT_DOCUMENTS_SENT',
    );
  });
});
