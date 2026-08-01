/**
 * Apply ordered SQL migration files to PostgreSQL.
 * Called on `npm run migrate` and automatically on server startup.
 *
 * IMPORTANT: Each file runs at most once (tracked in schema_migrations).
 * The old "re-run every file every startup" behavior re-executed
 * 020_inventory_vat_5_percent.sql and force-set ALL products to 5% IVA
 * after every docker recreate — including Soyo Sede.
 */
const fs = require('fs');
const path = require('path');
const { MIGRATION_FILES, IGNORABLE_PG_CODES } = require('./manifest');

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

function isIgnorableMigrationError(err) {
  const code = err?.code || '';
  return IGNORABLE_PG_CODES.has(code);
}

/** Block the historical mass IVA wipe even if an old 020 file is restored. */
function isForbiddenMassVatWipe(stmt) {
  const compact = String(stmt || '').replace(/\s+/g, ' ');
  if (!/UPDATE\s+products/i.test(compact)) return false;
  if (!/tax_rate\s*=\s*5(\.0+)?\b/i.test(compact)) return false;
  // Single-row updates by id are fine.
  if (/\bWHERE\b[\s\S]*\bid\s*=/i.test(compact)) return false;
  return true;
}

async function ensureMigrationLedger(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function loadAppliedSet(db) {
  const result = await db.query('SELECT id FROM schema_migrations');
  return new Set((result.rows || []).map((r) => String(r.id)));
}

async function markApplied(db, file) {
  await db.query(
    'INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
    [file],
  );
}

/**
 * Existing city DBs already have schema from years of re-running SQL.
 * First time we introduce the ledger: mark every known file as applied
 * WITHOUT executing them again (avoids one more 020 wipe / CoA churn).
 */
async function bootstrapLedgerIfNeeded(db, logPrefix) {
  const countRes = await db.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
  const n = Number(countRes.rows?.[0]?.n || 0);
  if (n > 0) return false;

  let hasData = false;
  try {
    const probe = await db.query('SELECT 1 AS ok FROM products LIMIT 1');
    hasData = (probe.rows || []).length > 0;
  } catch (_) {
    try {
      const probe2 = await db.query('SELECT 1 AS ok FROM chart_of_accounts LIMIT 1');
      hasData = (probe2.rows || []).length > 0;
    } catch (_) { /* fresh DB */ }
  }

  if (!hasData) return false;

  for (const file of MIGRATION_FILES) {
    await markApplied(db, file);
  }
  console.log(
    `${logPrefix} Bootstrapped schema_migrations (${MIGRATION_FILES.length} files marked applied — not re-executed)`,
  );
  return true;
}

/**
 * @param {typeof import('../db')} db
 * @param {{ logPrefix?: string, strict?: boolean }} [options]
 * @returns {Promise<{ applied: string[], skipped: string[], errors: Array<{ file: string, message: string }> }>}
 */
async function applyPostgresMigrations(db, options = {}) {
  const logPrefix = options.logPrefix || '[MIGRATE]';
  const strict = options.strict === true;
  const migrationsDir = path.join(__dirname);
  const applied = [];
  const skipped = [];
  const errors = [];

  if (db.engine !== 'postgres') {
    return { applied, skipped, errors };
  }

  await ensureMigrationLedger(db);
  const bootstrapped = await bootstrapLedgerIfNeeded(db, logPrefix);
  const already = await loadAppliedSet(db);
  if (bootstrapped) {
    return { applied, skipped: [...MIGRATION_FILES], errors };
  }

  for (const file of MIGRATION_FILES) {
    if (already.has(file)) {
      skipped.push(file);
      continue;
    }

    const sqlFile = path.join(migrationsDir, file);
    if (!fs.existsSync(sqlFile)) {
      skipped.push(file);
      if (!strict) console.warn(`${logPrefix} ⚠ Skipping ${file} (not found)`);
      continue;
    }

    const statements = splitSQL(fs.readFileSync(sqlFile, 'utf8'));
    let fileFailed = false;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (isForbiddenMassVatWipe(stmt)) {
        const message = 'Blocked forbidden mass UPDATE products SET tax_rate = 5 (IVA wipe)';
        console.error(`${logPrefix} ❌ ${file}: ${message}`);
        errors.push({ file, message: `statement ${i + 1}: ${message}` });
        fileFailed = true;
        if (strict) throw new Error(`${file}: ${message}`);
        break;
      }
      try {
        await db.query(stmt);
      } catch (err) {
        if (isIgnorableMigrationError(err)) continue;
        fileFailed = true;
        const message = err.message || String(err);
        errors.push({ file, message: `statement ${i + 1}: ${message}` });
        if (strict) {
          console.error(`${logPrefix} ❌ Error in ${file} (statement ${i + 1}):`, message);
          throw err;
        }
        console.warn(`${logPrefix} ${file} (statement ${i + 1}):`, message);
        break;
      }
    }

    if (!fileFailed) {
      await markApplied(db, file);
      applied.push(file);
      console.log(`${logPrefix} ✅ ${file} applied (${statements.length} statements)`);
    }
  }

  return { applied, skipped, errors };
}

module.exports = {
  applyPostgresMigrations,
  splitSQL,
  isIgnorableMigrationError,
  isForbiddenMassVatWipe,
};
