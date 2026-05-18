/**
 * SQLite backup API tests (better-sqlite3 v12 promise-based .backup()).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createSqliteHarness } = require('./helpers/sqliteHarness');

describe('sqlite backup', { concurrency: 1 }, () => {
  let harness;

  before(() => {
    harness = createSqliteHarness();
  });

  after(() => {
    harness?.dispose();
  });

  it('creates a consistent backup file via db.backup()', async () => {
    const destPath = path.join(os.tmpdir(), `nexor-backup-test-${Date.now()}.db`);
    try {
      assert.ok(harness.db.sqlite, 'SQLite connection should be open');
      await harness.db.sqlite.backup(destPath);
      assert.ok(fs.existsSync(destPath));
      assert.ok(fs.statSync(destPath).size > 1000);

      const Database = require('better-sqlite3');
      const copy = new Database(destPath, { readonly: true });
      try {
        const check = copy.prepare('PRAGMA integrity_check').get();
        assert.equal(check.integrity_check, 'ok');
        const branches = copy.prepare('SELECT COUNT(*) AS n FROM branches').get();
        assert.ok(Number(branches.n) >= 1);
      } finally {
        copy.close();
      }
    } finally {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    }
  });
});
