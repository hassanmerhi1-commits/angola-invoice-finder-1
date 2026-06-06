/**
 * Server database mode: SQLite file (default) or PostgreSQL via database.env
 */
const fs = require('fs');
const path = require('path');

const DATABASE_ENV_FILENAME = 'database.env';

function installDir() {
  return process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
}

function databaseEnvPath() {
  return path.join(installDir(), DATABASE_ENV_FILENAME);
}

/** Parse KEY=VALUE lines (no quotes required). */
function parseEnvFile(content) {
  const out = {};
  for (const line of String(content || '').split(/\r?\n/)) {
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
    out[key] = val;
  }
  return out;
}

function loadDatabaseEnv() {
  const filePath = databaseEnvPath();
  if (!fs.existsSync(filePath)) {
    return { engine: 'sqlite', databaseUrl: '', filePath: null };
  }
  try {
    const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
    const databaseUrl = String(parsed.DATABASE_URL || '').trim();
    const engine = String(parsed.DB_ENGINE || '').trim().toLowerCase();
    const usePostgres =
      !!databaseUrl
      || engine === 'postgres'
      || engine === 'postgresql';
    if (usePostgres && !databaseUrl) {
      return {
        engine: 'postgres',
        databaseUrl: '',
        filePath,
        error: 'database.env sets DB_ENGINE=postgres but DATABASE_URL is missing',
      };
    }
    return {
      engine: usePostgres ? 'postgres' : 'sqlite',
      databaseUrl: databaseUrl,
      filePath,
    };
  } catch (e) {
    return { engine: 'sqlite', databaseUrl: '', filePath, error: e.message };
  }
}

function isPostgresMode() {
  return loadDatabaseEnv().engine === 'postgres' && !!loadDatabaseEnv().databaseUrl;
}

module.exports = {
  DATABASE_ENV_FILENAME,
  databaseEnvPath,
  loadDatabaseEnv,
  isPostgresMode,
};
