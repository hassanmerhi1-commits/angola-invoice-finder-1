/**
 * Shared database backup creation (SQLite file copy / PostgreSQL pg_dump).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db');
const { createPostgresBackup } = require('./pgBackupCli');

function resolveBackupDir() {
  const candidates = [
    process.env.BACKUP_DIR,
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir(), 'NEXOR ERP', 'backups')
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'nexor-erp', 'backups'),
    path.join(os.homedir(), 'NEXOR ERP', 'backups'),
    path.resolve(process.cwd(), 'backups'),
    path.resolve(__dirname, '../../backups'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch (error) {
      console.warn(`[BACKUP] Cannot use backup directory ${candidate}: ${error.message}`);
    }
  }

  throw new Error('No writable backup directory available');
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function backupExtension() {
  return db.engine === 'postgres' ? '.sql' : '.db';
}

async function runSqliteBackupToFile(destPath) {
  if (!db.sqlite) throw new Error('SQLite database is not open');
  try {
    db.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('[BACKUP] WAL checkpoint warning:', e.message);
  }
  await db.sqlite.backup(destPath);
  if (!fs.existsSync(destPath)) {
    throw new Error('Backup file was not created');
  }
}

/**
 * @param {{ prefix?: string }} [opts]
 * @returns {Promise<{ filename: string, filepath: string, size: number, engine: string }>}
 */
async function createDbBackup(opts = {}) {
  const backupDir = resolveBackupDir();
  const ext = backupExtension();
  const prefix = opts.prefix || 'nexor_erp';
  const filename = `${prefix}_${timestampSlug()}${ext}`;
  const filepath = path.join(backupDir, filename);

  if (db.engine === 'sqlite') {
    await runSqliteBackupToFile(filepath);
  } else {
    await createPostgresBackup(filepath);
  }

  const stats = fs.statSync(filepath);
  if (stats.size < 50) {
    try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    throw new Error('Backup file is empty or missing');
  }

  console.log(`[BACKUP] Created: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);

  let offsiteCopy = null;
  const offsiteDir = (process.env.BACKUP_OFFSITE_DIR || '').trim();
  if (offsiteDir) {
    try {
      fs.mkdirSync(offsiteDir, { recursive: true });
      const dest = path.join(offsiteDir, filename);
      fs.copyFileSync(filepath, dest);
      offsiteCopy = dest;
      console.log(`[BACKUP] Offsite copy: ${dest}`);
    } catch (e) {
      console.warn('[BACKUP] Offsite copy failed:', e.message);
      offsiteCopy = { error: e.message };
    }
  }

  return {
    filename,
    filepath,
    size: stats.size,
    engine: db.engine,
    backupDir,
    offsiteCopy,
    restoreRtoHint:
      'Restore RTO (target): under 1 hour for LAN ERP — stop clients, restore latest backup via Admin → Backup, restart backend, verify /api/health schema.',
  };
}

function listBackupFiles(backupDir = resolveBackupDir()) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => f.endsWith('.db') || f.endsWith('.sql'))
    .map((f) => {
      const stats = fs.statSync(path.join(backupDir, f));
      return {
        filename: f,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
        engine: f.endsWith('.sql') ? 'postgres' : 'sqlite',
        filepath: path.join(backupDir, f),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Keep newest `keep` auto/manual backups; never delete pre_restore_* */
function pruneOldBackups(keep = 14, backupDir = resolveBackupDir()) {
  const keepN = Math.max(1, Number(keep) || 14);
  const files = listBackupFiles(backupDir)
    .filter((f) => /^nexor_erp_[\d-T]+\.(db|sql)$/.test(f.filename));
  const toDelete = files.slice(keepN);
  let removed = 0;
  for (const f of toDelete) {
    try {
      fs.unlinkSync(f.filepath);
      removed += 1;
      console.log(`[BACKUP] Pruned old backup: ${f.filename}`);
    } catch (e) {
      console.warn(`[BACKUP] Could not prune ${f.filename}:`, e.message);
    }
  }
  return removed;
}

module.exports = {
  resolveBackupDir,
  timestampSlug,
  backupExtension,
  createDbBackup,
  listBackupFiles,
  pruneOldBackups,
  runSqliteBackupToFile,
};
