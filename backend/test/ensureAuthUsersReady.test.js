/**
 * Fresh Postgres city DBs used to seed admin with a $2a$10$xxxx… placeholder
 * (001_initial_schema.sql) and skip creating rows when the users table was empty.
 * Isolated temp SQLite only.
 */
require('./helpers/pinIsolatedSqliteEnv');

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createSqliteHarness, BACKEND_SRC } = require('./helpers/sqliteHarness');
const { verifyPassword, hashPassword, isBcryptHash, isBrokenBcryptHash } = require('../src/lib/passwordAuth');

const REAL_CHANGEME_HASH = '$2a$12$b2O7uSmkdR5JljEgu.lQCeHGhRrgh5LO7v2yfML7QNOz808XjWo.y';
const PLACEHOLDER_HASH = '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

function assertIsolatedSqlite(harness) {
  assert.equal(process.env.DB_ENGINE, 'sqlite');
  assert.equal(process.env.DATABASE_URL, '');
  assert.notEqual(path.resolve(harness.testDbPath).toLowerCase(), path.resolve('C:\\nexor\\erp.db').toLowerCase());
}

describe('ensureAuthUsersReady', () => {
  let harness;
  let ensureAuthUsersReady;

  before(() => {
    harness = createSqliteHarness();
    assertIsolatedSqlite(harness);
    ({ ensureAuthUsersReady } = require(path.join(BACKEND_SRC, 'lib/ensureAuthUsersReady')));
  });

  after(() => {
    harness.dispose();
  });

  it('treats the 001 placeholder hash as broken and accepts a real changeme hash', async () => {
    assert.equal(isBcryptHash(PLACEHOLDER_HASH), true);
    assert.equal(isBrokenBcryptHash(PLACEHOLDER_HASH), true);
    assert.equal(isBrokenBcryptHash(REAL_CHANGEME_HASH), false);
    assert.equal(await verifyPassword('changeme', REAL_CHANGEME_HASH), true);
    assert.equal(await verifyPassword('changeme', PLACEHOLDER_HASH), false);
  });

  it('seeds admin/changeme when the users table is empty', async () => {
    harness.db.sqlite.exec('DELETE FROM users');
    await ensureAuthUsersReady();
    const row = harness.db.sqlite.prepare(
      `SELECT email, password_hash FROM users WHERE email = 'admin@kwanzaerp.ao'`,
    ).get();
    assert.ok(row, 'admin row missing after seed');
    assert.equal(await verifyPassword('changeme', row.password_hash), true);
  });

  it('repairs the 001 placeholder hash to changeme without touching a custom password', async () => {
    harness.db.sqlite.exec('DELETE FROM users');
    const customHash = await hashPassword('CityPass9');
    harness.db.sqlite.prepare(
      `INSERT INTO users (id, email, name, role, branch_id, password_hash, is_active)
       VALUES (?, ?, ?, 'admin', 'branch-main', ?, 1)`,
    ).run('user-placeholder', 'admin@kwanzaerp.ao', 'Administrador', PLACEHOLDER_HASH);
    harness.db.sqlite.prepare(
      `INSERT INTO users (id, email, name, role, branch_id, password_hash, is_active)
       VALUES (?, ?, ?, 'admin', 'branch-main', ?, 1)`,
    ).run('user-custom', 'joao@empresa.ao', 'Joao', customHash);

    await ensureAuthUsersReady();

    const admin = harness.db.sqlite.prepare(
      `SELECT password_hash FROM users WHERE email = 'admin@kwanzaerp.ao'`,
    ).get();
    const joao = harness.db.sqlite.prepare(
      `SELECT password_hash FROM users WHERE email = 'joao@empresa.ao'`,
    ).get();
    assert.equal(await verifyPassword('changeme', admin.password_hash), true);
    assert.equal(await verifyPassword('CityPass9', joao.password_hash), true);
  });
});
