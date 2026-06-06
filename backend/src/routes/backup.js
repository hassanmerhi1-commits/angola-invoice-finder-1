// Backup API — SQLite (.db via better-sqlite3 backup) and PostgreSQL (pg_dump)
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db');
const { createPostgresBackup, restorePostgresBackup } = require('../lib/pgBackupCli');

let restoreInProgress = false;

module.exports = function backupRoutes() {
  const router = express.Router();

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

  const BACKUP_DIR = resolveBackupDir();
  console.log(`[BACKUP] Using backup directory: ${BACKUP_DIR}`);

  const BACKUP_EXT = db.engine === 'postgres' ? '.sql' : '.db';

  function timestampSlug() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function isSafeBackupFilename(name) {
    return /^nexor_erp_[\d-T]+\.(db|sql)$/.test(name) || /^pre_restore_[\d-T]+\.db$/.test(name);
  }

  function listBackupFiles() {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db') || f.endsWith('.sql'))
      .map((f) => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          size: stats.size,
          createdAt: stats.mtime.toISOString(),
          engine: f.endsWith('.sql') ? 'postgres' : 'sqlite',
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /** better-sqlite3 v12+: .backup() returns a Promise (not step/finish/close). */
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

  function removeWalSidecars(dbFilePath) {
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbFilePath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        try {
          fs.unlinkSync(sidecar);
        } catch (e) {
          console.warn(`[BACKUP] Could not remove ${sidecar}:`, e.message);
        }
      }
    }
  }

  function assertNotRestoring(res) {
    if (restoreInProgress) {
      res.status(503).json({ error: 'Database restore in progress. Try again shortly.' });
      return true;
    }
    return false;
  }

  // GET /api/backup/info
  router.get('/info', async (_req, res) => {
    try {
      let databaseSize = null;
      if (db.engine === 'sqlite' && db.dbPath && fs.existsSync(db.dbPath)) {
        databaseSize = fs.statSync(db.dbPath).size;
      }
      res.json({
        engine: db.engine,
        databasePath: db.engine === 'sqlite' ? db.dbPath : null,
        databaseSize,
        backupDir: BACKUP_DIR,
        backupExtension: BACKUP_EXT,
        appVersion: process.env.npm_package_version || '1.0.0',
        restoreInProgress,
      });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to read backup info' });
    }
  });

  // GET /api/backup — list backups
  router.get('/', async (_req, res) => {
    try {
      res.json(listBackupFiles());
    } catch (error) {
      res.status(500).json({ error: 'Failed to list backups' });
    }
  });

  // POST /api/backup — create backup
  router.post('/', async (req, res) => {
    if (assertNotRestoring(res)) return;
    try {
      const timestamp = timestampSlug();
      const filename = `nexor_erp_${timestamp}${BACKUP_EXT}`;
      const filepath = path.join(BACKUP_DIR, filename);

      if (db.engine === 'sqlite') {
        await runSqliteBackupToFile(filepath);
      } else {
        await createPostgresBackup(filepath);
      }

      const stats = fs.statSync(filepath);
      console.log(`[BACKUP] Created: ${filename} (${(stats.size / 1024).toFixed(1)} KB)`);

      res.json({
        success: true,
        filename,
        size: stats.size,
        path: filepath,
        engine: db.engine,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[BACKUP ERROR]', error.message);
      res.status(500).json({ error: `Backup failed: ${error.message}` });
    }
  });

  // POST /api/backup/restore/upload — body = raw .db / .sql file
  router.post(
    '/restore/upload',
    express.raw({ type: ['application/octet-stream', 'application/x-sqlite3', 'application/vnd.sqlite3', '*/*'], limit: '512mb' }),
    async (req, res) => {
      if (restoreInProgress) {
        return res.status(503).json({ error: 'Restore already in progress' });
      }

      const originalName = path.basename(String(req.headers['x-filename'] || 'upload.db'));
      const ext = path.extname(originalName).toLowerCase();
      const expectedExt = BACKUP_EXT;

      if (ext !== expectedExt && !(db.engine === 'sqlite' && ext === '.db')) {
        return res.status(400).json({ error: `Expected a ${expectedExt} backup file` });
      }

      if (!req.body || !Buffer.isBuffer(req.body) || req.body.length < 100) {
        return res.status(400).json({ error: 'Empty or invalid backup file' });
      }

      restoreInProgress = true;
      const tempPath = path.join(BACKUP_DIR, `_upload_${timestampSlug()}${expectedExt}`);

      try {
        fs.writeFileSync(tempPath, req.body);

        if (db.engine === 'sqlite') {
          const preName = `pre_restore_${timestampSlug()}.db`;
          const prePath = path.join(BACKUP_DIR, preName);
          await runSqliteBackupToFile(prePath);

          db.closeSqliteConnection();
          removeWalSidecars(db.dbPath);
          fs.copyFileSync(tempPath, db.dbPath);
          db.reopenSqliteConnection();

          const check = db.sqlite.prepare('PRAGMA integrity_check').get();
          const ok = check && (check.integrity_check === 'ok' || check.integrity_check === 'OK');
          if (!ok) {
            throw new Error(`Integrity check failed: ${JSON.stringify(check)}`);
          }
        } else {
          const preName = `pre_restore_${timestampSlug()}.sql`;
          await createPostgresBackup(path.join(BACKUP_DIR, preName));
          await restorePostgresBackup(tempPath);
        }

        console.log(`[BACKUP] Restored from upload (${originalName})`);
        res.json({
          success: true,
          requiresRestart: db.engine === 'sqlite',
          message: 'Database restored successfully',
        });
      } catch (error) {
        console.error('[BACKUP RESTORE ERROR]', error.message);
        if (db.engine === 'sqlite') {
          try {
            db.reopenSqliteConnection();
          } catch (reopenErr) {
            console.error('[BACKUP] Reopen after failed restore:', reopenErr.message);
          }
        }
        res.status(500).json({ error: `Restore failed: ${error.message}` });
      } finally {
        restoreInProgress = false;
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (_) {
          /* ignore */
        }
      }
    }
  );

  // POST /api/backup/restore/:filename — restore from server backup folder
  router.post('/restore/:filename', async (req, res) => {
    if (restoreInProgress) {
      return res.status(503).json({ error: 'Restore already in progress' });
    }

    const safe = path.basename(req.params.filename);
    if (!isSafeBackupFilename(safe)) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }

    const filepath = path.join(BACKUP_DIR, safe);
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    restoreInProgress = true;
    try {
      if (db.engine === 'sqlite') {
        if (!safe.endsWith('.db')) {
          res.status(400).json({ error: 'SQLite restore requires a .db file' });
          return;
        }
        const preName = `pre_restore_${timestampSlug()}.db`;
        await runSqliteBackupToFile(path.join(BACKUP_DIR, preName));

        db.closeSqliteConnection();
        removeWalSidecars(db.dbPath);
        fs.copyFileSync(filepath, db.dbPath);
        db.reopenSqliteConnection();

        const check = db.sqlite.prepare('PRAGMA integrity_check').get();
        const ok = check && (check.integrity_check === 'ok' || check.integrity_check === 'OK');
        if (!ok) {
          throw new Error(`Integrity check failed: ${JSON.stringify(check)}`);
        }
      } else {
        if (!safe.endsWith('.sql')) {
          res.status(400).json({ error: 'PostgreSQL restore requires a .sql file' });
          return;
        }
        const preName = `pre_restore_${timestampSlug()}.sql`;
        await createPostgresBackup(path.join(BACKUP_DIR, preName));
        await restorePostgresBackup(filepath);
      }

      console.log(`[BACKUP] Restored: ${safe}`);
      res.json({
        success: true,
        filename: safe,
        requiresRestart: db.engine === 'sqlite',
      });
    } catch (error) {
      console.error('[BACKUP RESTORE ERROR]', error.message);
      if (db.engine === 'sqlite') {
        try {
          db.reopenSqliteConnection();
        } catch (_) {
          /* ignore */
        }
      }
      res.status(500).json({ error: `Restore failed: ${error.message}` });
    } finally {
      restoreInProgress = false;
    }
  });

  // GET /api/backup/:filename — download
  router.get('/:filename', async (req, res) => {
    try {
      const safe = path.basename(req.params.filename);
      if (req.params.filename === 'info') {
        return res.status(404).json({ error: 'Not found' });
      }
      const filepath = path.join(BACKUP_DIR, safe);
      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'Backup not found' });
      }
      res.download(filepath, safe);
    } catch (error) {
      res.status(500).json({ error: 'Failed to download backup' });
    }
  });

  // DELETE /api/backup/:filename
  router.delete('/:filename', async (req, res) => {
    try {
      const safe = path.basename(req.params.filename);
      if (!isSafeBackupFilename(safe)) {
        return res.status(400).json({ error: 'Invalid backup filename' });
      }
      const filepath = path.join(BACKUP_DIR, safe);
      if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'Backup not found' });
      }
      fs.unlinkSync(filepath);
      console.log(`[BACKUP] Deleted: ${safe}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete backup' });
    }
  });

  return router;
};
