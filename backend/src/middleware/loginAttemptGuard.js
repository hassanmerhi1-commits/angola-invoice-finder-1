/**
 * Per-account login lockout (brute-force protection).
 * Persists to login_attempts so locks survive process restarts.
 * In-memory cache avoids a DB round-trip on every attempt in the hot path.
 */

const db = require('../db');

const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 5);
const WINDOW_MS = Number(process.env.LOGIN_FAIL_WINDOW_MS || 15 * 60 * 1000);
const LOCK_MS = Number(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000);

/** @type {Map<string, { count: number, firstAt: number, lockedUntil: number }>} */
const attempts = new Map();

function normalizeKey(identifier) {
  return String(identifier || '').trim().toLowerCase();
}

function disabled() {
  return process.env.NODE_ENV === 'test' || process.env.E2E_DISABLE_LOGIN_RATE_LIMIT === '1';
}

function toMs(value) {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function loadFromDb(key) {
  try {
    const r = await db.query(
      `SELECT fail_count, first_failed_at, locked_until FROM login_attempts WHERE identifier = $1`,
      [key],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      count: Number(row.fail_count || 0),
      firstAt: toMs(row.first_failed_at) || Date.now(),
      lockedUntil: toMs(row.locked_until),
    };
  } catch {
    return null;
  }
}

async function saveToDb(key, rec) {
  try {
    await db.query(
      `INSERT INTO login_attempts (identifier, fail_count, first_failed_at, locked_until, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (identifier) DO UPDATE SET
         fail_count = EXCLUDED.fail_count,
         first_failed_at = EXCLUDED.first_failed_at,
         locked_until = EXCLUDED.locked_until,
         updated_at = CURRENT_TIMESTAMP`,
      [
        key,
        rec.count,
        rec.firstAt ? new Date(rec.firstAt).toISOString() : null,
        rec.lockedUntil ? new Date(rec.lockedUntil).toISOString() : null,
      ],
    );
  } catch (err) {
    // Table may not exist until migration / ensurePhaseSchema.
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[AUTH] login_attempts persist skipped:', err.message);
    }
  }
}

async function deleteFromDb(key) {
  try {
    await db.query('DELETE FROM login_attempts WHERE identifier = $1', [key]);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {Promise<{ locked: boolean, retryAfterMs: number }>}
 */
async function isLocked(identifier) {
  if (disabled()) return { locked: false, retryAfterMs: 0 };
  const key = normalizeKey(identifier);
  if (!key) return { locked: false, retryAfterMs: 0 };

  let rec = attempts.get(key);
  if (!rec) {
    rec = await loadFromDb(key);
    if (rec) attempts.set(key, rec);
  }
  if (!rec || !rec.lockedUntil) return { locked: false, retryAfterMs: 0 };

  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfterMs: rec.lockedUntil - now };
  }
  attempts.delete(key);
  await deleteFromDb(key);
  return { locked: false, retryAfterMs: 0 };
}

/**
 * Record a failed attempt. Returns true if the identifier just became locked.
 */
async function recordFailure(identifier) {
  if (disabled()) return false;
  const key = normalizeKey(identifier);
  if (!key) return false;
  const now = Date.now();

  let rec = attempts.get(key);
  if (!rec) {
    rec = (await loadFromDb(key)) || null;
  }
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    rec = { count: 0, firstAt: now, lockedUntil: 0 };
  }
  rec.count += 1;
  let justLocked = false;
  if (rec.count >= MAX_FAILS) {
    rec.lockedUntil = now + LOCK_MS;
    justLocked = true;
  }
  attempts.set(key, rec);
  await saveToDb(key, rec);
  return justLocked;
}

async function recordSuccess(identifier) {
  const key = normalizeKey(identifier);
  if (!key) return;
  attempts.delete(key);
  await deleteFromDb(key);
}

module.exports = { isLocked, recordFailure, recordSuccess, MAX_FAILS, LOCK_MS };
