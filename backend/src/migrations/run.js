// Run database migrations in order (PostgreSQL only).
// Also runs automatically on server startup via ensurePhaseSchema.
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const SERVER_DB_KEYS = new Set(['DATABASE_URL', 'DB_ENGINE', 'POSTGRES_PASSWORD']);

function applyEnvFile(filePath, serverOverrides) {
  if (!fs.existsSync(filePath)) return false;
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (serverOverrides && SERVER_DB_KEYS.has(key)) {
        process.env[key] = val;
      } else if (!process.env[key]) {
        process.env[key] = val;
      }
    }
    return true;
  } catch (e) {
    console.warn('[MIGRATE] Could not read', filePath, e.message);
    return false;
  }
}

/** Production server: C:\NEXOR ERP\database.env wins over backend/.env for migrate. */
function loadNexorDatabaseEnv() {
  const tried = [];
  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const candidates = [
    path.join(installDir, 'database.env'),
    path.resolve(__dirname, '../../../database.env'),
    path.resolve(__dirname, '../../database.env'),
  ];
  let loaded = false;
  for (const envPath of candidates) {
    tried.push(envPath);
    if (applyEnvFile(envPath, true)) {
      console.log('[MIGRATE] Using database config from:', envPath);
      loaded = true;
      break;
    }
  }
  return { tried, loaded };
}

const nexorEnv = loadNexorDatabaseEnv();
const db = require('../db');
const { applyPostgresMigrations } = require('./applyMigrations');
const { MIGRATION_FILES } = require('./manifest');

function assertPostgresEngine() {
  if (db.engine === 'postgres') return;
  console.error('[MIGRATE] FATAL: These SQL files require PostgreSQL, not SQLite.');
  console.error('[MIGRATE] Error like "near ( : syntax error" means DATABASE_URL was not loaded.');
  console.error('[MIGRATE] SQLite path:', db.dbPath || '(unknown)');
  console.error('');
  console.error('[MIGRATE] Fix — create C:\\NEXOR ERP\\database.env with:');
  console.error('  DB_ENGINE=postgres');
  console.error('  DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/kwanza_erp');
  console.error('');
  console.error('[MIGRATE] Or run in PowerShell before migrate:');
  console.error('  $env:DB_ENGINE="postgres"');
  console.error('  $env:DATABASE_URL="postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/kwanza_erp"');
  console.error('');
  if (!nexorEnv.loaded) {
    console.error('[MIGRATE] database.env not found. Checked:');
    for (const p of nexorEnv.tried) console.error('  -', p);
  }
  process.exit(1);
}

assertPostgresEngine();

function printMigrateHints(error) {
  const code = error?.code || '';
  const msg = String(error?.message || error || '');
  console.error('');
  if (!process.env.DATABASE_URL && (process.env.DB_ENGINE || '').toLowerCase() !== 'postgres') {
    console.error('[MIGRATE] No DATABASE_URL found.');
    console.error('[MIGRATE] Create backend/.env OR C:\\NEXOR ERP\\database.env with:');
    console.error('  DB_ENGINE=postgres');
    console.error('  DATABASE_URL=postgres://postgres:PASSWORD@127.0.0.1:5432/kwanza_erp');
    if (nexorEnv.tried?.length) {
      console.error('[MIGRATE] Checked database.env paths:');
      for (const p of nexorEnv.tried) console.error('  -', p);
    }
  }
  if (msg.includes('syntax error') || msg.includes('near "')) {
    console.error('[MIGRATE] PostgreSQL SQL was executed on SQLite — set DATABASE_URL (see above).');
  }
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    console.error('[MIGRATE] PostgreSQL is not running or wrong host/port.');
    console.error('[MIGRATE] Start Docker:  docker compose up -d postgres');
    console.error('[MIGRATE] Or verify DATABASE_URL password and port 5432.');
  }
  if (code === '28P01' || msg.toLowerCase().includes('password authentication')) {
    console.error('[MIGRATE] Wrong PostgreSQL password in DATABASE_URL.');
    console.error('[MIGRATE] Use the same password as docker-compose.yml (POSTGRES_PASSWORD).');
  }
  if (msg.includes('better-sqlite3') || msg.includes('Cannot find module')) {
    console.error('[MIGRATE] Run first:  cd backend && npm install');
  }
  console.error('');
}

async function runMigrations() {
  console.log('[MIGRATE] Starting database migrations...');
  console.log('[MIGRATE] Engine:', db.engine || 'unknown');
  if (db.engine === 'postgres') {
    const url = process.env.DATABASE_URL || '';
    const masked = url.replace(/:([^:@/]+)@/, ':****@');
    console.log('[MIGRATE] DATABASE_URL:', masked || '(not set)');
  }

  try {
    await db.query('SELECT 1');
    await applyPostgresMigrations(db, { logPrefix: '[MIGRATE]', strict: true });

    const { recordAppMetaForDb, readAppVersion, EXPECTED_SCHEMA_VERSION } = require('../lib/deploymentStatus');
    await recordAppMetaForDb(db, readAppVersion());
    console.log(`[MIGRATE] app_meta schema_version=${EXPECTED_SCHEMA_VERSION}`);
    console.log(`[MIGRATE] Migration manifest: ${MIGRATION_FILES.length} files`);
    console.log('[MIGRATE] ✅ All migrations completed successfully!');
    console.log('[MIGRATE] Database is ready.');
    process.exit(0);
  } catch (error) {
    console.error('[MIGRATE ERROR]', error.message);
    printMigrateHints(error);
    process.exit(1);
  }
}

runMigrations();
