/**
 * Scheduled database backups (server-side).
 * Env:
 *   AUTO_BACKUP=0|false to disable (default: enabled)
 *   AUTO_BACKUP_INTERVAL_HOURS=24
 *   AUTO_BACKUP_KEEP=14
 *   AUTO_BACKUP_STARTUP_DELAY_MS=120000
 */
const { createDbBackup, listBackupFiles, pruneOldBackups, resolveBackupDir } = require('../lib/createDbBackup');

let intervalHandle = null;
let running = false;
let lastResult = null;

function envFlag(name, defaultTrue = true) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultTrue;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

function intervalMs() {
  const hours = Number(process.env.AUTO_BACKUP_INTERVAL_HOURS);
  const h = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return Math.round(h * 60 * 60 * 1000);
}

function keepCount() {
  const n = Number(process.env.AUTO_BACKUP_KEEP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
}

function startupDelayMs() {
  const n = Number(process.env.AUTO_BACKUP_STARTUP_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 120000;
}

function hasFreshBackup(maxAgeMs) {
  const files = listBackupFiles();
  if (!files.length) return false;
  const age = Date.now() - new Date(files[0].createdAt).getTime();
  return age < maxAgeMs;
}

async function runAutoBackupCycle(reason = 'schedule') {
  if (!envFlag('AUTO_BACKUP', true)) return null;
  if (running) {
    console.log('[AUTO-BACKUP] Skipped — already running');
    return null;
  }
  running = true;
  try {
    // Skip if a backup newer than ~80% of the interval already exists.
    if (hasFreshBackup(Math.floor(intervalMs() * 0.8))) {
      console.log(`[AUTO-BACKUP] Skipped (${reason}) — recent backup already present`);
      lastResult = { ok: true, skipped: true, reason: 'fresh', at: new Date().toISOString() };
      return lastResult;
    }

    const result = await createDbBackup({ prefix: 'nexor_erp' });
    const pruned = pruneOldBackups(keepCount(), result.backupDir);
    lastResult = {
      ok: true,
      skipped: false,
      reason,
      filename: result.filename,
      size: result.size,
      pruned,
      at: new Date().toISOString(),
    };
    console.log(`[AUTO-BACKUP] OK (${reason}): ${result.filename}`);
    return lastResult;
  } catch (e) {
    lastResult = {
      ok: false,
      skipped: false,
      reason,
      error: e.message || String(e),
      at: new Date().toISOString(),
    };
    console.error(`[AUTO-BACKUP] Failed (${reason}):`, e.message || e);
    return lastResult;
  } finally {
    running = false;
  }
}

function getAutoBackupStatus() {
  return {
    enabled: envFlag('AUTO_BACKUP', true),
    intervalHours: intervalMs() / (60 * 60 * 1000),
    keep: keepCount(),
    backupDir: (() => {
      try { return resolveBackupDir(); } catch { return null; }
    })(),
    lastResult,
  };
}

function startAutoBackupWorker() {
  if (!envFlag('AUTO_BACKUP', true)) {
    console.log('[AUTO-BACKUP] Disabled (AUTO_BACKUP=0)');
    return;
  }
  if (intervalHandle) return;

  const delay = startupDelayMs();
  console.log(
    `[AUTO-BACKUP] Enabled — first run in ${Math.round(delay / 1000)}s, then every ${intervalMs() / 3600000}h (keep ${keepCount()})`,
  );

  setTimeout(() => {
    runAutoBackupCycle('startup').catch(() => {});
  }, delay);

  intervalHandle = setInterval(() => {
    runAutoBackupCycle('interval').catch(() => {});
  }, intervalMs());
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

function stopAutoBackupWorker() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startAutoBackupWorker,
  stopAutoBackupWorker,
  runAutoBackupCycle,
  getAutoBackupStatus,
};
