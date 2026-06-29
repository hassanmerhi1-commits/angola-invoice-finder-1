/**
 * Apply phase 1–5 schema patches at startup (PostgreSQL + safety net for SQLite).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATION_FILES = [
  '032_fiscal_documents_phase1.sql',
  '033_credit_note_restore_stock.sql',
  '034_fiscal_signing_phase2.sql',
  '035_agt_api_phase3.sql',
  '036_company_settings_phase4.sql',
  '037_fiscal_audit_phase5.sql',
  '038_audit_log_actions_phase5.sql',
  '039_app_meta_schema_version.sql',
  '040_users_username.sql',
  '041_user_sessions_security.sql',
  '042_simplified_invoice_fs.sql',
];

function isCommentOnlySQL(stmt) {
  const lines = stmt.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => line.startsWith('--'));
}

function splitSQL(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!inDollarQuote && (trimmed.startsWith('--') || trimmed === '')) {
      current += `${line}\n`;
      continue;
    }
    current += `${line}\n`;
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) inDollarQuote = !inDollarQuote;
    }
    if (!inDollarQuote && trimmed.endsWith(';')) {
      const stmt = current.trim();
      if (stmt && !isCommentOnlySQL(stmt)) statements.push(stmt);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail && !isCommentOnlySQL(tail)) statements.push(tail);
  return statements;
}

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

async function ensurePhaseSchema(db) {
  const migrationsDir = path.join(__dirname, '../migrations');

  if (db.engine === 'postgres') {
    await ensureDocumentSequencesBranchScope(db);
    for (const file of MIGRATION_FILES) {
      const sqlFile = path.join(migrationsDir, file);
      if (!fs.existsSync(sqlFile)) continue;
      const statements = splitSQL(fs.readFileSync(sqlFile, 'utf8'));
      for (const stmt of statements) {
        try {
          await db.query(stmt);
        } catch (err) {
          const code = err.code || '';
          if (code === '42P07' || code === '42710' || code === '23505' || code === '42701') continue;
          console.warn(`[SCHEMA] ${file}:`, err.message);
        }
      }
    }
    try {
      await db.query(
        `UPDATE sales SET fiscal_status = 'issued'
         WHERE fiscal_status IS NULL AND status IN ('completed', 'confirmed')`,
      );
    } catch (_) {}
    await ensureCreditNoteRestoreStockColumn(db);
    await ensureClientPricingColumns(db);
    await ensureBranchPricingColumn(db);
    await ensureUserPermissionsColumn(db);
    await ensureAuditLogActions(db);
    await ensurePgcChartOfAccounts(db);
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
    await ensureBranchPricingColumn(db);
    await ensureUserPermissionsColumn(db);
    await ensurePgcChartOfAccounts(db);
    console.log('[SCHEMA] SQLite phase column patches applied');
  }
}

module.exports = {
  ensurePhaseSchema,
  ensurePgcChartOfAccounts,
  ensureDocumentSequencesBranchScope,
  ensureCreditNoteRestoreStockColumn,
  ensureClientPricingColumns,
  ensureBranchPricingColumn,
  ensureUserPermissionsColumn,
  ensureAuditLogActions,
};
