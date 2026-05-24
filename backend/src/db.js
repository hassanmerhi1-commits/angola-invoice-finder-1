const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const DB_ENGINE = (process.env.DB_ENGINE || '').trim().toLowerCase(); // 'sqlite' | 'postgres'
const USE_POSTGRES = DB_ENGINE === 'postgres' || !!process.env.DATABASE_URL;

/** Load only when using SQLite — avoids native addon when running PostgreSQL-only. */
let Database = null;
if (!USE_POSTGRES) {
  Database = require('better-sqlite3');
}

const dbPath = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve('C:\\nexor\\erp.db');

const dbDir = path.dirname(dbPath);
if (!USE_POSTGRES) {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

let sqlite = null;
if (!USE_POSTGRES) {
  sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
}

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
  if (!sqlite) return false;
  const row = sqlite.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';"
  ).get();
  return Number(row?.count || 0) > 0;
}

function tableHasRows(tableName) {
  if (!sqlite) return false;
  try {
    const row = sqlite.prepare(`SELECT 1 AS ok FROM ${tableName} LIMIT 1`).get();
    return !!row;
  } catch {
    return false;
  }
}

function tableExists(tableName) {
  if (!sqlite) return false;
  const row = sqlite
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName);
  return !!row;
}

function tryAlterAdd(table, columnSql) {
  if (!sqlite) return;
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${columnSql}`);
  } catch (_) {}
}

/** Cities, installations, sync outbox, branch hierarchy (multi-city sync). */
function ensureOrgHierarchyTables() {
  if (!sqlite) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS cities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      province TEXT,
      municipio TEXT,
      code TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS installations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL DEFAULT 'Default',
      role TEXT NOT NULL CHECK (role IN ('main_server', 'city_server', 'shop_client')),
      city_id TEXT REFERENCES cities(id),
      branch_id TEXT REFERENCES branches(id),
      main_api_url TEXT,
      api_key TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      event_type TEXT NOT NULL,
      entity_id TEXT,
      branch_id TEXT,
      city_id TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      idempotency_key TEXT NOT NULL UNIQUE,
      destinations TEXT NOT NULL DEFAULT '[]',
      destinations_done TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_events_status ON sync_events(status, next_retry_at);
  `);

  tryAlterAdd('branches', 'city_id TEXT');
  tryAlterAdd('branches', 'parent_branch_id TEXT');
  tryAlterAdd('branches', "node_role TEXT DEFAULT 'shop'");
  tryAlterAdd('sales', 'client_request_id TEXT');
  tryAlterAdd('sales', 'saft_hash TEXT');
  tryAlterAdd('sales', 'agt_status TEXT');
  tryAlterAdd('sales', 'agt_code TEXT');
  tryAlterAdd('sales', 'agt_validated_at TEXT');

  try {
    sqlite.prepare(`UPDATE branches SET node_role = 'main' WHERE is_main = 1 AND (node_role IS NULL OR node_role = 'shop')`).run();
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
  if (!sqlite) return;
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
      branch_id TEXT NOT NULL DEFAULT '',
      current_number INTEGER NOT NULL DEFAULT 0,
      UNIQUE(document_type, fiscal_year, branch_id)
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

    CREATE TABLE IF NOT EXISTS daily_reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      date TEXT NOT NULL,
      branch_id TEXT,
      branch_name TEXT,
      total_sales REAL DEFAULT 0,
      total_transactions INTEGER DEFAULT 0,
      cash_total REAL DEFAULT 0,
      card_total REAL DEFAULT 0,
      transfer_total REAL DEFAULT 0,
      tax_collected REAL DEFAULT 0,
      opening_balance REAL DEFAULT 0,
      closing_balance REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      closed_by TEXT,
      closed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(date, branch_id)
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

    CREATE TABLE IF NOT EXISTS tax_codes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      tax_type TEXT NOT NULL DEFAULT 'IVA',
      is_active INTEGER NOT NULL DEFAULT 1,
      description TEXT DEFAULT '',
      account_code_output TEXT,
      account_code_input TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tax_lines (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      tax_code_id TEXT,
      tax_code TEXT NOT NULL,
      tax_rate REAL NOT NULL,
      base_amount REAL NOT NULL,
      tax_amount REAL NOT NULL,
      is_inclusive INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tax_lines_doc ON tax_lines(document_type, document_id);

    CREATE TABLE IF NOT EXISTS tax_summaries (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      document_type TEXT NOT NULL,
      document_id TEXT NOT NULL,
      tax_code TEXT NOT NULL,
      tax_rate REAL NOT NULL,
      total_base REAL NOT NULL,
      total_tax REAL NOT NULL,
      direction TEXT NOT NULL,
      period_year INTEGER,
      period_month INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tax_summaries_doc ON tax_summaries(document_type, document_id);
    CREATE INDEX IF NOT EXISTS idx_tax_summaries_period ON tax_summaries(period_year, period_month);

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
  tryAlterAdd('suppliers', 'balance REAL NOT NULL DEFAULT 0');
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
  tryAlterAdd('products', 'tax_rate REAL NOT NULL DEFAULT 5');
  tryAlterAdd('products', 'branch_id TEXT');
  tryAlterAdd('products', 'supplier_id TEXT');
  tryAlterAdd('products', 'supplier_name TEXT');
  tryAlterAdd('products', 'is_active INTEGER NOT NULL DEFAULT 1');
  tryAlterAdd('products', "created_at TEXT NOT NULL DEFAULT (datetime('now'))");
  tryAlterAdd('products', "updated_at TEXT NOT NULL DEFAULT (datetime('now'))");

  ensureDailyReportsSchemaSqlite();
  ensureUniqueIntegrityIndexesSqlite();
  migrateDocumentSequencesBranchScopeSqlite();
  seedDocumentSequencesSqlite();
  tryAlterAdd('products', 'version INTEGER NOT NULL DEFAULT 0');
  tryAlterAdd('products', "tax_code TEXT DEFAULT 'IVA5'");
  tryAlterAdd('users', 'username TEXT');

  ensureOrgHierarchyTables();

  const taxCodeCount = sqlite.prepare('SELECT COUNT(*) AS count FROM tax_codes').get();
  if (Number(taxCodeCount?.count || 0) === 0) {
    const insertTaxCode = sqlite.prepare(`
      INSERT OR IGNORE INTO tax_codes
        (code, name, rate, tax_type, account_code_output, account_code_input, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    [
      ['IVA14', 'IVA Normal', 14, 'IVA', '3.3.2', '3.3.1', 'Taxa normal de IVA em Angola'],
      ['IVA0', 'IVA Zero', 0, 'IVA', '3.3.2', '3.3.1', 'Taxa zero de IVA'],
      ['ISENTO', 'Isento de IVA', 0, 'IVA', null, null, 'Operacoes isentas de IVA'],
      ['IVA5', 'IVA Reduzida', 5, 'IVA', '3.3.2', '3.3.1', 'Taxa reduzida de IVA'],
      ['IVA7', 'IVA Intermedia', 7, 'IVA', '3.3.2', '3.3.1', 'Taxa intermedia de IVA'],
      ['RET3.5', 'Retencao na Fonte 3.5%', 3.5, 'RETENCAO', '3.4.1', '3.4.1', 'Retencao na fonte de rendimentos'],
      ['RET6.5', 'Retencao na Fonte 6.5%', 6.5, 'RETENCAO', '3.4.1', '3.4.1', 'Retencao na fonte de servicos'],
      ['IS', 'Imposto de Selo', 0.1, 'IS', '3.5.1', '3.5.1', 'Imposto de selo'],
    ].forEach((row) => insertTaxCode.run(...row));
  }

  if (!sqlite.prepare('SELECT 1 AS ok FROM cost_centers LIMIT 1').get()) {
    sqlite.prepare(
      `INSERT INTO cost_centers (id, code, name, is_active) VALUES (?, 'MAIN', 'Principal', 1)`
    ).run(crypto.randomUUID());
  }

  seedAccountingPeriods();
  repairMisboundProductColumns();
  backfillJournalEntryBranchIds();
  backfillAllSkuStockFromMovements();
  ensureEntityBalanceView();
  scheduleDataConsistencyRepair();
}

function scheduleDataConsistencyRepair() {
  setImmediate(() => {
    const { runDataConsistencyRepair } = require('./dataConsistencyRepair');
    runDataConsistencyRepair()
      .then((report) => {
        const fixes =
          (report.supplierBalances?.updated || 0) +
          (report.clientBalances?.updated || 0) +
          (report.duplicateSkusRenamed || 0) +
          (report.productStockReconciled || 0);
        if (fixes > 0) {
          console.log('[DB] Data consistency repair:', JSON.stringify(report));
        }
      })
      .catch((err) => {
        console.warn('[DB] Data consistency repair skipped:', err.message);
      });
  });
}

function ensureEntityBalanceView() {
  if (USE_POSTGRES) return;
  try {
    sqlite.exec(`
      CREATE VIEW IF NOT EXISTS v_entity_balance AS
      SELECT
        entity_type,
        entity_id,
        COALESCE(SUM(CASE WHEN is_debit = 1 THEN remaining_amount ELSE -remaining_amount END), 0) AS balance,
        COALESCE(SUM(CASE WHEN status != 'cleared' THEN 1 ELSE 0 END), 0) AS open_items_count
      FROM open_items
      GROUP BY entity_type, entity_id
    `);
  } catch (err) {
    console.warn('[DB] v_entity_balance view:', err.message);
  }
}

function scheduleSupplierBalanceRepair() {
  const { runSupplierBalanceRepair } = require('./supplierBalanceRepair');
  setImmediate(() => {
    runSupplierBalanceRepair().catch((err) => {
      console.warn('[DB] Supplier balance repair failed:', err.message);
    });
  });
}

function backfillAllSkuStockFromMovements() {
  if (!sqlite || !tableExists('stock_movements') || !tableExists('products')) return;
  try {
    const pairs = sqlite.prepare(`
      SELECT DISTINCT TRIM(pm.sku) AS sku, sm.warehouse_id AS warehouse_id
      FROM stock_movements sm
      INNER JOIN products pm ON pm.id = sm.product_id
      WHERE pm.sku IS NOT NULL AND TRIM(pm.sku) != ''
        AND sm.warehouse_id IS NOT NULL AND TRIM(sm.warehouse_id) != ''
    `).all();
    const sumStmt = sqlite.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN sm.movement_type = 'IN' THEN sm.quantity
          WHEN sm.movement_type = 'OUT' THEN -sm.quantity
          ELSE 0
        END
      ), 0) AS total
      FROM stock_movements sm
      INNER JOIN products pm ON pm.id = sm.product_id
      WHERE sm.warehouse_id = ?
        AND LOWER(TRIM(COALESCE(pm.sku, ''))) = LOWER(?)
    `);
    const updateByProductStmt = sqlite.prepare(`
      UPDATE products
      SET stock = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    const seenProductIds = new Set();
    for (const row of pairs) {
      const movers = sqlite.prepare(
        `SELECT DISTINCT product_id FROM stock_movements
         WHERE warehouse_id = ? AND product_id IN (
           SELECT id FROM products WHERE LOWER(TRIM(COALESCE(sku, ''))) = LOWER(?)
         )`,
      ).all(row.warehouse_id, row.sku);
      for (const m of movers) {
        if (!m.product_id || seenProductIds.has(m.product_id)) continue;
        seenProductIds.add(m.product_id);
        const sumRow = sqlite.prepare(
          `SELECT COALESCE(SUM(
             CASE WHEN movement_type = 'IN' THEN quantity
                  WHEN movement_type = 'OUT' THEN -quantity ELSE 0 END
           ), 0) AS total
           FROM stock_movements WHERE product_id = ? AND warehouse_id = ?`,
        ).get(m.product_id, row.warehouse_id);
        const total = Number(sumRow?.total || 0);
        updateByProductStmt.run(total, m.product_id);
      }
    }
    if (pairs.length > 0) {
      console.log(`[DB] Reconciled stock for ${pairs.length} SKU/warehouse pair(s) from movements`);
    }
  } catch (error) {
    console.warn('[DB] SKU stock backfill skipped:', error.message);
  }
}

function backfillJournalEntryBranchIds() {
  if (!sqlite || !tableExists('journal_entries')) return;
  try {
    const mainBranch =
      sqlite.prepare(
        `SELECT id FROM branches WHERE is_main = 1 AND is_active = 1 ORDER BY created_at LIMIT 1`,
      ).get()
      || sqlite.prepare(`SELECT id FROM branches WHERE is_active = 1 ORDER BY created_at LIMIT 1`).get();
    if (!mainBranch?.id) return;
    sqlite
      .prepare(
        `UPDATE journal_entries
         SET branch_id = ?
         WHERE branch_id IS NULL OR TRIM(COALESCE(branch_id, '')) = ''`,
      )
      .run(mainBranch.id);
  } catch (error) {
    console.warn('[DB] journal_entries branch backfill skipped:', error.message);
  }
}

function migrateDocumentSequencesBranchScopeSqlite() {
  if (!sqlite || !tableExists('document_sequences')) return;

  const tableSql = String(
    sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='document_sequences'").get()?.sql || ''
  );
  const hasBranchInSchema = tableSql.includes('branch_id');

  if (!hasBranchInSchema) {
    try {
      sqlite.exec(`
        CREATE TABLE document_sequences_mig (
          id TEXT PRIMARY KEY,
          document_type TEXT NOT NULL,
          prefix TEXT,
          fiscal_year INTEGER NOT NULL,
          branch_id TEXT NOT NULL DEFAULT '',
          current_number INTEGER NOT NULL DEFAULT 0,
          UNIQUE(document_type, fiscal_year, branch_id)
        );
        INSERT INTO document_sequences_mig (id, document_type, prefix, fiscal_year, branch_id, current_number)
          SELECT id, document_type, prefix, fiscal_year, '', current_number
          FROM document_sequences;
        DROP TABLE document_sequences;
        ALTER TABLE document_sequences_mig RENAME TO document_sequences;
      `);
      console.log('[DB] document_sequences migrated to per-branch scope');
    } catch (err) {
      console.warn('[DB] document_sequences migration:', err.message);
      tryAlterAdd('document_sequences', "branch_id TEXT NOT NULL DEFAULT ''");
    }
  }
}

function parseFcSequenceFromNumber(documentNumber, branchCode, yr) {
  const code = String(branchCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SEDE';
  const perBranch = new RegExp(`^FC-${code}-${yr}-(\\d+)$`, 'i');
  const m1 = String(documentNumber || '').match(perBranch);
  if (m1) return parseInt(m1[1], 10);
  const global = new RegExp(`^FC-${yr}-(\\d+)$`, 'i');
  const m2 = String(documentNumber || '').match(global);
  if (m2) return parseInt(m2[1], 10);
  return 0;
}

function maxPurchaseInvoiceSequenceForBranch(branchId, branchCode, yr) {
  if (!tableExists('open_items')) return 0;
  const yearPrefix = `${yr}%`;
  let maxSeq = 0;
  try {
    const rows = sqlite.prepare(
      `SELECT document_number FROM open_items
       WHERE document_type IN ('fatura_compra', 'purchase_invoice')
         AND branch_id = ?
         AND (document_date LIKE ? OR document_number LIKE ? OR document_number LIKE ?)`
    ).all(branchId, yearPrefix, `FC-${branchCode}-${yr}-%`, `FC-${yr}-%`);
    for (const row of rows) {
      maxSeq = Math.max(maxSeq, parseFcSequenceFromNumber(row.document_number, branchCode, yr));
    }
  } catch {
    /* ignore */
  }
  return maxSeq;
}

/** Seed document_sequences from existing rows (idempotent). */
function seedDocumentSequencesSqlite() {
  if (!sqlite || !tableExists('document_sequences')) return;
  migrateDocumentSequencesBranchScopeSqlite();
  const yr = new Date().getFullYear();
  const yearPrefix = `${yr}%`;
  const globalSeeds = [
    ['invoice', 'INV', () => {
      try {
        return sqlite.prepare(
          `SELECT COUNT(*) AS c FROM sales WHERE created_at LIKE ? OR invoice_number LIKE ?`
        ).get(yearPrefix, `INV-${yr}-%`)?.c || 0;
      } catch {
        return 0;
      }
    }],
    ['payment_receipt', 'REC', () => countTableYear('payments', "payment_type = 'receipt'")],
    ['payment_out', 'PAG', () => countTableYear('payments', "payment_type = 'payment'")],
    ['purchase_order', 'PO', () => countTableYear('purchase_orders')],
    ['stock_transfer', 'TRF', () => countTableYear('stock_transfers')],
    ['journal', 'JE', () => countTableYear('journal_entries')],
  ];

  const ins = sqlite.prepare(`
    INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
    VALUES (?, ?, ?, ?, '', ?)
    ON CONFLICT(document_type, fiscal_year, branch_id) DO UPDATE SET
      prefix = excluded.prefix,
      current_number = MAX(document_sequences.current_number, excluded.current_number)
  `);

  for (const [docType, prefix, countFn] of globalSeeds) {
    try {
      const n = Number(countFn());
      ins.run(crypto.randomUUID(), docType, prefix, yr, n);
    } catch (err) {
      console.warn(`[DB] seed sequence ${docType}:`, err.message);
    }
  }

  if (!tableExists('branches')) return;
  const insBranch = sqlite.prepare(`
    INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
    VALUES (?, 'purchase_invoice', 'FC', ?, ?, ?)
    ON CONFLICT(document_type, fiscal_year, branch_id) DO UPDATE SET
      current_number = MAX(document_sequences.current_number, excluded.current_number)
  `);
  try {
    const branches = sqlite.prepare('SELECT id, code FROM branches WHERE is_active = 1 OR is_active IS NULL').all();
    for (const branch of branches) {
      const code = String(branch.code || 'SEDE').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'SEDE';
      const maxSeq = maxPurchaseInvoiceSequenceForBranch(branch.id, code, yr);
      insBranch.run(crypto.randomUUID(), yr, branch.id, maxSeq);
    }
  } catch (err) {
    console.warn('[DB] seed purchase_invoice per branch:', err.message);
  }
}

function countTableYear(table, extraWhere = '1=1') {
  if (!tableExists(table)) return 0;
  const yr = new Date().getFullYear();
  const row = sqlite.prepare(
    `SELECT COUNT(*) AS c FROM ${table} WHERE (${extraWhere}) AND created_at LIKE ?`
  ).get(`${yr}%`);
  return Number(row?.c || 0);
}

/** Enforce uniqueness on business numbers (SQLite desktop DB). */
function ensureUniqueIntegrityIndexesSqlite() {
  if (!sqlite) return;
  const indexes = [
    ['idx_sales_invoice_number', 'sales', 'invoice_number', "invoice_number IS NOT NULL AND invoice_number != ''"],
    ['idx_payments_payment_number', 'payments', 'payment_number', "payment_number IS NOT NULL AND payment_number != ''"],
    ['idx_po_order_number', 'purchase_orders', 'order_number', "order_number IS NOT NULL AND order_number != ''"],
    ['idx_journal_entry_number', 'journal_entries', 'entry_number', "entry_number IS NOT NULL AND entry_number != ''"],
    ['idx_stock_transfer_number', 'stock_transfers', 'transfer_number', "transfer_number IS NOT NULL AND transfer_number != ''"],
    ['idx_supplier_returns_return_number', 'supplier_returns', 'return_number', "return_number IS NOT NULL AND return_number != ''"],
    ['idx_products_sku_branch', 'products', 'sku, branch_id', "sku IS NOT NULL AND TRIM(sku) != ''"],
    ['idx_open_items_document_id', 'open_items', 'document_id', "document_id IS NOT NULL AND document_id != ''"],
    ['idx_purchase_invoices_number_branch', 'purchase_invoices', 'invoice_number, branch_id', "invoice_number IS NOT NULL AND invoice_number != ''"],
    ['idx_purchase_invoices_supplier_invoice_no', 'purchase_invoices', 'supplier_id, supplier_invoice_no', "supplier_invoice_no IS NOT NULL AND TRIM(supplier_invoice_no) != '' AND supplier_id IS NOT NULL AND TRIM(supplier_id) != ''"],
  ];
  for (const [name, table, cols, where] of indexes) {
    if (!tableExists(table)) continue;
    try {
      sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table}(${cols}) WHERE ${where}`
      );
    } catch (err) {
      console.warn(`[DB] unique index ${name}:`, err.message);
    }
  }
}

function ensureDailyReportsSchemaSqlite() {
  if (!sqlite) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS daily_reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      date TEXT NOT NULL,
      branch_id TEXT,
      branch_name TEXT,
      total_sales REAL DEFAULT 0,
      total_transactions INTEGER DEFAULT 0,
      cash_total REAL DEFAULT 0,
      card_total REAL DEFAULT 0,
      transfer_total REAL DEFAULT 0,
      tax_collected REAL DEFAULT 0,
      opening_balance REAL DEFAULT 0,
      closing_balance REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      closed_by TEXT,
      closed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    sqlite.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reports_date_branch ON daily_reports(date, branch_id)'
    );
  } catch (err) {
    console.warn('[DB] daily_reports unique index:', err.message);
  }
}

async function ensureDailyReportsSchema() {
  if (USE_POSTGRES) {
    await query(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date DATE NOT NULL,
        branch_id UUID REFERENCES branches(id),
        branch_name VARCHAR(255),
        total_sales DECIMAL(15, 2) DEFAULT 0,
        total_transactions INTEGER DEFAULT 0,
        cash_total DECIMAL(15, 2) DEFAULT 0,
        card_total DECIMAL(15, 2) DEFAULT 0,
        transfer_total DECIMAL(15, 2) DEFAULT 0,
        tax_collected DECIMAL(15, 2) DEFAULT 0,
        opening_balance DECIMAL(15, 2) DEFAULT 0,
        closing_balance DECIMAL(15, 2) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'open',
        closed_by UUID REFERENCES users(id),
        closed_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, branch_id)
      )
    `);
    return;
  }
  ensureDailyReportsSchemaSqlite();
}

/** Fix rows saved while INSERT bound $11+ to wrong columns (extra cost params). */
function repairMisboundProductColumns() {
  if (!sqlite) return;
  try {
    const rows = sqlite.prepare(`
      SELECT id, stock, unit, tax_rate, cost, is_active, branch_id
      FROM products
      WHERE (typeof(is_active) = 'text' AND is_active NOT IN ('0', '1'))
         OR (
           branch_id IS NOT NULL
           AND instr(branch_id, '-') = 0
           AND branch_id GLOB '*[0-9]*'
         )
    `).all();
    if (!rows.length) return;

    const upd = sqlite.prepare(`
      UPDATE products
      SET stock = ?, unit = ?, tax_rate = ?, branch_id = NULL, is_active = 1,
          supplier_id = NULL, updated_at = datetime('now')
      WHERE id = ?
    `);
    for (const row of rows) {
      const shiftedStock = parseFloat(String(row.branch_id)) || Number(row.stock) || 0;
      const shiftedUnit =
        typeof row.is_active === 'string' && row.is_active.length <= 6
          ? String(row.is_active)
          : String(row.unit || 'un');
      let tax = Number(row.tax_rate);
      if (!Number.isFinite(tax) || tax === Number(row.cost)) tax = 14;
      upd.run(shiftedStock, shiftedUnit, tax, row.id);
    }
    console.log(`[DB] Repaired ${rows.length} product row(s) with misbound INSERT columns`);
  } catch (e) {
    console.warn('[DB] repairMisboundProductColumns:', e.message);
  }
}

function seedDefaultChartOfAccounts() {
  if (!sqlite) return;

  const accounts = [
    ['1', 'Meios Fixos e Investimentos', 'asset', 'debit', 1, 1, null],
    ['2', 'Existências', 'asset', 'debit', 1, 1, null],
    ['2.1', 'Compras', 'asset', 'debit', 2, 1, '2'],
    ['2.1.1', 'Mercadorias', 'asset', 'debit', 3, 0, '2.1'],
    ['2.2', 'Mercadorias', 'asset', 'debit', 2, 0, '2'],
    ['3', 'Terceiros', 'asset', 'debit', 1, 1, null],
    ['3.1', 'Clientes', 'asset', 'debit', 2, 0, '3'],
    ['3.1.1', 'Clientes c/c', 'asset', 'debit', 3, 0, '3.1'],
    ['3.2', 'Fornecedores', 'liability', 'credit', 2, 0, '3'],
    ['3.2.1', 'Fornecedores c/c', 'liability', 'credit', 3, 0, '3.2'],
    ['3.3', 'Estado e Outros Entes Públicos', 'liability', 'credit', 2, 1, '3'],
    ['3.3.1', 'IVA Dedutível', 'liability', 'debit', 3, 0, '3.3'],
    ['3.3.2', 'IVA Liquidado', 'liability', 'credit', 3, 0, '3.3'],
    ['3.4', 'Pessoal', 'liability', 'credit', 2, 1, '3'],
    ['3.4.1', 'Retenção na Fonte a Pagar', 'liability', 'credit', 3, 0, '3.4'],
    ['3.5', 'Outros Impostos', 'liability', 'credit', 2, 1, '3'],
    ['3.5.1', 'Imposto de Selo a Pagar', 'liability', 'credit', 3, 0, '3.5'],
    ['4', 'Meios Monetários', 'asset', 'debit', 1, 1, null],
    ['4.1', 'Caixa', 'asset', 'debit', 2, 0, '4'],
    ['4.1.1', 'Caixa Principal', 'asset', 'debit', 3, 0, '4.1'],
    ['4.2', 'Depósitos à Ordem', 'asset', 'debit', 2, 0, '4'],
    ['4.2.1', 'Banco Principal', 'asset', 'debit', 3, 0, '4.2'],
    ['5', 'Capital Próprio', 'equity', 'credit', 1, 1, null],
    ['6', 'Gastos e Perdas', 'expense', 'debit', 1, 1, null],
    ['6.1', 'Custo das Mercadorias Vendidas', 'expense', 'debit', 2, 0, '6'],
    ['6.2', 'Fornecimentos e Serviços Externos', 'expense', 'debit', 2, 1, '6'],
    ['6.2.6', 'Transporte sobre Compras', 'expense', 'debit', 3, 0, '6.2'],
    ['7', 'Rendimentos e Ganhos', 'revenue', 'credit', 1, 1, null],
    ['7.1', 'Vendas', 'revenue', 'credit', 2, 0, '7'],
    ['7.1.1', 'Vendas de Mercadorias', 'revenue', 'credit', 3, 0, '7.1'],
  ];

  const idForCode = (code) => `coa-${String(code).replace(/[^A-Za-z0-9]/g, '-')}`;
  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO chart_of_accounts
      (id, code, name, account_type, account_nature, parent_id, level, is_header, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const updateParent = sqlite.prepare('UPDATE chart_of_accounts SET parent_id = ? WHERE code = ?');

  for (const [code, name, type, nature, level, isHeader, parentCode] of accounts) {
    insert.run(idForCode(code), code, name, type, nature, parentCode ? idForCode(parentCode) : null, level, isHeader);
    if (parentCode) updateParent.run(idForCode(parentCode), code);
  }

  sqlite.exec(`
    UPDATE chart_of_accounts
    SET children_count = (
      SELECT COUNT(*) FROM chart_of_accounts child
      WHERE child.parent_id = chart_of_accounts.id AND child.is_active = 1
    )
  `);
}

function bootstrapSchemaAndSeed() {
  if (!sqlite) return;
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
      username TEXT,
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
      balance REAL NOT NULL DEFAULT 0,
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
      tax_rate REAL NOT NULL DEFAULT 5,
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

    CREATE TABLE IF NOT EXISTS supplier_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT NOT NULL,
      branch_id TEXT,
      branch_name TEXT DEFAULT '',
      purchase_order_id TEXT,
      purchase_order_number TEXT DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_name TEXT DEFAULT '',
      reason TEXT DEFAULT 'other',
      reason_description TEXT DEFAULT '',
      items_json TEXT DEFAULT '[]',
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_by TEXT DEFAULT '',
      approved_at TEXT,
      shipped_at TEXT,
      completed_at TEXT,
      notes TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id TEXT PRIMARY KEY,
      invoice_number TEXT NOT NULL,
      supplier_account_code TEXT DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      supplier_id TEXT DEFAULT '',
      supplier_nif TEXT DEFAULT '',
      supplier_phone TEXT DEFAULT '',
      supplier_balance REAL NOT NULL DEFAULT 0,
      ref TEXT DEFAULT '',
      supplier_invoice_no TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      department TEXT DEFAULT '',
      ref2 TEXT DEFAULT '',
      date TEXT NOT NULL,
      payment_date TEXT,
      project TEXT DEFAULT '',
      currency TEXT DEFAULT 'KZ',
      warehouse_id TEXT DEFAULT '',
      warehouse_name TEXT DEFAULT '',
      price_type TEXT DEFAULT 'last_price',
      address TEXT DEFAULT '',
      purchase_account_code TEXT DEFAULT '2.1.1',
      iva_account_code TEXT DEFAULT '3.3.1',
      transaction_type TEXT DEFAULT 'ALL',
      currency_rate REAL NOT NULL DEFAULT 1,
      tax_rate_2 REAL NOT NULL DEFAULT 0,
      order_no TEXT DEFAULT '',
      surcharge_percent REAL NOT NULL DEFAULT 0,
      change_price INTEGER NOT NULL DEFAULT 0,
      is_pending INTEGER NOT NULL DEFAULT 0,
      extra_note TEXT DEFAULT '',
      lines_json TEXT NOT NULL DEFAULT '[]',
      journal_lines_json TEXT NOT NULL DEFAULT '[]',
      subtotal REAL NOT NULL DEFAULT 0,
      iva_total REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      purchase_returns_status TEXT DEFAULT 'none',
      purchase_returns_closed_at TEXT,
      branch_id TEXT DEFAULT '',
      branch_name TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_by_name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_invoices_number_branch
        ON purchase_invoices(invoice_number, branch_id)
        WHERE invoice_number IS NOT NULL AND invoice_number != ''
    `);
  } catch (err) {
    console.warn('[DB] purchase_invoices unique index:', err.message);
  }

  seedDefaultChartOfAccounts();

  const hasBranch = sqlite.prepare('SELECT 1 AS ok FROM branches LIMIT 1').get();
  if (!hasBranch) {
    sqlite.prepare(
      `INSERT INTO branches (id, name, code, address, phone, is_main, is_active)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    ).run('branch-main', 'Main Branch', 'MAIN', '', '');
  }

  const hasUser = sqlite.prepare('SELECT 1 AS ok FROM users LIMIT 1').get();
  if (!hasUser) {
    const bcrypt = require('bcryptjs');
    const adminHash = bcrypt.hashSync('changeme', 12);
    sqlite.prepare(
      `INSERT INTO users (id, email, name, role, branch_id, password_hash, is_active)
       VALUES (?, ?, ?, 'admin', ?, ?, 1)`
    ).run(
      'user-admin',
      'admin@kwanzaerp.ao',
      'System Administrator',
      'branch-main',
      adminHash,
    );
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
  normalizeAdminBranchAssignments();
}

/** Point admin/manager users at head office when branch_id is missing or stale. */
function normalizeAdminBranchAssignments() {
  if (!sqlite) return;
  try {
    const main = sqlite
      .prepare(`SELECT id FROM branches WHERE is_main = 1 ORDER BY created_at LIMIT 1`)
      .get();
    if (!main?.id) return;
    sqlite
      .prepare(
        `UPDATE users
         SET branch_id = ?
         WHERE LOWER(COALESCE(role, '')) IN ('admin', 'manager')
           AND (
             branch_id IS NULL
             OR TRIM(COALESCE(branch_id, '')) = ''
             OR branch_id NOT IN (SELECT id FROM branches)
           )`,
      )
      .run(main.id);
  } catch (err) {
    console.warn('[DB] normalizeAdminBranchAssignments:', err.message);
  }
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

function normalizeSqliteParam(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'undefined') return null;
  return value;
}

function normalizeSqliteParams(params = []) {
  return Array.isArray(params) ? params.map(normalizeSqliteParam) : params;
}

function expandPgPlaceholdersForSqlite(sqlText, params = []) {
  if (!Array.isArray(params) || !/\$\d+/.test(String(sqlText))) {
    return normalizeSqliteParams(params);
  }

  const expanded = [];
  const matches = String(sqlText).matchAll(/\$(\d+)/g);
  for (const match of matches) {
    expanded.push(params[Number(match[1]) - 1]);
  }
  return normalizeSqliteParams(expanded);
}

function runSqliteQuery(text, params = []) {
  const sql = toSqliteSql(text).trim();
  const stmt = sqlite.prepare(sql);
  const sqliteParams = expandPgPlaceholdersForSqlite(text, params);
  const isSelect = /^select\b/i.test(sql);
  const hasReturning = /\breturning\b/i.test(sql);

  if (isSelect) {
    const rows = stmt.all(sqliteParams);
    return { rows, rowCount: rows.length };
  }
  if (hasReturning) {
    const rows = stmt.all(sqliteParams);
    return { rows, rowCount: rows.length };
  }
  const info = stmt.run(sqliteParams);
  return { rows: [], rowCount: info.changes, lastInsertRowid: info.lastInsertRowid };
}

async function query(text, params = []) {
  if (USE_POSTGRES) {
    // `pg` supports BEGIN/COMMIT/ROLLBACK natively; keep same return shape.
    const result = await pgPool.query(text, params);
    return { rows: result.rows || [], rowCount: result.rowCount };
  }

  const trimmed = String(text || '').trim();
  const tcmd = execTransactionalCommand(trimmed);
  if (tcmd) return tcmd;
  return runSqliteQuery(text, params);
}

let pgPool = null;
let pool = null;
if (USE_POSTGRES) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  });
  pool = pgPool;
} else {
  pool = {
    connect: async () => ({
      query,
      release: () => {},
    }),
  };
}

try {
  if (!USE_POSTGRES) {
    bootstrapSchemaAndSeed();
    const health = sqlite.prepare("SELECT datetime('now') AS now").get();
    const productsExists = tableExists('products');
    const productsCount = productsExists
      ? sqlite.prepare('SELECT COUNT(*) AS total FROM products').get()?.total || 0
      : 0;
    console.log('[DB] Connected to SQLite:', dbPath, 'at', health.now);
    console.log(`[DB] products_table=${productsExists} products_count=${productsCount}`);
  } else {
    console.log('[DB] Using PostgreSQL:', process.env.DATABASE_URL ? '[DATABASE_URL set]' : '[missing DATABASE_URL]');
  }
} catch (error) {
  if (USE_POSTGRES) {
    console.error('[DB ERROR] PostgreSQL init failed:', error.message);
  } else {
    console.error('[DB ERROR] Cannot open SQLite database:', error.message);
  }
}

function openSqliteConnection() {
  if (USE_POSTGRES) {
    throw new Error('SQLite is not active');
  }
  if (sqlite) return sqlite;
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  return sqlite;
}

/** Close SQLite handle (used before full database file restore). */
function closeSqliteConnection() {
  if (!sqlite) return;
  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch (_) {
    /* ignore */
  }
  try {
    sqlite.close();
  } catch (_) {
    /* ignore */
  }
  sqlite = null;
}

/** Reopen SQLite after restore; reapplies schema guards. */
function reopenSqliteConnection() {
  if (USE_POSTGRES) {
    throw new Error('SQLite is not active');
  }
  closeSqliteConnection();
  openSqliteConnection();
  ensureAppTablesAndColumns();
  return sqlite;
}

module.exports = {
  query,
  sqlite,
  pool,
  dbPath,
  engine: USE_POSTGRES ? 'postgres' : 'sqlite',
  ensureDailyReportsSchema,
  closeSqliteConnection,
  reopenSqliteConnection,
  openSqliteConnection,
};
