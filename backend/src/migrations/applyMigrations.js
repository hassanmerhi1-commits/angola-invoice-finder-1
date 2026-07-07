/**
 * Apply ordered SQL migration files to PostgreSQL (idempotent).
 * Called on `npm run migrate` and automatically on server startup.
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

  for (const file of MIGRATION_FILES) {
    const sqlFile = path.join(migrationsDir, file);
    if (!fs.existsSync(sqlFile)) {
      skipped.push(file);
      if (!strict) console.warn(`${logPrefix} ⚠ Skipping ${file} (not found)`);
      continue;
    }

    const statements = splitSQL(fs.readFileSync(sqlFile, 'utf8'));
    let fileFailed = false;

    for (let i = 0; i < statements.length; i++) {
      try {
        await db.query(statements[i]);
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
      applied.push(file);
      if (strict) {
        console.log(`${logPrefix} ✅ ${file} applied (${statements.length} statements)`);
      }
    }
  }

  return { applied, skipped, errors };
}

module.exports = {
  applyPostgresMigrations,
  splitSQL,
  isIgnorableMigrationError,
};
