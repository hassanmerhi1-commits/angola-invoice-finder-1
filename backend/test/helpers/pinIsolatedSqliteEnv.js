/**
 * Pin this process to an isolated temp SQLite DB before any backend module loads.
 * Must be required first in audit / integration tests.
 */
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

const FORBIDDEN_SQLITE = path.resolve('C:\\nexor\\erp.db');

function pinIsolatedSqliteEnv() {
  delete process.env.USE_POSTGRES;
  process.env.DB_ENGINE = 'sqlite';
  process.env.DATABASE_URL = '';

  const current = process.env.SQLITE_PATH
    ? path.resolve(process.env.SQLITE_PATH)
    : '';
  const looksLikeDefaultNexor =
    !current
    || current.toLowerCase() === FORBIDDEN_SQLITE.toLowerCase()
    || /[\\/]nexor[\\/]erp\.db$/i.test(current);

  if (looksLikeDefaultNexor) {
    process.env.SQLITE_PATH = path.join(os.tmpdir(), `nexor-erp-test-${randomUUID()}.db`);
  }

  const resolved = path.resolve(process.env.SQLITE_PATH);
  if (resolved.toLowerCase() === FORBIDDEN_SQLITE.toLowerCase()) {
    throw new Error('Refusing to run tests against C:\\nexor\\erp.db');
  }
  if (process.env.DATABASE_URL) {
    throw new Error('Refusing to run tests with DATABASE_URL set');
  }
  if (String(process.env.DB_ENGINE).toLowerCase() !== 'sqlite') {
    throw new Error('Refusing to run tests unless DB_ENGINE=sqlite');
  }
}

pinIsolatedSqliteEnv();

module.exports = { pinIsolatedSqliteEnv };
