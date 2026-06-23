/**
 * User session log — AGT Phase 10 (login, logout, activity).
 */
const crypto = require('crypto');
const db = require('../db');
const { workstationFromReq, ipFromReq } = require('./fiscalAudit');

const touchThrottleMs = 60_000;
const lastTouchByJti = new Map();

// Revocation cache: jti -> { revoked: boolean, exp: epochMs }. Keeps the
// per-request auth check from hitting the DB on every API call.
const revocationCacheTtlMs = 15_000;
const revocationCache = new Map();

let tableExistsPromise = null;
async function tableExists() {
  // Schema doesn't change at runtime — resolve once and cache for the process.
  if (tableExistsPromise) return tableExistsPromise;
  tableExistsPromise = (async () => {
    try {
      const r = await db.query(
        db.engine === 'postgres'
          ? `SELECT 1 FROM information_schema.tables WHERE table_name = 'user_sessions' LIMIT 1`
          : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'user_sessions' LIMIT 1`,
      );
      return r.rows.length > 0;
    } catch {
      tableExistsPromise = null; // allow retry after a transient failure
      return false;
    }
  })();
  return tableExistsPromise;
}

/**
 * True if the session for this jti was explicitly ended (logout / admin revoke).
 * Fails open (returns false) when sessions are unavailable or the jti has no
 * row, so pre-existing tokens and missing-table setups are never locked out.
 */
async function isSessionRevoked(jti) {
  if (!jti) return false;
  const now = Date.now();
  const cached = revocationCache.get(jti);
  if (cached && cached.exp > now) return cached.revoked;
  if (!(await tableExists())) return false;
  let revoked = false;
  try {
    const r = await db.query(
      `SELECT ended_at FROM user_sessions WHERE token_jti = $1 ORDER BY started_at DESC LIMIT 1`,
      [jti],
    );
    if (r.rows.length > 0) {
      revoked = r.rows[0].ended_at != null;
    }
  } catch {
    revoked = false;
  }
  revocationCache.set(jti, { revoked, exp: now + revocationCacheTtlMs });
  return revoked;
}

async function startSession(req, { userId, userName, branchId, tokenJti }) {
  if (!(await tableExists())) return null;
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO user_sessions (
      id, user_id, token_jti, ip_address, workstation_id, user_agent, started_at, last_seen_at
    ) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
    [
      id,
      userId,
      tokenJti,
      ipFromReq(req),
      workstationFromReq(req),
      String(req.headers['user-agent'] || '').slice(0, 500) || null,
    ],
  );
  return id;
}

async function touchSession(tokenJti) {
  if (!tokenJti || !(await tableExists())) return;
  const now = Date.now();
  const last = lastTouchByJti.get(tokenJti) || 0;
  if (now - last < touchThrottleMs) return;
  lastTouchByJti.set(tokenJti, now);
  await db.query(
    `UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP
     WHERE token_jti = $1 AND ended_at IS NULL`,
    [tokenJti],
  ).catch(() => {});
}

async function endSession({ tokenJti, userId, reason = 'logout' }) {
  if (!(await tableExists())) return false;
  let result;
  if (tokenJti) {
    result = await db.query(
      `UPDATE user_sessions
       SET ended_at = CURRENT_TIMESTAMP, end_reason = $2
       WHERE token_jti = $1 AND ended_at IS NULL
       RETURNING id`,
      [tokenJti, reason],
    );
  } else if (userId) {
    result = await db.query(
      `UPDATE user_sessions
       SET ended_at = CURRENT_TIMESTAMP, end_reason = $2
       WHERE user_id = $1 AND ended_at IS NULL
       RETURNING id`,
      [userId, reason],
    );
  }
  if (tokenJti) {
    lastTouchByJti.delete(tokenJti);
    // Prime the cache so the just-revoked token is rejected immediately,
    // without waiting for the TTL to expire.
    revocationCache.set(tokenJti, { revoked: true, exp: Date.now() + revocationCacheTtlMs });
  }
  return (result?.rows?.length || 0) > 0;
}

async function listSessions({ limit = 50, activeOnly = false, userId = null } = {}) {
  if (!(await tableExists())) return [];
  const params = [];
  let where = 'WHERE 1=1';
  if (activeOnly) {
    where += ' AND s.ended_at IS NULL';
  }
  if (userId) {
    params.push(userId);
    where += ` AND s.user_id = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 50, 200));
  const res = await db.query(
    `SELECT s.*, u.name AS user_name, u.email AS user_email
     FROM user_sessions s
     LEFT JOIN users u ON u.id = s.user_id
     ${where}
     ORDER BY s.started_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return res.rows;
}

async function countActiveSessions() {
  if (!(await tableExists())) return 0;
  const res = await db.query(
    `SELECT COUNT(*)::int AS n FROM user_sessions WHERE ended_at IS NULL`,
  ).catch(async () => {
    const fallback = await db.query(`SELECT COUNT(*) AS n FROM user_sessions WHERE ended_at IS NULL`);
    return { rows: [{ n: Number(fallback.rows[0]?.n || 0) }] };
  });
  return Number(res.rows[0]?.n || 0);
}

module.exports = {
  startSession,
  touchSession,
  endSession,
  listSessions,
  countActiveSessions,
  isSessionRevoked,
};
