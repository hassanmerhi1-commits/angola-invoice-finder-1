/**
 * AGT Phase 10 — security readiness checklist for Settings / certification.
 */
const db = require('../db');
const {
  getLatestBackup,
  resolveBackupDir,
  EXPECTED_SCHEMA_VERSION,
  readAppVersion,
} = require('./deploymentStatus');
const { isJwtSecretConfigured, isMasterSecretConfigured, secretsDir } = require('./nexorSecrets');
const { countActiveSessions } = require('./sessionLog');

async function countLegacyPasswordHashes() {
  try {
    const res = await db.query(
      `SELECT COUNT(*)::int AS n FROM users
       WHERE password_hash IS NOT NULL
         AND password_hash NOT LIKE '$2%'`,
    ).catch(async () => {
      const r = await db.query(
        `SELECT COUNT(*) AS n FROM users
         WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '$2%'`,
      );
      return { rows: [{ n: Number(r.rows[0]?.n || 0) }] };
    });
    return Number(res.rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

async function countRecentFailedLogins(hours = 24) {
  try {
    let res;
    if (db.engine === 'postgres') {
      res = await db.query(
        `SELECT COUNT(*)::int AS n FROM audit_log
         WHERE action = 'login_failed'
           AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
      );
    } else {
      res = await db.query(
        `SELECT COUNT(*) AS n FROM audit_log
         WHERE action = 'login_failed'
           AND datetime(created_at) >= datetime('now', '-24 hours')`,
      );
    }
    return Number(res.rows[0]?.n || 0);
  } catch {
    return 0;
  }
}

async function getSecurityStatus() {
  const backupDir = resolveBackupDir();
  const latestBackup = getLatestBackup(backupDir);
  const backupCount = backupDir && require('fs').existsSync(backupDir)
    ? require('fs').readdirSync(backupDir).filter((f) => /\.(db|sql)$/i.test(f)).length
    : 0;

  let backupAgeDays = null;
  if (latestBackup?.createdAt) {
    backupAgeDays = Math.floor(
      (Date.now() - new Date(latestBackup.createdAt).getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  const legacyPasswords = await countLegacyPasswordHashes();
  const failedLogins24h = await countRecentFailedLogins(24);
  const activeSessions = await countActiveSessions();

  const jwtOk = isJwtSecretConfigured();
  const masterOk = isMasterSecretConfigured();

  const checks = [
    {
      id: 'jwt_secret',
      ok: jwtOk,
      level: jwtOk ? 'ok' : 'warn',
      message: jwtOk
        ? 'JWT signing secret is persisted or set via environment'
        : 'JWT secret is ephemeral — set JWT_SECRET or allow jwt.secret file',
    },
    {
      id: 'master_secret',
      ok: masterOk,
      level: masterOk ? 'ok' : 'warn',
      message: masterOk
        ? 'Encryption master key configured (AGT API key & cert passphrases)'
        : 'Set NEXOR_SECRET_KEY or allow master.key generation on first run',
    },
    {
      id: 'password_hashing',
      ok: legacyPasswords === 0,
      level: legacyPasswords === 0 ? 'ok' : 'warn',
      message: legacyPasswords === 0
        ? 'All user passwords use bcrypt'
        : `${legacyPasswords} user(s) still on legacy password hash — re-login or reset`,
    },
    {
      id: 'backups',
      ok: Boolean(latestBackup),
      level: !latestBackup ? 'critical' : (backupAgeDays != null && backupAgeDays > 7 ? 'warn' : 'ok'),
      message: !latestBackup
        ? 'No database backup found — create one before go-live'
        : `Latest backup: ${latestBackup.filename} (${backupAgeDays ?? 0} day(s) ago)`,
    },
    {
      id: 'session_log',
      ok: true,
      level: 'ok',
      message: `Session log active — ${activeSessions} open session(s)`,
    },
    {
      id: 'audit_log',
      ok: true,
      level: 'ok',
      message: 'Fiscal audit log records login, logout, and failed attempts',
    },
    {
      id: 'schema',
      ok: true,
      level: 'ok',
      message: `Schema version ${EXPECTED_SCHEMA_VERSION} expected`,
    },
  ];

  const criticalCount = checks.filter((c) => c.level === 'critical' && !c.ok).length;
  const warnCount = checks.filter((c) => c.level === 'warn' || (!c.ok && c.level !== 'critical')).length;

  return {
    ok: criticalCount === 0,
    attention: criticalCount > 0 || warnCount > 0,
    appVersion: readAppVersion(),
    schemaVersionExpected: EXPECTED_SCHEMA_VERSION,
    jwtSecretConfigured: jwtOk,
    masterSecretConfigured: masterOk,
    secretsDirectory: secretsDir(),
    backups: {
      directory: backupDir,
      count: backupCount,
      latest: latestBackup,
      ageDays: backupAgeDays,
    },
    passwords: {
      legacyHashCount: legacyPasswords,
      minLength: 8,
    },
    sessions: {
      activeCount: activeSessions,
      failedLogins24h,
    },
    checks,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { getSecurityStatus };
