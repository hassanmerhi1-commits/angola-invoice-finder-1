// Run database migrations in order
// Splits SQL files into individual statements to handle DO $$ blocks properly
const fs = require('fs');
const path = require('path');

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

const MIGRATIONS = [
  '001_initial_schema.sql',
  '002_agt_compliance.sql',
  '003_chart_of_accounts.sql',
  '004_purchase_order_freight.sql',
  '005_transaction_engine.sql',
  '006_tax_engine.sql',
  '007_enterprise_controls.sql',
  '008_multi_currency.sql',
  '009_seed_data.sql',
  '010_data_integrity.sql',
  '011_optimistic_locking.sql',
  '012_products_updated_at.sql',
  '013_document_sequences.sql',
  '014_chart_of_accounts_children_count.sql',
  '015_products_supplier.sql',
  '016_freight_expense_account.sql',
  '017_multi_price_levels.sql',
  '018_purchase_invoices_table.sql',
  '019_org_hierarchy.sql',
  '020_inventory_vat_5_percent.sql',
  '021_inventory_shrinkage_account.sql',
  '022_sales_due_date.sql',
  '023_sales_printed_at.sql',
  '024_products_min_stock.sql',
  '025_proformas.sql',
  '026_sync_audit.sql',
  '027_sync_outbox_destination.sql',
  '028_client_ingest_log.sql',
  '029_hq_ingest_log.sql',
  '030_caixa_sync.sql',
  '031_purchase_invoice_freight.sql',
  '032_fiscal_documents_phase1.sql',
  '033_credit_note_restore_stock.sql',
  '034_fiscal_signing_phase2.sql',
  '035_agt_api_phase3.sql',
  '036_company_settings_phase4.sql',
  '037_fiscal_audit_phase5.sql',
  '038_audit_log_actions_phase5.sql',
];

/**
 * Split SQL into executable statements, respecting $$ dollar-quoted blocks.
 * pg.Pool.query() fails silently with multi-statement strings containing DO $$ blocks.
 */
function splitSQL(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  const lines = sql.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip pure comments outside of dollar-quoted blocks
    if (!inDollarQuote && (trimmed.startsWith('--') || trimmed === '')) {
      current += line + '\n';
      continue;
    }

    current += line + '\n';

    // Track $$ dollar-quoting (DO $$ ... $$; and CREATE FUNCTION ... $$ ... $$;)
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) {
        inDollarQuote = !inDollarQuote;
      }
    }

    // Statement ends with ; outside dollar-quoted blocks
    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim();
      const lines = stmt.split('\n').map((l) => l.trim()).filter(Boolean);
      const commentOnly = lines.length > 0 && lines.every((l) => l.startsWith('--'));
      if (stmt && !commentOnly) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Catch any trailing statement without semicolon
  const remaining = current.trim();
  const remainingLines = remaining.split('\n').map((l) => l.trim()).filter(Boolean);
  const remainingCommentOnly = remainingLines.length > 0 && remainingLines.every((l) => l.startsWith('--'));
  if (remaining && !remainingCommentOnly) {
    statements.push(remaining);
  }

  return statements;
}

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
    // Wait for DB connection
    await db.query('SELECT 1');

    for (const file of MIGRATIONS) {
      const sqlFile = path.join(__dirname, file);
      if (!fs.existsSync(sqlFile)) {
        console.warn(`[MIGRATE] ⚠ Skipping ${file} (not found)`);
        continue;
      }

      const sql = fs.readFileSync(sqlFile, 'utf8');
      const statements = splitSQL(sql);

      for (let i = 0; i < statements.length; i++) {
        try {
          await db.query(statements[i]);
        } catch (err) {
          // Log but continue on "already exists" type errors
          if (err.code === '42P07' || err.code === '42710' || err.code === '23505') {
            // 42P07 = relation already exists, 42710 = type already exists, 23505 = duplicate key
            continue;
          }
          console.error(`[MIGRATE] ❌ Error in ${file} (statement ${i + 1}):`, err.message);
          throw err;
        }
      }

      console.log(`[MIGRATE] ✅ ${file} applied (${statements.length} statements)`);
    }

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
