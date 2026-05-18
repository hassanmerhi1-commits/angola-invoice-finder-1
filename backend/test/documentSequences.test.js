/**
 * Atomic document sequence tests (per-branch purchase invoice FC numbers).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');

describe('documentSequences', { concurrency: 1 }, () => {
  let harness;
  let accounting;

  before(() => {
    harness = createSqliteHarness();
    accounting = require(path.join(BACKEND_SRC, 'accounting'));
  });

  after(() => {
    harness?.dispose();
  });

  async function ensureBranch(client, code) {
    const id = `branch-${code.toLowerCase()}`;
    await client.query(
      `INSERT OR IGNORE INTO branches (id, name, code, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 1, datetime('now'), datetime('now'))`,
      [id, `Branch ${code}`, code]
    );
    return { branchId: id, branchCode: code };
  }

  it('allocates independent FC sequences per branch', async () => {
    await harness.withClient(async (client) => {
      const sede = await ensureBranch(client, 'SEDE');
      const bng = await ensureBranch(client, 'BNG');

      const sede1 = await accounting.generateSequenceNumber(
        client, 'purchase_invoice', 'FC', sede
      );
      const bng1 = await accounting.generateSequenceNumber(
        client, 'purchase_invoice', 'FC', bng
      );
      const sede2 = await accounting.generateSequenceNumber(
        client, 'purchase_invoice', 'FC', sede
      );

      assert.match(sede1, /^FC-SEDE-\d{4}-\d{5}$/);
      assert.match(bng1, /^FC-BNG-\d{4}-\d{5}$/);
      assert.notEqual(sede1, bng1);

      const sedeNum1 = parseInt(sede1.split('-').pop(), 10);
      const sedeNum2 = parseInt(sede2.split('-').pop(), 10);
      assert.equal(sedeNum2, sedeNum1 + 1);

      const peekBng = await accounting.peekSequenceNumber(
        client, 'purchase_invoice', 'FC', bng
      );
      assert.match(peekBng, /^FC-BNG-\d{4}-\d{5}$/);
    });
  });
});
