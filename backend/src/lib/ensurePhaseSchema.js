/**
 * Apply phase 1–5 schema patches at startup (PostgreSQL + safety net for SQLite).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { applyPostgresMigrations } = require('../migrations/applyMigrations');
const { repairCreditNoteCaixaGlAccounts } = require('./creditNoteCaixaGlRepair');
const { ensureAllBranchCaixaAccounts } = require('./branchCaixaAccounts');
const { linkOrphanBranchCaixaAccounts } = require('./resolveBranchCaixaGlAccount');

/** Idempotent — legacy DBs may lack restore_stock if migration 033 was skipped. */
/** Drop legacy CHECK on audit_log.action (PG) so fiscal events are not rejected. */
async function ensureAuditLogActions(db) {
  if (db.engine !== 'postgres') return;
  try {
    await db.query('ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check');
  } catch (_) {}
  try {
    await db.query('ALTER TABLE audit_log ALTER COLUMN action TYPE VARCHAR(64)');
  } catch (_) {}
  for (const col of [
    'ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata JSONB',
    'ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS workstation_id VARCHAR(255)',
    'ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64)',
  ]) {
    try {
      await db.query(col);
    } catch (err) {
      if (err.code !== '42701') console.warn('[SCHEMA] audit_log column:', err.message);
    }
  }
}

/** Legacy PostgreSQL DBs may lack document_sequences.branch_id (migration 017 skipped). */
async function ensureDocumentSequencesBranchScope(db) {
  if (db.engine !== 'postgres') return;
  try {
    await db.query(
      `ALTER TABLE public.document_sequences
       ADD COLUMN IF NOT EXISTS branch_id VARCHAR(64) NOT NULL DEFAULT ''`,
    );
    await db.query(
      'ALTER TABLE public.document_sequences DROP CONSTRAINT IF EXISTS document_sequences_document_type_fiscal_year_key',
    );
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_document_sequences_scope
       ON public.document_sequences(document_type, fiscal_year, branch_id)`,
    );
  } catch (err) {
    console.warn('[SCHEMA] document_sequences branch scope:', err.message);
  }
}

/** Per-client pricing controls (migration 046): default price level + signed % adjustment
 *  + payment terms in days (how long the client has to settle what they owe). */
async function ensureClientPricingColumns(db) {
  if (db.engine === 'postgres') {
    for (const stmt of [
      'ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_price_level INTEGER DEFAULT 1',
      'ALTER TABLE clients ADD COLUMN IF NOT EXISTS price_adjustment_pct NUMERIC(7,2) DEFAULT 0',
      'ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER DEFAULT 0',
    ]) {
      try {
        await db.query(stmt);
      } catch (err) {
        if (err.code !== '42701') console.warn('[SCHEMA] clients pricing column:', err.message);
      }
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(clients)');
    } catch (_) {
      return;
    }
    if (!cols.length) return;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('default_price_level')) {
      try {
        db.sqlite.exec('ALTER TABLE clients ADD COLUMN default_price_level INTEGER DEFAULT 1');
      } catch (_) {}
    }
    if (!names.has('price_adjustment_pct')) {
      try {
        db.sqlite.exec('ALTER TABLE clients ADD COLUMN price_adjustment_pct REAL DEFAULT 0');
      } catch (_) {}
    }
    if (!names.has('payment_terms_days')) {
      try {
        db.sqlite.exec('ALTER TABLE clients ADD COLUMN payment_terms_days INTEGER DEFAULT 0');
      } catch (_) {}
    }
  }
}

/** Allow `credit` (on-account) sales in payment_method CHECK constraints. Returns true when DB allows credit. */
async function ensureSalesCreditPaymentMethod(db) {
  const allowedList = "('cash', 'card', 'transfer', 'cheque', 'mixed', 'credit')";
  if (db.engine === 'postgres') {
    try {
      const found = await db.query(
        `SELECT c.conname AS name, pg_get_constraintdef(c.oid) AS def
         FROM pg_constraint c
         JOIN pg_class t ON c.conrelid = t.oid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public'
           AND t.relname = 'sales'
           AND c.contype = 'c'
           AND pg_get_constraintdef(c.oid) ILIKE '%payment_method%'`,
      );
      for (const row of found.rows || []) {
        const name = row.name;
        if (!name) continue;
        try {
          await db.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS "${name}"`);
        } catch (dropErr) {
          console.warn(`[SCHEMA] drop sales constraint ${name}:`, dropErr.message);
        }
      }
    } catch (err) {
      console.warn('[SCHEMA] list sales.payment_method constraints:', err.message);
    }
    for (const name of ['sales_payment_method_check', 'chk_sales_payment_method']) {
      try {
        await db.query(`ALTER TABLE sales DROP CONSTRAINT IF EXISTS ${name}`);
      } catch (_) {}
    }
    try {
      await db.query(
        `ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
         CHECK (payment_method IN ${allowedList})`,
      );
    } catch (err) {
      if (err.code !== '42710') {
        console.warn('[SCHEMA] sales.payment_method credit ADD:', err.message);
      }
    }
    try {
      const { salesAllowsCreditPayment } = require('./schemaChecks');
      const ok = await salesAllowsCreditPayment(db);
      if (!ok) {
        console.error('[SCHEMA] FATAL: sales.payment_method still rejects credit after repair');
      }
      return ok;
    } catch (_) {
      return false;
    }
  }
  if (db.sqlite) {
    // SQLite local dev: recreate sales CHECK if present (table rebuild not required — often no CHECK).
    return true;
  }
  return true;
}

/** POS caixa session tables (city server sync + GL reconciliation). */
async function ensureCaixaTables(db) {
  if (db.engine === 'postgres') {
    for (const stmt of [
      `CREATE TABLE IF NOT EXISTS caixas (
        id UUID PRIMARY KEY,
        branch_id UUID,
        branch_name VARCHAR(255) DEFAULT '',
        name VARCHAR(255) NOT NULL DEFAULT '',
        opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
        current_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
        closing_balance DECIMAL(15, 2),
        status VARCHAR(20) NOT NULL DEFAULT 'closed',
        petty_limit DECIMAL(15, 2) DEFAULT 0,
        daily_limit DECIMAL(15, 2) DEFAULT 0,
        requires_approval BOOLEAN NOT NULL DEFAULT false,
        opened_by VARCHAR(255) DEFAULT '',
        closed_by VARCHAR(255) DEFAULT '',
        opened_at TIMESTAMP,
        closed_at TIMESTAMP,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS caixa_sessions (
        id UUID PRIMARY KEY,
        caixa_id UUID,
        branch_id UUID,
        date DATE NOT NULL,
        opening_balance DECIMAL(15, 2) NOT NULL DEFAULT 0,
        closing_balance DECIMAL(15, 2),
        total_in DECIMAL(15, 2) NOT NULL DEFAULT 0,
        total_out DECIMAL(15, 2) NOT NULL DEFAULT 0,
        sales_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
        expenses_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
        adjustments DECIMAL(15, 2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        opened_by VARCHAR(255) DEFAULT '',
        closed_by VARCHAR(255) DEFAULT '',
        opened_at TIMESTAMP,
        closed_at TIMESTAMP,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      'CREATE INDEX IF NOT EXISTS idx_caixa_sessions_branch ON caixa_sessions(branch_id, date DESC)',
      'CREATE INDEX IF NOT EXISTS idx_caixas_branch ON caixas(branch_id)',
    ]) {
      try {
        await db.query(stmt);
      } catch (err) {
        console.warn('[SCHEMA] caixa table:', err.message);
      }
    }
    return;
  }

  if (db.sqlite) {
    try {
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS caixas (
          id TEXT PRIMARY KEY,
          branch_id TEXT,
          branch_name TEXT DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          opening_balance REAL NOT NULL DEFAULT 0,
          current_balance REAL NOT NULL DEFAULT 0,
          closing_balance REAL,
          status TEXT NOT NULL DEFAULT 'closed',
          petty_limit REAL DEFAULT 0,
          daily_limit REAL DEFAULT 0,
          requires_approval INTEGER NOT NULL DEFAULT 0,
          opened_by TEXT DEFAULT '',
          closed_by TEXT DEFAULT '',
          opened_at TEXT,
          closed_at TEXT,
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS caixa_sessions (
          id TEXT PRIMARY KEY,
          caixa_id TEXT,
          branch_id TEXT,
          date TEXT NOT NULL,
          opening_balance REAL NOT NULL DEFAULT 0,
          closing_balance REAL,
          total_in REAL NOT NULL DEFAULT 0,
          total_out REAL NOT NULL DEFAULT 0,
          sales_total REAL NOT NULL DEFAULT 0,
          expenses_total REAL NOT NULL DEFAULT 0,
          adjustments REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          opened_by TEXT DEFAULT '',
          closed_by TEXT DEFAULT '',
          opened_at TEXT,
          closed_at TEXT,
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_caixa_sessions_branch ON caixa_sessions(branch_id, date);
        CREATE INDEX IF NOT EXISTS idx_caixas_branch ON caixas(branch_id);
      `);
    } catch (err) {
      console.warn('[SCHEMA] caixa sqlite:', err.message);
    }
  }
}

/** Per-branch default selling price level (1-4) applied automatically at the POS. */
async function ensureBranchPricingColumn(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query('ALTER TABLE branches ADD COLUMN IF NOT EXISTS price_level INTEGER DEFAULT 1');
    } catch (err) {
      if (err.code !== '42701') console.warn('[SCHEMA] branches.price_level column:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(branches)');
    } catch (_) {
      return;
    }
    if (!cols.length) return;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('price_level')) {
      try {
        db.sqlite.exec('ALTER TABLE branches ADD COLUMN price_level INTEGER DEFAULT 1');
      } catch (_) {}
    }
  }
}

/** Filial can keep a local PVP; HQ cascade skips rows with price_override = true. */
async function ensureProductPriceOverrideColumn(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(
        'ALTER TABLE products ADD COLUMN IF NOT EXISTS price_override BOOLEAN NOT NULL DEFAULT FALSE',
      );
    } catch (err) {
      if (err.code !== '42701') console.warn('[SCHEMA] products.price_override:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(products)');
    } catch (_) {
      return;
    }
    if (!cols.length) return;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('price_override')) {
      try {
        db.sqlite.exec('ALTER TABLE products ADD COLUMN price_override INTEGER NOT NULL DEFAULT 0');
      } catch (_) {}
    }
  }
}

/** Filial can keep a local IVA; HQ tax cascade skips rows with vat_override = true. */
async function ensureProductVatOverrideColumn(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(
        'ALTER TABLE products ADD COLUMN IF NOT EXISTS vat_override BOOLEAN NOT NULL DEFAULT FALSE',
      );
    } catch (err) {
      if (err.code !== '42701') console.warn('[SCHEMA] products.vat_override:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(products)');
    } catch (_) {
      return;
    }
    if (!cols.length) return;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('vat_override')) {
      try {
        db.sqlite.exec('ALTER TABLE products ADD COLUMN vat_override INTEGER NOT NULL DEFAULT 0');
      } catch (_) {}
    }
  }
}

/** Per-user permission overrides (grant/revoke deltas on top of the role), stored as JSON text. */
async function ensureUserPermissionsColumn(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT');
    } catch (err) {
      if (err.code !== '42701') console.warn('[SCHEMA] users.permissions column:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(users)');
    } catch (_) {
      return;
    }
    if (!cols.length) return;
    if (!cols.some((c) => c.name === 'permissions')) {
      try {
        db.sqlite.exec('ALTER TABLE users ADD COLUMN permissions TEXT');
      } catch (_) {}
    }
  }
}

/** Flag seeded/default accounts to change password after first login. */
async function ensureMustChangePasswordColumn(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(
        'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false',
      );
    } catch (err) {
      if (err.code !== '42701') console.warn('[SCHEMA] users.must_change_password:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(users)');
    } catch (_) {
      return;
    }
    if (!cols.length) return;
    if (!cols.some((c) => c.name === 'must_change_password')) {
      try {
        db.sqlite.exec(
          'ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0',
        );
      } catch (_) {}
    }
  }
}

/** MFA columns + sales orders / warehouses / webhooks / job queue (migration 063). */
async function ensureMfaSalesOrdersWarehousesWebhooks(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false');
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT');
      await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT');
    } catch (err) {
      console.warn('[SCHEMA] users MFA columns:', err.message);
    }
    return;
  }

  if (!db.sqlite) return;
  try {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(users)');
    } catch (_) {
      cols = [];
    }
    if (cols.length) {
      if (!cols.some((c) => c.name === 'mfa_enabled')) {
        db.sqlite.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0');
      }
      if (!cols.some((c) => c.name === 'mfa_secret')) {
        db.sqlite.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
      }
      if (!cols.some((c) => c.name === 'mfa_backup_codes')) {
        db.sqlite.exec('ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT');
      }
    }
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sales_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT NOT NULL,
        client_id TEXT DEFAULT '',
        client_name TEXT NOT NULL DEFAULT '',
        client_nif TEXT DEFAULT '',
        customer_email TEXT DEFAULT '',
        customer_phone TEXT DEFAULT '',
        customer_address TEXT DEFAULT '',
        branch_id TEXT DEFAULT '',
        branch_name TEXT DEFAULT '',
        warehouse_id TEXT DEFAULT '',
        subtotal REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        currency TEXT DEFAULT 'AOA',
        status TEXT NOT NULL DEFAULT 'draft',
        reserved_at TEXT,
        confirmed_at TEXT,
        notes TEXT DEFAULT '',
        converted_to_invoice_id TEXT DEFAULT '',
        converted_to_invoice_number TEXT DEFAULT '',
        converted_at TEXT,
        created_by TEXT DEFAULT '',
        created_by_name TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sales_order_items (
        id TEXT PRIMARY KEY,
        sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        product_id TEXT DEFAULT '',
        product_name TEXT NOT NULL DEFAULT '',
        sku TEXT DEFAULT '',
        description TEXT DEFAULT '',
        quantity REAL NOT NULL DEFAULT 1,
        reserved_qty REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        tax_rate REAL NOT NULL DEFAULT 14,
        tax_amount REAL NOT NULL DEFAULT 0,
        subtotal REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        branch_id TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sales_orders_branch ON sales_orders(branch_id);
      CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);
      CREATE INDEX IF NOT EXISTS idx_sales_order_items_order ON sales_order_items(sales_order_id);
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        branch_id TEXT,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (branch_id, code)
      );
      CREATE INDEX IF NOT EXISTS idx_warehouses_branch ON warehouses(branch_id);
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT NOT NULL DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT REFERENCES webhooks(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
        ON webhook_deliveries (status, created_at);
      CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        run_after TEXT NOT NULL DEFAULT (datetime('now')),
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_job_queue_pending
        ON job_queue (status, run_after);
      CREATE TABLE IF NOT EXISTS bank_match_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pattern TEXT NOT NULL,
        match_field TEXT NOT NULL DEFAULT 'description',
        entity_type TEXT,
        entity_hint TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } catch (err) {
    console.warn('[SCHEMA] MFA/sales_orders/warehouses/webhooks (sqlite):', err.message);
  }
}

/** Optional warehouse metadata on stock_transfers (migration 064). */
async function ensureStockTransferWarehouseColumns(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS from_warehouse_id VARCHAR(64) DEFAULT ''`);
      await db.query(`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS to_warehouse_id VARCHAR(64) DEFAULT ''`);
      await db.query(`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS from_warehouse_name VARCHAR(255) DEFAULT ''`);
      await db.query(`ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS to_warehouse_name VARCHAR(255) DEFAULT ''`);
    } catch (err) {
      console.warn('[SCHEMA] stock_transfers warehouse cols:', err.message);
    }
    return;
  }
  if (!db.sqlite) return;
  try {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(stock_transfers)');
    } catch (_) {
      return;
    }
    const names = new Set(cols.map((c) => c.name));
    for (const col of ['from_warehouse_id', 'to_warehouse_id', 'from_warehouse_name', 'to_warehouse_name']) {
      if (!names.has(col)) {
        db.sqlite.exec(`ALTER TABLE stock_transfers ADD COLUMN ${col} TEXT DEFAULT ''`);
      }
    }
  } catch (err) {
    console.warn('[SCHEMA] stock_transfers warehouse cols (sqlite):', err.message);
  }
}

/** Bank statement reconciliation sessions (migration 065). */
async function ensureBankReconciliationsTable(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS bank_reconciliations (
          id VARCHAR(64) PRIMARY KEY,
          bank_account_id VARCHAR(64) NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
          branch_id VARCHAR(64) NOT NULL DEFAULT '',
          statement_rows TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'in_progress',
          updated_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (bank_account_id)
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_account
          ON bank_reconciliations (bank_account_id)
      `);
    } catch (err) {
      console.warn('[SCHEMA] bank_reconciliations:', err.message);
    }
    return;
  }
  if (!db.sqlite) return;
  try {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS bank_reconciliations (
        id TEXT PRIMARY KEY,
        bank_account_id TEXT NOT NULL UNIQUE,
        branch_id TEXT NOT NULL DEFAULT '',
        statement_rows TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'in_progress',
        updated_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (err) {
    console.warn('[SCHEMA] bank_reconciliations (sqlite):', err.message);
  }
}

/** Sales order ship qty + optional stock location stamp (migration 067). */
async function ensureSoShipAndLocationColumns(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(`ALTER TABLE sales_order_items ADD COLUMN IF NOT EXISTS shipped_qty NUMERIC(18, 4) NOT NULL DEFAULT 0`);
      await db.query(`ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS location_id VARCHAR(64) DEFAULT NULL`);
    } catch (err) {
      console.warn('[SCHEMA] so ship/location cols:', err.message);
    }
    return;
  }
  if (!db.sqlite) return;
  try {
    let itemCols = [];
    try {
      itemCols = db.sqlite.pragma('table_info(sales_order_items)');
    } catch (_) {
      return;
    }
    if (!itemCols.some((c) => c.name === 'shipped_qty')) {
      db.sqlite.exec(`ALTER TABLE sales_order_items ADD COLUMN shipped_qty REAL NOT NULL DEFAULT 0`);
    }
    let movCols = [];
    try {
      movCols = db.sqlite.pragma('table_info(stock_movements)');
    } catch (_) {
      return;
    }
    if (!movCols.some((c) => c.name === 'location_id')) {
      db.sqlite.exec(`ALTER TABLE stock_movements ADD COLUMN location_id TEXT`);
    }
  } catch (err) {
    console.warn('[SCHEMA] so ship/location cols (sqlite):', err.message);
  }
}

/** Bank ledger transactions (migration 066). */
async function ensureBankTransactionsTable(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS bank_transactions (
          id VARCHAR(64) PRIMARY KEY,
          bank_account_id VARCHAR(64) NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
          branch_id VARCHAR(64) NOT NULL DEFAULT '',
          type VARCHAR(32) NOT NULL DEFAULT 'manual',
          direction VARCHAR(8) NOT NULL DEFAULT 'in',
          amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
          balance_after NUMERIC(18, 2) NOT NULL DEFAULT 0,
          reference_type VARCHAR(32),
          reference_id VARCHAR(64),
          reference_number VARCHAR(64),
          transaction_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          value_date DATE,
          bank_reference VARCHAR(128),
          description TEXT NOT NULL DEFAULT '',
          category VARCHAR(64),
          payee VARCHAR(255),
          created_by VARCHAR(64),
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_bank_transactions_account
          ON bank_transactions (bank_account_id, transaction_date DESC)
      `);
      try {
        await db.query(`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS is_reconciled BOOLEAN NOT NULL DEFAULT false`);
        await db.query(`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ`);
        await db.query(`ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS reconciliation_id VARCHAR(64)`);
      } catch (colErr) {
        console.warn('[SCHEMA] bank_transactions recon cols:', colErr.message);
      }
    } catch (err) {
      console.warn('[SCHEMA] bank_transactions:', err.message);
    }
    return;
  }
  if (!db.sqlite) return;
  try {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS bank_transactions (
        id TEXT PRIMARY KEY,
        bank_account_id TEXT NOT NULL,
        branch_id TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'manual',
        direction TEXT NOT NULL DEFAULT 'in',
        amount REAL NOT NULL DEFAULT 0,
        balance_after REAL NOT NULL DEFAULT 0,
        reference_type TEXT,
        reference_id TEXT,
        reference_number TEXT,
        transaction_date TEXT,
        value_date TEXT,
        bank_reference TEXT,
        description TEXT NOT NULL DEFAULT '',
        category TEXT,
        payee TEXT,
        created_by TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch (err) {
    console.warn('[SCHEMA] bank_transactions (sqlite):', err.message);
  }
}

/** Document attachments + server notifications inbox (migration 062). */
async function ensureAttachmentsNotificationsTables(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS document_attachments (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
          byte_size INTEGER NOT NULL DEFAULT 0,
          storage_path TEXT NOT NULL,
          uploaded_by TEXT,
          uploaded_by_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_document_attachments_entity
          ON document_attachments (entity_type, entity_id)
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT,
          branch_id TEXT,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          link TEXT,
          is_read BOOLEAN NOT NULL DEFAULT false,
          dedupe_key TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
          ON notifications (dedupe_key)
          WHERE dedupe_key IS NOT NULL
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_created
          ON notifications (created_at DESC)
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_notifications_unread
          ON notifications (is_read, created_at DESC)
      `);
    } catch (err) {
      console.warn('[SCHEMA] attachments/notifications:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    try {
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS document_attachments (
          id TEXT PRIMARY KEY,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          file_name TEXT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
          byte_size INTEGER NOT NULL DEFAULT 0,
          storage_path TEXT NOT NULL,
          uploaded_by TEXT,
          uploaded_by_name TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_document_attachments_entity
          ON document_attachments (entity_type, entity_id);
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          branch_id TEXT,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          link TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          dedupe_key TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
          ON notifications (dedupe_key)
          WHERE dedupe_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_notifications_created
          ON notifications (created_at DESC);
      `);
    } catch (err) {
      console.warn('[SCHEMA] attachments/notifications (sqlite):', err.message);
    }
  }
}

/** Persist login lockouts across restarts (migration 061). */
async function ensureLoginAttemptsTable(db) {
  if (db.engine === 'postgres') {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          identifier TEXT PRIMARY KEY,
          fail_count INTEGER NOT NULL DEFAULT 0,
          first_failed_at TIMESTAMPTZ,
          locked_until TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(
        'CREATE INDEX IF NOT EXISTS idx_login_attempts_locked_until ON login_attempts (locked_until)',
      );
    } catch (err) {
      console.warn('[SCHEMA] login_attempts:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    try {
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          identifier TEXT PRIMARY KEY,
          fail_count INTEGER NOT NULL DEFAULT 0,
          first_failed_at TEXT,
          locked_until TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    } catch (_) {}
  }
}

async function ensureCreditNoteRestoreStockColumn(db) {
  if (db.engine === 'postgres') {
    const check = await db.query(
      `SELECT 1 AS ok FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'credit_notes' AND column_name = 'restore_stock'
       LIMIT 1`,
    );
    if (check.rows.length) return;
    try {
      await db.query(
        'ALTER TABLE credit_notes ADD COLUMN restore_stock BOOLEAN NOT NULL DEFAULT true',
      );
      console.log('[SCHEMA] Added credit_notes.restore_stock (PostgreSQL)');
    } catch (err) {
      if (err.code !== '42701') throw err;
    }
    return;
  }

  if (db.sqlite) {
    let cols = [];
    try {
      cols = db.sqlite.pragma('table_info(credit_notes)');
    } catch (_) {
      return;
    }
    if (!cols.length || cols.some((c) => c.name === 'restore_stock')) return;
    db.sqlite.exec('ALTER TABLE credit_notes ADD COLUMN restore_stock INTEGER NOT NULL DEFAULT 1');
    console.log('[SCHEMA] Added credit_notes.restore_stock (SQLite)');
  }
}

const SQLITE_CRITICAL_ALTERS = [
  "ALTER TABLE sales ADD COLUMN fiscal_status TEXT DEFAULT 'issued'",
  "ALTER TABLE sales ADD COLUMN invoice_type TEXT NOT NULL DEFAULT 'FT'",
  'ALTER TABLE credit_notes ADD COLUMN restore_stock INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE audit_log ADD COLUMN metadata TEXT',
  'ALTER TABLE audit_log ADD COLUMN workstation_id TEXT',
  'ALTER TABLE audit_log ADD COLUMN ip_address TEXT',
];

function ensureUserSessionsSqlite(db) {
  if (!db.sqlite) return;
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL,
      token_jti TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      workstation_id TEXT,
      user_agent TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      end_reason TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(ended_at);
  `);
}

function ensureFiscalInvoiceSequencesSqlite(db) {
  if (!db.sqlite || !db.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='document_sequences' LIMIT 1").get()) {
    return;
  }
  const yr = new Date().getFullYear();
  const ins = db.sqlite.prepare(`
    INSERT INTO document_sequences (id, document_type, prefix, fiscal_year, branch_id, current_number)
    VALUES (?, ?, ?, ?, ?, 0)
    ON CONFLICT(document_type, fiscal_year, branch_id) DO NOTHING
  `);
  const fiscalTypes = [
    ['simplified_invoice', 'FS'],
    ['invoice_receipt', 'FR'],
    ['sales_invoice', 'FT'],
  ];
  try {
    const branches = db.sqlite.prepare('SELECT id FROM branches WHERE is_active = 1 OR is_active IS NULL').all();
    for (const branch of branches) {
      for (const [docType, prefix] of fiscalTypes) {
        ins.run(crypto.randomUUID(), docType, prefix, yr, branch.id);
      }
    }
    for (const [docType, prefix] of fiscalTypes) {
      ins.run(crypto.randomUUID(), docType, prefix, yr, '');
    }
  } catch (err) {
    console.warn('[SCHEMA] fiscal invoice sequences:', err.message);
  }
}

/**
 * Apply the Angola PGC (novo com IVA) chart of accounts ONCE per database.
 * Fresh installs already get it from the seed; this brings EXISTING databases
 * up to the new chart automatically at startup, just like a normal migration.
 * Guarded by an app_meta flag so the destructive replace never re-runs and
 * wipes dynamically-created sub-accounts (suppliers/clients/branch caixas).
 */
async function ensurePgcChartOfAccounts(db) {
  const FLAG = 'pgc_novo_com_iva_applied';

  // Ensure the app_meta key/value store exists (engine-aware DDL).
  try {
    if (db.engine === 'postgres') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key VARCHAR(64) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else if (db.sqlite) {
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
    }
  } catch (err) {
    console.warn('[SCHEMA] app_meta ensure (pgc):', err.message);
  }

  // One-time guard.
  try {
    const existing = await db.query('SELECT value FROM app_meta WHERE key = $1', [FLAG]);
    if (existing.rows && existing.rows.length) return;
  } catch (_) {
    /* table unreadable — fall through and attempt to apply */
  }

  if (typeof db.resetChartOfAccountsToPgc !== 'function') return;

  try {
    const result = await db.resetChartOfAccountsToPgc();
    console.log(`[SCHEMA] Angola PGC (novo com IVA) applied — ${result.active} active accounts`);
  } catch (err) {
    // Leave the flag unset so it retries on the next boot.
    console.warn('[SCHEMA] PGC chart apply failed (will retry next boot):', err.message);
    return;
  }

  try {
    if (db.engine === 'postgres') {
      await db.query(
        `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [FLAG, '1'],
      );
    } else if (db.sqlite) {
      db.sqlite
        .prepare(
          `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        )
        .run(FLAG, '1');
    }
  } catch (err) {
    console.warn('[SCHEMA] PGC flag write failed:', err.message);
  }
}

async function ensureBankAccountsTable(db) {
  if (db.engine !== 'postgres') return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id VARCHAR(64) PRIMARY KEY,
        branch_id VARCHAR(64) NOT NULL DEFAULT '',
        branch_name VARCHAR(255) NOT NULL DEFAULT '',
        bank_name VARCHAR(255) NOT NULL DEFAULT '',
        name VARCHAR(255) NOT NULL DEFAULT '',
        account_number VARCHAR(100) NOT NULL DEFAULT '',
        iban VARCHAR(64) DEFAULT '',
        swift VARCHAR(32) DEFAULT '',
        currency VARCHAR(8) NOT NULL DEFAULT 'AOA',
        balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_bank_accounts_branch ON bank_accounts (branch_id)');
  } catch (err) {
    console.warn('[SCHEMA] bank_accounts table:', err.message);
  }
}

async function ensureSalesClientIdColumn(db) {
  if (db.engine !== 'postgres') return;
  try {
    await db.query(
      'ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id)',
    );
    await db.query(
      'CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales (client_id) WHERE client_id IS NOT NULL',
    );
  } catch (err) {
    console.warn('[SCHEMA] sales.client_id:', err.message);
  }
}

async function ensureJournalReferenceIdText(db) {
  if (db.engine !== 'postgres') return;
  try {
    const col = await db.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'journal_entries' AND column_name = 'reference_id'
       LIMIT 1`,
    );
    if (col.rows[0]?.data_type === 'uuid') {
      await db.query(
        'ALTER TABLE journal_entries ALTER COLUMN reference_id TYPE TEXT USING reference_id::text',
      );
      console.log('[SCHEMA] journal_entries.reference_id widened to TEXT');
    }
  } catch (err) {
    console.warn('[SCHEMA] journal_entries.reference_id:', err.message);
  }
}

/** Soft-deactivate duplicate active NIFs (keep oldest) and add unique index. */
async function ensureClientsUniqueNif(db) {
  if (db.engine === 'postgres') {
    try {
      const deactivated = await db.query(`
        WITH ranked AS (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY REPLACE(COALESCE(nif, ''), ' ', '')
              ORDER BY created_at ASC NULLS LAST, id ASC
            ) AS rn
          FROM clients
          WHERE COALESCE(is_active, true) = true
            AND TRIM(COALESCE(nif, '')) <> ''
        )
        UPDATE clients c
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP,
            name = CASE
              WHEN c.name ILIKE '%(duplicado)%' THEN c.name
              ELSE trim(c.name) || ' (duplicado)'
            END
        FROM ranked r
        WHERE c.id = r.id AND r.rn > 1
        RETURNING c.id
      `);
      const n = deactivated.rows?.length || 0;
      if (n > 0) {
        console.log(`[SCHEMA] Soft-deactivated ${n} duplicate client NIF row(s)`);
      }
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_nif_active_unique
        ON clients (nif)
        WHERE COALESCE(is_active, true) = true AND TRIM(COALESCE(nif, '')) <> ''
      `);
    } catch (err) {
      console.warn('[SCHEMA] clients unique NIF:', err.message);
    }
    return;
  }

  if (db.sqlite) {
    try {
      const dups = db.sqlite.prepare(`
        SELECT REPLACE(COALESCE(nif, ''), ' ', '') AS nif_key
        FROM clients
        WHERE COALESCE(is_active, 1) = 1 AND TRIM(COALESCE(nif, '')) <> ''
        GROUP BY nif_key
        HAVING COUNT(*) > 1
      `).all();
      const listByNif = db.sqlite.prepare(`
        SELECT id, name FROM clients
        WHERE REPLACE(COALESCE(nif, ''), ' ', '') = ?
          AND COALESCE(is_active, 1) = 1
        ORDER BY created_at ASC, id ASC
      `);
      const deactivate = db.sqlite.prepare(`
        UPDATE clients
        SET is_active = 0,
            name = CASE
              WHEN lower(name) LIKE '%(duplicado)%' THEN name
              ELSE trim(name) || ' (duplicado)'
            END
        WHERE id = ?
      `);
      let n = 0;
      for (const d of dups) {
        const rows = listByNif.all(d.nif_key);
        for (let i = 1; i < rows.length; i += 1) {
          deactivate.run(rows[i].id);
          n += 1;
        }
      }
      if (n > 0) console.log(`[SCHEMA] Soft-deactivated ${n} duplicate client NIF row(s)`);
      db.sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_nif_active_unique
        ON clients (nif)
        WHERE COALESCE(is_active, 1) = 1 AND TRIM(COALESCE(nif, '')) <> ''
      `);
    } catch (err) {
      console.warn('[SCHEMA] clients unique NIF (sqlite):', err.message);
    }
  }
}

async function ensurePhaseSchema(db) {
  if (db.engine === 'postgres') {
    await ensureDocumentSequencesBranchScope(db);
    const migrationResult = await applyPostgresMigrations(db, { logPrefix: '[SCHEMA]' });
    if (migrationResult.applied.length > 0) {
      console.log(`[SCHEMA] PostgreSQL migrations checked (${migrationResult.applied.length} files)`);
    }
    if (migrationResult.errors.length > 0) {
      console.warn('[SCHEMA] Migration warnings:', migrationResult.errors.length);
    }
    try {
      await db.query(
        `UPDATE sales SET fiscal_status = 'issued'
         WHERE fiscal_status IS NULL AND status IN ('completed', 'confirmed')`,
      );
    } catch (_) {}
    await ensureCreditNoteRestoreStockColumn(db);
    await ensureClientPricingColumns(db);
    await ensureClientsUniqueNif(db);
    await ensureBranchPricingColumn(db);
    await ensureProductPriceOverrideColumn(db);
    await ensureProductVatOverrideColumn(db);
    await ensureSalesCreditPaymentMethod(db);
    await ensureSalesClientIdColumn(db);
    await ensureCaixaTables(db);
    await ensureBankAccountsTable(db);
    try {
      const { ensureBankGlColumn, ensureBankAccountsFromCoa } = require('./bankGlAccounts');
      await ensureBankGlColumn(db);
      const bankSync = await ensureBankAccountsFromCoa(db);
      if (bankSync.upserted > 0) {
        console.log(`[SCHEMA] Synced ${bankSync.upserted} bank account(s) from COA 43x`);
      }
    } catch (e) {
      console.warn('[SCHEMA] bank_accounts COA sync:', e.message);
    }
    await ensureJournalReferenceIdText(db);
    await ensureUserPermissionsColumn(db);
    await ensureMustChangePasswordColumn(db);
    await ensureLoginAttemptsTable(db);
    await ensureAttachmentsNotificationsTables(db);
    await ensureMfaSalesOrdersWarehousesWebhooks(db);
    await ensureStockTransferWarehouseColumns(db);
    await ensureBankReconciliationsTable(db);
    await ensureBankTransactionsTable(db);
    await ensureSoShipAndLocationColumns(db);
    await ensureAuditLogActions(db);
    await ensurePgcChartOfAccounts(db);
    const linkResult = await linkOrphanBranchCaixaAccounts(db);
    if (linkResult.linked > 0) {
      console.log(`[SCHEMA] Linked ${linkResult.linked} orphan branch caixa account(s)`);
    }
    const caixaEnsure = await ensureAllBranchCaixaAccounts(db);
    if (caixaEnsure.created > 0) {
      console.log(`[SCHEMA] Created ${caixaEnsure.created} branch caixa account(s)`);
    }
    try {
      const caixaMod = require('../routes/caixa');
      if (typeof caixaMod.ensureTreasuryRegistersFromCoa === 'function') {
        await caixaMod.ensureTreasuryRegistersFromCoa();
      }
    } catch (e) {
      console.warn('[SCHEMA] caixa COA sync:', e.message);
    }
    await repairCreditNoteCaixaGlAccounts(db);
    console.log('[SCHEMA] PostgreSQL phase migrations applied');
    return;
  }

  if (db.sqlite) {
    for (const sql of SQLITE_CRITICAL_ALTERS) {
      try {
        db.sqlite.exec(sql);
      } catch (_) {}
    }
    ensureUserSessionsSqlite(db);
    ensureFiscalInvoiceSequencesSqlite(db);
    try {
      db.sqlite.exec(
        `UPDATE sales SET fiscal_status = 'issued'
         WHERE (fiscal_status IS NULL OR fiscal_status = '')
           AND status IN ('completed', 'confirmed')`,
      );
    } catch (_) {}
    await ensureCreditNoteRestoreStockColumn(db);
    await ensureClientPricingColumns(db);
    await ensureClientsUniqueNif(db);
    await ensureBranchPricingColumn(db);
    await ensureProductPriceOverrideColumn(db);
    await ensureProductVatOverrideColumn(db);
    await ensureSalesCreditPaymentMethod(db);
    await ensureCaixaTables(db);
    await ensureUserPermissionsColumn(db);
    await ensureMustChangePasswordColumn(db);
    await ensureLoginAttemptsTable(db);
    await ensureAttachmentsNotificationsTables(db);
    await ensureMfaSalesOrdersWarehousesWebhooks(db);
    await ensureStockTransferWarehouseColumns(db);
    await ensureBankReconciliationsTable(db);
    await ensureBankTransactionsTable(db);
    await ensureSoShipAndLocationColumns(db);
    await ensurePgcChartOfAccounts(db);
    const linkResult = await linkOrphanBranchCaixaAccounts(db);
    if (linkResult.linked > 0) {
      console.log(`[SCHEMA] Linked ${linkResult.linked} orphan branch caixa account(s)`);
    }
    const caixaEnsure = await ensureAllBranchCaixaAccounts(db);
    if (caixaEnsure.created > 0) {
      console.log(`[SCHEMA] Created ${caixaEnsure.created} branch caixa account(s)`);
    }
    await repairCreditNoteCaixaGlAccounts(db);
    console.log('[SCHEMA] SQLite phase column patches applied');
  }
}

module.exports = {
  ensureBankAccountsTable,
  ensureJournalReferenceIdText,
  ensurePhaseSchema,
  ensurePgcChartOfAccounts,
  ensureDocumentSequencesBranchScope,
  ensureCreditNoteRestoreStockColumn,
  ensureClientPricingColumns,
  ensureClientsUniqueNif,
  ensureBranchPricingColumn,
  ensureProductPriceOverrideColumn,
  ensureProductVatOverrideColumn,
  ensureSalesCreditPaymentMethod,
  ensureSalesClientIdColumn,
  ensureCaixaTables,
  ensureUserPermissionsColumn,
  ensureMustChangePasswordColumn,
  ensureLoginAttemptsTable,
  ensureAttachmentsNotificationsTables,
  ensureMfaSalesOrdersWarehousesWebhooks,
  ensureStockTransferWarehouseColumns,
  ensureAuditLogActions,
};
