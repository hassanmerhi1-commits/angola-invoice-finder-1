const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const dbPath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve('C:\\nexor\\erp.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');

const schemaPath = process.env.SQLITE_SCHEMA_PATH
  ? path.resolve(process.env.SQLITE_SCHEMA_PATH)
  : path.resolve('C:\\nexor\\schema.sql');

const seedPath = process.env.SQLITE_SEED_PATH
  ? path.resolve(process.env.SQLITE_SEED_PATH)
  : path.resolve('C:\\nexor\\seed.sql');

function readSql(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function hasAnyUserTable() {
  const row = sqlite.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
  ).get();
  return Number(row?.count || 0) > 0;
}

function tableHasRows(tableName) {
  try {
    const row = sqlite.prepare(`SELECT 1 AS ok FROM ${tableName} LIMIT 1`).get();
    return !!row;
  } catch {
    return false;
  }
}

function tableExists(tableName) {
  const row = sqlite
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return !!row;
}

function tryAlterAdd(table, columnSql) {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
  } catch (_) {}
}

function seedAccountingPeriods() {
  const y = new Date().getFullYear();
  if (!tableExists('accounting_periods')) return;
  const cnt = sqlite.prepare('SELECT COUNT(*) AS c FROM accounting_periods WHERE year = ?').get(y);
  if (Number(cnt?.c || 0) >= 12) return;
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const ins = sqlite.prepare(
    `INSERT OR IGNORE INTO accounting_periods (id, year, month, name, status) VALUES (?, ?, ?, ?, 'open')`
  );
  for (let m = 1; m <= 12; m++) {
    ins.run(crypto.randomUUID(), y, m, `${months[m - 1]} ${y}`);
  }
}

/** Tables required by transaction engine + REST routes (SQLite DDL). */
function ensureAppTablesAndColumns() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      nif TEXT,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      country TEXT DEFAULT 'Angola',
      credit_limit REAL DEFAULT 0,
      current_balance REAL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_number TEXT,
      branch_id TEXT,
      cashier_id TEXT,
      cashier_name TEXT,
      subtotal REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      payment_method TEXT,
      amount_paid REAL DEFAULT 0,
      change REAL DEFAULT 0,
      customer_nif TEXT,
      customer_name TEXT,
      status TEXT DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT,
      sku TEXT,
      quantity REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      warehouse_id TEXT,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL DEFAULT 0,
      reference_type TEXT NOT NULL,
      reference_id TEXT,
      reference_number TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS open_items (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      document_number TEXT NOT NULL,
      document_date TEXT NOT NULL,
      due_date TEXT,
      currency TEXT DEFAULT 'AOA',
      original_amount REAL NOT NULL,
      remaining_amount REAL NOT NULL,
      is_debit INTEGER NOT NULL,
      status TEXT DEFAULT 'open',
      branch_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      cleared_at TEXT
    );

    CREATE TABLE IF NOT EXISTS clearings (
      id TEXT PRIMARY KEY,
      debit_item_id TEXT NOT NULL,
      credit_item_id TEXT NOT NULL,
      amount REAL NOT NULL,
      clearing_date TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_links (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_number TEXT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_number TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      entry_number TEXT,
      entry_date TEXT,
      description TEXT,
      reference_type TEXT,
      reference_id TEXT,
      total_debit REAL DEFAULT 0,
      total_credit REAL DEFAULT 0,
      is_posted INTEGER DEFAULT 1,
      posted_at TEXT,
      branch_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS journal_entry_lines (
      id TEXT PRIMARY KEY,
      journal_entry_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      description TEXT,
      debit_amount REAL DEFAULT 0,
      credit_amount REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS document_sequences (
      id TEXT PRIMARY KEY,
      document_type TEXT NOT NULL,
      prefix TEXT,
      fiscal_year INTEGER NOT NULL,
      current_number INTEGER NOT NULL DEFAULT 0,
      UNIQUE(document_type, fiscal_year)
    );

    CREATE TABLE IF NOT EXISTS accounting_periods (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      UNIQUE(year, month)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      payment_number TEXT NOT NULL,
      payment_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_name TEXT,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'AOA',
      bank_account TEXT,
      reference TEXT,
      notes TEXT,
      branch_id TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      posted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      transfer_number TEXT,
      from_branch_id TEXT,
      from_branch_name TEXT,
      to_branch_id TEXT,
      to_branch_name TEXT,
      requested_by TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      approved_by TEXT,
      approved_at TEXT,
      received_by TEXT,
      received_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id TEXT PRIMARY KEY,
      transfer_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT,
      sku TEXT,
      quantity REAL DEFAULT 0,
      received_quantity REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      table_name TEXT,
      record_id TEXT,
      action TEXT,
      user_id TEXT,
      user_name TEXT,
      branch_id TEXT,
      old_values TEXT,
      new_values TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      effective_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cost_centers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      cost_center_id TEXT NOT NULL,
      account_code TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      period_month INTEGER NOT NULL,
      budget_amount REAL DEFAULT 0,
      actual_amount REAL DEFAULT 0,
      notes TEXT,
      UNIQUE(cost_center_id, account_code, period_year, period_month)
    );
  `);

  tryAlterAdd('purchase_orders', 'freight_cost REAL DEFAULT 0');
  tryAlterAdd('purchase_orders', 'other_costs REAL DEFAULT 0');
  tryAlterAdd('purchase_orders', 'other_costs_description TEXT');
  tryAlterAdd('purchase_orders', 'freight_distributed INTEGER DEFAULT 0');
  tryAlterAdd('purchase_order_items', 'freight_allocation REAL DEFAULT 0');
  tryAlterAdd('purchase_order_items', 'effective_cost REAL DEFAULT 0');
  // Legacy databases can have a minimal products table; ensure import/API columns exist.
  tryAlterAdd('products', 'barcode TEXT');
  tryAlterAdd('products', "category TEXT DEFAULT 'GERAL'");
  tryAlterAdd('products', 'price REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'price2 REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'price3 REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'price4 REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'cost REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'first_cost REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'last_cost REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'avg_cost REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', 'stock REAL NOT NULL DEFAULT 0');
  tryAlterAdd('products', "unit TEXT DEFAULT 'UN'");
  tryAlterAdd('products', 'tax_rate REAL NOT NULL DEFAULT 14');
  tryAlterAdd('products', 'branch_id TEXT');
  tryAlterAdd('products', 'supplier_id TEXT');
  tryAlterAdd('products', 'supplier_name TEXT');
  tryAlterAdd('products', 'is_active INTEGER NOT NULL DEFAULT 1');
  tryAlterAdd('products', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  tryAlterAdd('products', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  tryAlterAdd('products', 'version INTEGER NOT NULL DEFAULT 0');

  if (!sqlite.prepare('SELECT 1 AS ok FROM cost_centers LIMIT 1').get()) {
    sqlite.prepare(
      `INSERT INTO cost_centers (id, code, name, is_active) VALUES (?, 'MAIN', 'Principal', 1)`
    ).run(crypto.randomUUID());
  }

  seedAccountingPeriods();
}

function bootstrapSchemaAndSeed() {
  const schemaSql = readSql(schemaPath);
  const seedSql = readSql(seedPath);

  if (!hasAnyUserTable() && schemaSql) {
    sqlite.exec(schemaSql);
    console.log('[DB] schema.sql applied:', schemaPath);
  }

  const hasCompanies = tableHasRows('companies') || tableHasRows('company');
  if (!hasCompanies && seedSql) {
    sqlite.exec(seedSql);
    console.log('[DB] seed.sql applied:', seedPath);
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      code TEXT UNIQUE,
      address TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      is_main INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      branch_id TEXT,
      password_hash TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      nif TEXT UNIQUE,
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      country TEXT DEFAULT 'Angola',
      contact_person TEXT DEFAULT '',
      payment_terms TEXT DEFAULT '30_days',
      notes TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6b7280',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_number TEXT,
      supplier_id TEXT,
      supplier_name TEXT,
      branch_id TEXT,
      branch_name TEXT,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT DEFAULT '',
      created_by TEXT,
      approved_by TEXT,
      approved_at TEXT,
      received_by TEXT,
      received_at TEXT,
      expected_delivery_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      order_id TEXT NOT NULL,
      product_id TEXT,
      product_name TEXT,
      sku TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      received_quantity REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      sku TEXT,
      barcode TEXT,
      category TEXT DEFAULT 'GERAL',
      price REAL NOT NULL DEFAULT 0,
      price2 REAL NOT NULL DEFAULT 0,
      price3 REAL NOT NULL DEFAULT 0,
      price4 REAL NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      first_cost REAL NOT NULL DEFAULT 0,
      last_cost REAL NOT NULL DEFAULT 0,
      avg_cost REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      unit TEXT DEFAULT 'UN',
      tax_rate REAL NOT NULL DEFAULT 14,
      branch_id TEXT,
      supplier_id TEXT,
      supplier_name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      account_type TEXT DEFAULT 'asset',
      account_nature TEXT DEFAULT 'debit',
      parent_id TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      is_header INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      opening_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      children_count INTEGER NOT NULL DEFAULT 0,
      branch_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const hasBranch = sqlite.prepare('SELECT 1 AS ok FROM branches LIMIT 1').get();
  if (!hasBranch) {
    sqlite.prepare(
      `INSERT INTO branches (id, name, code, address, phone, is_main, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    ).run('branch-main', 'Main Branch', 'MAIN', '', '');
  }

  const hasUser = sqlite.prepare('SELECT 1 AS ok FROM users LIMIT 1').get();
  if (!hasUser) {
    sqlite.prepare(
      `INSERT INTO users (id, email, name, role, branch_id, password_hash, is_active)
       VALUES (?, ?, ?, 'admin', ?, ?, 1)`
    ).run('user-admin', 'admin@nexor.local', 'System Administrator', 'branch-main', 'admin');
  }

  const hasProducts = sqlite.prepare('SELECT 1 AS ok FROM products LIMIT 1').get();
  if (!hasProducts) {
    try {
      sqlite.exec(`
        INSERT INTO products (id, name, sku, category, is_active, created_at, updated_at)
        SELECT
          CAST(id AS TEXT),
          name,
          sku,
          COALESCE(item_type, 'GERAL'),
          COALESCE(is_active, 1),
          datetime('now'),
          datetime('now')
        FROM item
      `);
    } catch {
      // item table may not exist
    }
  }

  ensureAppTablesAndColumns();
}

function toSqliteSql(sqlText) {
  return String(sqlText)
    .replace(/\$(\d+)/g, '?')
    .replace(/::[a-zA-Z_][a-zA-Z0-9_]*/g, '')
    .replace(/\bILIKE\b/g, 'LIKE')
    .replace(/\btrue\b/g, '1')
    .replace(/\bfalse\b/g, '0')
    .replace(/\s+FOR\s+UPDATE\b/gi, '');
}

function execTransactionalCommand(rawText) {
  const t = String(rawText || '').trim();
  const u = t.toUpperCase();
  if (u === 'BEGIN' || u.startsWith('BEGIN ')) {
    sqlite.exec('BEGIN');
    return { rows: [] };
  }
  if (u === 'COMMIT' || u.startsWith('COMMIT')) {
    sqlite.exec('COMMIT');
    return { rows: [] };
  }
  if (u.startsWith('ROLLBACK TO SAVEPOINT')) {
    sqlite.exec(t);
    return { rows: [] };
  }
  if (u.startsWith('RELEASE SAVEPOINT')) {
    sqlite.exec(t);
    return { rows: [] };
  }
  if (u.startsWith('SAVEPOINT')) {
    sqlite.exec(t);
    return { rows: [] };
  }
  if (u === 'ROLLBACK' || (u.startsWith('ROLLBACK') && !u.includes('TO SAVEPOINT'))) {
    sqlite.exec('ROLLBACK');
    return { rows: [] };
  }
  return null;
}

function runSqliteQuery(text, params = []) {
  const sql = toSqliteSql(text).trim();
  const stmt = sqlite.prepare(sql);
  const isSelect = /^select\b/i.test(sql);
  const hasReturning = /\breturning\b/i.test(sql);

  if (isSelect) {
    const rows = stmt.all(params);
    return { rows, rowCount: rows.length };
  }
  if (hasReturning) {
    const rows = stmt.all(params);
    return { rows, rowCount: rows.length };
  }
  const info = stmt.run(params);
  return { rows: [], rowCount: info.changes, lastInsertRowid: info.lastInsertRowid };
}

async function query(text, params = []) {
  const trimmed = String(text || '').trim();
  const tcmd = execTransactionalCommand(trimmed);
  if (tcmd) return tcmd;
  return runSqliteQuery(text, params);
}

const pool = {
  connect: async () => ({
    query,
    release: () => {},
  }),
};

try {
  bootstrapSchemaAndSeed();
  const health = sqlite.prepare("SELECT datetime('now') AS now").get();
  const productsExists = tableExists('products');
  const productsCount = productsExists
    ? sqlite.prepare('SELECT COUNT(*) AS total FROM products').get()?.total || 0
    : 0;
  console.log('[DB] Connected to SQLite:', dbPath, 'at', health.now);
  console.log(`[DB] products_table=${productsExists} products_count=${productsCount}`);
} catch (error) {
  console.error('[DB ERROR] Cannot open SQLite database:', error.message);
}

module.exports = {
  query,
  sqlite,
  pool,
  dbPath,
};
