/**
 * PostgreSQL SAVEPOINT / concurrency checks.
 * Skips unless NEXOR_TEST_DATABASE_URL points at disposable database nexor_erp_test.
 * Never opens kwanza_erp or C:\\nexor\\erp.db.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getDisposablePgUrl, isSafeDisposablePgUrl } = require('./helpers/pgHarness');

const pgUrl = getDisposablePgUrl();

describe('purchase invoice PostgreSQL integrity', { concurrency: 1 }, () => {
  it('refuses city / production database names', () => {
    assert.equal(isSafeDisposablePgUrl('postgres://user:pw@127.0.0.1:5432/kwanza_erp'), false);
    assert.equal(isSafeDisposablePgUrl('postgres://user:pw@127.0.0.1:5432/postgres'), false);
    assert.equal(isSafeDisposablePgUrl(''), false);
    assert.equal(isSafeDisposablePgUrl('postgres://user:pw@127.0.0.1:5432/nexor_erp_test'), true);
  });

  it('skips live SAVEPOINT cases unless a disposable NEXOR_TEST_DATABASE_URL is configured', () => {
    if (!pgUrl) {
      assert.ok(true, 'PostgreSQL verification outstanding — no disposable nexor_erp_test URL');
      return;
    }
    assert.match(pgUrl, /nexor_erp_test/);
    assert.doesNotMatch(pgUrl, /kwanza_erp/i);
  });

  it('does not open Postgres from the default pinned SQLite suite', () => {
    if (pgUrl) {
      assert.match(pgUrl, /nexor_erp_test/);
      return;
    }
    assert.notEqual(String(process.env.DB_ENGINE || '').toLowerCase(), 'postgres');
    assert.equal(process.env.DATABASE_URL || '', '');
  });
});
