/**
 * Phase A — deployment / database trust signals for Settings and health checks.
 */
const fs = require('fs');
const path = require('path');

/** Bump when SQLite tryAlterAdd / migrations change (match highest migration number). */
const EXPECTED_SCHEMA_VERSION = 25;

function readAppVersion() {
  const candidates = [
    path.resolve(__dirname, '../../../package.json'),
    path.resolve(__dirname, '../../package.json'),
  ];
  for (const pkgPath of candidates) {
    try {
      if (fs.existsSync(pkgPath)) {
        return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || 'unknown';
      }
    } catch (_) {}
  }
  return process.env.NEXOR_APP_VERSION || 'unknown';
}

function statDbFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return {
      path: path.normalize(filePath),
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/** Known locations where legacy installs kept erp.db (Windows-first). */
function listSqliteCandidatePaths(activePath) {
  const active = path.normalize(String(activePath || '').trim());
  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const dataDir = path.join(installDir, 'data');
  const raw = [
    active,
    process.env.SQLITE_PATH,
    path.join(dataDir, 'erp.db'),
    path.join('C:\\nexor', 'erp.db'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'NEXOR ERP', 'erp.db') : null,
    path.join(process.env.LOCALAPPDATA || '', 'NEXOR ERP', 'erp.db'),
  ].filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const p of raw) {
    const key = path.normalize(String(p)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const stat = statDbFile(p);
    if (stat) out.push(stat);
  }

  try {
    if (fs.existsSync(dataDir)) {
      for (const name of fs.readdirSync(dataDir)) {
        if (!/\.db$/i.test(name)) continue;
        const full = path.join(dataDir, name);
        const key = full.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const stat = statDbFile(full);
        if (stat) out.push(stat);
      }
    }
  } catch (_) {}

  return out.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function readIpFileDatabasePath() {
  const ipPath = process.env.NEXOR_IP_FILE || path.join(process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP', 'IP');
  try {
    if (!fs.existsSync(ipPath)) return { ipPath, configuredPath: null };
    const content = fs.readFileSync(ipPath, 'utf8').trim().replace(/^\uFEFF/, '');
    if (/\.db$/i.test(content)) {
      return { ipPath, configuredPath: path.normalize(content) };
    }
    return { ipPath, configuredPath: null };
  } catch {
    return { ipPath, configuredPath: null };
  }
}

function resolveBackupDir() {
  const candidates = [
    process.env.BACKUP_DIR,
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'NEXOR ERP', 'backups')
      : null,
    path.join(process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP', 'backups'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (_) {}
  }
  return null;
}

function getLatestBackup(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) return null;
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => /\.(db|sql)$/i.test(f))
      .map((f) => {
        const full = path.join(backupDir, f);
        const st = fs.statSync(full);
        return { filename: f, sizeBytes: st.size, createdAt: st.mtime.toISOString(), path: full };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return files[0] || null;
  } catch {
    return null;
  }
}

async function readSchemaVersionFromDb(db) {
  if (db.engine !== 'sqlite' || !db.sqlite) {
    return { stored: null, expected: EXPECTED_SCHEMA_VERSION };
  }
  try {
    const row = db.sqlite.prepare('SELECT value FROM app_meta WHERE key = ?').get('schema_version');
    const stored = row?.value != null ? Number(row.value) : null;
    return {
      stored: Number.isFinite(stored) ? stored : null,
      expected: EXPECTED_SCHEMA_VERSION,
    };
  } catch {
    return { stored: null, expected: EXPECTED_SCHEMA_VERSION };
  }
}

/**
 * @param {typeof import('../db')} db
 */
async function buildDeploymentStatus(db) {
  const appVersion = readAppVersion();
  const schema = await readSchemaVersionFromDb(db);
  const schemaUpToDate =
    schema.stored == null ? true : schema.stored >= schema.expected;

  const warnings = [];
  const engine = db.engine || 'sqlite';

  let database = null;
  let duplicateDatabases = [];
  const ipInfo = readIpFileDatabasePath();

  if (engine === 'sqlite') {
    const activeStat = statDbFile(db.dbPath);
    database = activeStat
      ? {
          path: activeStat.path,
          sizeBytes: activeStat.sizeBytes,
          modifiedAt: activeStat.modifiedAt,
        }
      : { path: db.dbPath, sizeBytes: 0, modifiedAt: null };

    if (ipInfo.configuredPath && activeStat) {
      const ipNorm = ipInfo.configuredPath.toLowerCase();
      const activeNorm = activeStat.path.toLowerCase();
      if (ipNorm !== activeNorm) {
        warnings.push({
          code: 'IP_FILE_MISMATCH',
          message: `IP file points to ${ipInfo.configuredPath} but server uses ${activeStat.path}`,
        });
      }
    }

    const candidates = listSqliteCandidatePaths(db.dbPath);
    duplicateDatabases = candidates
      .filter((c) => c.path.toLowerCase() !== (activeStat?.path || db.dbPath).toLowerCase())
      .map((c) => ({
        ...c,
        sizeMb: Math.round((c.sizeBytes / (1024 * 1024)) * 10) / 10,
      }));

    const substantial = duplicateDatabases.filter((d) => d.sizeBytes > 100 * 1024);
    if (substantial.length > 0) {
      warnings.push({
        code: 'DUPLICATE_DATABASE_FILES',
        message: `${substantial.length} other database file(s) found on this PC. Only one should hold live data.`,
        paths: substantial.map((d) => d.path),
      });
    }

    try {
      const counts = {};
      for (const table of ['products', 'sales', 'suppliers', 'clients']) {
        try {
          const r = await db.query(`SELECT COUNT(*) AS n FROM ${table}`);
          counts[table] = Number(r.rows[0]?.n || 0);
        } catch {
          counts[table] = null;
        }
      }
      database.counts = counts;
    } catch (_) {}
  } else {
    database = {
      path: process.env.DATABASE_URL ? '[PostgreSQL]' : null,
      sizeBytes: null,
      modifiedAt: null,
    };
  }

  const backupDir = resolveBackupDir();
  const latestBackup = getLatestBackup(backupDir);
  let backupCount = 0;
  if (backupDir && fs.existsSync(backupDir)) {
    try {
      backupCount = fs.readdirSync(backupDir).filter((f) => /\.(db|sql)$/i.test(f)).length;
    } catch (_) {}
  }

  if (!latestBackup) {
    warnings.push({
      code: 'NO_BACKUP',
      message: 'No database backup found yet. Create one before go-live.',
    });
  } else {
    const ageDays =
      (Date.now() - new Date(latestBackup.createdAt).getTime()) / (86400 * 1000);
    if (ageDays > 7) {
      warnings.push({
        code: 'BACKUP_STALE',
        message: `Latest backup is ${Math.floor(ageDays)} days old.`,
      });
    }
  }

  if (!schemaUpToDate) {
    warnings.push({
      code: 'SCHEMA_OUTDATED',
      message: `Database schema v${schema.stored} — app expects v${schema.expected}. Restart after updating the app.`,
    });
  }

  return {
    ok: warnings.every((w) => w.code !== 'SCHEMA_OUTDATED') && !!database?.path,
    engine,
    appVersion,
    schemaVersion: schema.stored,
    schemaVersionExpected: schema.expected,
    schemaUpToDate,
    database,
    ipFile: ipInfo,
    backups: {
      directory: backupDir,
      count: backupCount,
      latest: latestBackup,
    },
    duplicateDatabases,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

function recordAppMeta(sqlite, appVersion) {
  if (!sqlite) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const upsert = sqlite.prepare(`
    INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  upsert.run('schema_version', String(EXPECTED_SCHEMA_VERSION));
  upsert.run('app_version', String(appVersion));
  upsert.run('last_started_at', new Date().toISOString());
}

module.exports = {
  EXPECTED_SCHEMA_VERSION,
  readAppVersion,
  buildDeploymentStatus,
  recordAppMeta,
  listSqliteCandidatePaths,
};
