// Run database migrations in order
// Splits SQL files into individual statements to handle DO $$ blocks properly
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const db = require('../db');

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
      // Only add non-empty, non-comment-only statements
      if (stmt && !stmt.match(/^(\s*--.*\n?)*$/)) {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Catch any trailing statement without semicolon
  const remaining = current.trim();
  if (remaining && !remaining.match(/^(\s*--.*\n?)*$/)) {
    statements.push(remaining);
  }

  return statements;
}

async function runMigrations() {
  console.log('[MIGRATE] Starting database migrations...');

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
    process.exit(1);
  }
}

runMigrations();
