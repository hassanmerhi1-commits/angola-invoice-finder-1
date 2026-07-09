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

function readIpFileContent() {
  try {
    const ipPath = path.join(installDir(), 'IP');
    if (!fs.existsSync(ipPath)) return '';
    return fs.readFileSync(ipPath, 'utf8').trim();
  } catch {
    return '';
  }
}

function isSqliteDatabaseIpContent(content) {
  return /^[A-Za-z]:\\.+\.db$/i.test(String(content || '').trim());
}

function defaultSqliteDatabasePath() {
  return path.join(installDir(), 'data', 'erp.db');
}

/**
 * Resolve DB mode for this PC.
 * PostgreSQL in database.env wins on the server — legacy .db in the IP file must not shadow it.
 */
function resolveInstallDatabaseMode() {
  const env = loadDatabaseEnv();
  const ipContent = readIpFileContent();

  if (env.engine === 'postgres' && env.databaseUrl && !env.error) {
    return {
      engine: 'postgres',
      databaseUrl: env.databaseUrl,
      filePath: env.filePath,
      forceSqlite: false,
      sqlitePath: null,
    };
  }

  if (isSqliteDatabaseIpContent(ipContent)) {
    return {
      engine: 'sqlite',
      databaseUrl: '',
      sqlitePath: ipContent.trim(),
      filePath: null,
      forceSqlite: true,
    };
  }

  if (/^postgres$/i.test(ipContent) || /^postgres(ql)?:\/\//i.test(ipContent)) {
    return {
      engine: 'postgres',
      databaseUrl: env.databaseUrl,
      filePath: env.filePath,
      error: env.error,
      forceSqlite: false,
      sqlitePath: null,
    };
  }

  return {
    ...env,
    forceSqlite: false,
    sqlitePath: null,
  };
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

function clearPostgresDatabaseEnv() {
  const filePath = databaseEnvPath();
  if (!fs.existsSync(filePath)) return { removed: false };
  try {
    const backup = `${filePath}.postgres-backup`;
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(filePath, backup);
    }
    fs.unlinkSync(filePath);
    return { removed: true, backup };
  } catch (e) {
    return { removed: false, error: e.message };
  }
}

module.exports = {
  DATABASE_ENV_FILENAME,
  databaseEnvPath,
  loadDatabaseEnv,
  isPostgresMode,
  readIpFileContent,
  isSqliteDatabaseIpContent,
  defaultSqliteDatabasePath,
  resolveInstallDatabaseMode,
  clearPostgresDatabaseEnv,
};
