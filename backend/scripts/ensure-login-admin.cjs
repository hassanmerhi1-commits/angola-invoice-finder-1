#!/usr/bin/env node
/**
 * Repair / seed factory login accounts on a city PostgreSQL server.
 * Usage (Administrator, on the server PC):
 *   cd C:\NEXOR ERP\backend
 *   $env:NEXOR_INSTALL_DIR='C:\NEXOR ERP'
 *   node scripts\ensure-login-admin.cjs
 */
const path = require('path');
const fs = require('fs');

const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
const installEnv = path.join(installDir, 'database.env');
if (fs.existsSync(installEnv)) {
  require('dotenv').config({ path: installEnv });
}

const db = require('../src/db');
const { ensureAuthUsersReady } = require('../src/lib/ensureAuthUsersReady');
const { verifyPassword } = require('../src/lib/passwordAuth');

async function main() {
  if (db.engine !== 'postgres') {
    console.error('[ensure-login-admin] Not connected to PostgreSQL.');
    console.error('Check C:\\NEXOR ERP\\database.env — DB_ENGINE=postgres and DATABASE_URL=...');
    process.exit(1);
  }
  await db.query('SELECT 1');
  await ensureAuthUsersReady();
  const users = await db.query(
    `SELECT email, username, is_active, password_hash FROM users ORDER BY email`,
  );
  if (!users.rows.length) {
    console.error('[ensure-login-admin] users table is still empty after seed.');
    process.exit(1);
  }
  console.log(`[ensure-login-admin] ${users.rows.length} user(s):`);
  for (const row of users.rows) {
    const changeme = await verifyPassword('changeme', row.password_hash);
    console.log(
      `  ${row.email} username=${row.username || ''} active=${row.is_active} default_changeme=${changeme}`,
    );
  }
  console.log('[ensure-login-admin] OK — try admin / changeme (or the password you set), then change it.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[ensure-login-admin]', err.message || err);
  process.exit(1);
});
