/**
 * Isolated SQLite DB for automated tests (temp file, fresh schema via db.js bootstrap).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');

const BACKEND_SRC = path.resolve(__dirname, '../../src');

function clearBackendModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}src${path.sep}`) && key.includes('backend')) {
      delete require.cache[key];
    }
  }
}

/**
 * @returns {{ db: import('../../src/db'), testDbPath: string, withClient: Function, dispose: Function }}
 */
function createSqliteHarness() {
  const testDbPath = path.join(os.tmpdir(), `nexor-erp-test-${randomUUID()}.db`);

  process.env.DB_ENGINE = 'sqlite';
  process.env.SQLITE_PATH = testDbPath;
  process.env.DATABASE_URL = '';
  delete process.env.USE_POSTGRES;

  clearBackendModuleCache();

  const db = require(path.join(BACKEND_SRC, 'db'));

  // db.js CREATE TABLE is frozen for existing installs; phase schema (and CI temp DBs)
  // must still get columns added by ensurePhaseSchema — call the sync-safe bits here.
  try {
    if (db.sqlite) {
      const movCols = db.sqlite.pragma('table_info(stock_movements)');
      if (Array.isArray(movCols) && !movCols.some((c) => c.name === 'location_id')) {
        db.sqlite.exec('ALTER TABLE stock_movements ADD COLUMN location_id TEXT');
      }
    }
  } catch (_) {
    /* ignore */
  }

  async function withClient(fn) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  function dispose() {
    try {
      if (typeof db.closeSqliteConnection === 'function') {
        db.closeSqliteConnection();
      }
    } catch (_) {
      /* ignore */
    }
    for (const suffix of ['', '-wal', '-shm']) {
      const filePath = `${testDbPath}${suffix}`;
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {
        /* ignore */
      }
    }
    clearBackendModuleCache();
  }

  return { db, testDbPath, withClient, dispose };
}

async function seedSupplierAndProduct(client) {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
  const supplierId = randomUUID();
  await client.query(
    `INSERT INTO suppliers (id, name, nif, email, is_active, balance, created_at, updated_at)
     VALUES ($1, $2, $3, 'supplier@test.ao', 1, 0, datetime('now'), datetime('now'))`,
    [supplierId, `Test Supplier ${suffix}`, `5000${suffix}`],
  );

  const productId = randomUUID();
  await client.query(
    `INSERT INTO products (id, name, sku, stock, cost, is_active, branch_id, created_at, updated_at)
     VALUES ($1, $2, $3, 0, 10, 1, 'branch-main', datetime('now'), datetime('now'))`,
    [productId, `Test Widget ${suffix}`, `TEST-${suffix}`],
  );

  return { supplierId, productId, branchId: 'branch-main', userId: 'user-admin' };
}

module.exports = {
  createSqliteHarness,
  seedSupplierAndProduct,
  clearBackendModuleCache,
  BACKEND_SRC,
};
