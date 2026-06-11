/**
 * Apply phase 1–5 schema patches at startup (PostgreSQL + safety net for SQLite).
 */
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
  'ALTER TABLE credit_notes ADD COLUMN restore_stock INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE audit_log ADD COLUMN metadata TEXT',
  'ALTER TABLE audit_log ADD COLUMN workstation_id TEXT',
  'ALTER TABLE audit_log ADD COLUMN ip_address TEXT',
];

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
    await ensureAuditLogActions(db);
    console.log('[SCHEMA] PostgreSQL phase migrations applied');
    return;
  }

  if (db.sqlite) {
    for (const sql of SQLITE_CRITICAL_ALTERS) {
      try {
        db.sqlite.exec(sql);
      } catch (_) {}
    }
    try {
      db.sqlite.exec(
        `UPDATE sales SET fiscal_status = 'issued'
         WHERE (fiscal_status IS NULL OR fiscal_status = '')
           AND status IN ('completed', 'confirmed')`,
      );
    } catch (_) {}
    await ensureCreditNoteRestoreStockColumn(db);
    console.log('[SCHEMA] SQLite phase column patches applied');
  }
}

module.exports = {
  ensurePhaseSchema,
  ensureDocumentSequencesBranchScope,
  ensureCreditNoteRestoreStockColumn,
  ensureAuditLogActions,
};
