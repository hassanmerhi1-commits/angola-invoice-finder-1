/**
 * Per-account login lockout (brute-force protection).
 *
 * Complements the per-IP loginRateLimiter: this throttles repeated failures
 * against a single identifier regardless of source IP. State is in-memory
 * (single backend process / LAN desktop deployment); it resets on restart and
 * on any successful login for that identifier.
 */

const MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS || 5);
const WINDOW_MS = Number(process.env.LOGIN_FAIL_WINDOW_MS || 15 * 60 * 1000);
const LOCK_MS = Number(process.env.LOGIN_LOCK_MS || 15 * 60 * 1000);

/** identifier -> { count, firstAt, lockedUntil } */
const attempts = new Map();

function normalizeKey(identifier) {
  return String(identifier || '').trim().toLowerCase();
}

function disabled() {
  return process.env.NODE_ENV === 'test' || process.env.E2E_DISABLE_LOGIN_RATE_LIMIT === '1';
}

/**
 * @returns {{ locked: boolean, retryAfterMs: number }}
 */
function isLocked(identifier) {
  if (disabled()) return { locked: false, retryAfterMs: 0 };
  const key = normalizeKey(identifier);
  if (!key) return { locked: false, retryAfterMs: 0 };
  const rec = attempts.get(key);
  if (!rec || !rec.lockedUntil) return { locked: false, retryAfterMs: 0 };
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return { locked: true, retryAfterMs: rec.lockedUntil - now };
  }
  // Lock expired — clear it so the next attempt starts fresh.
  attempts.delete(key);
  return { locked: false, retryAfterMs: 0 };
}

/**
 * Record a failed attempt. Returns true if the identifier just became locked.
 */
function recordFailure(identifier) {
  if (disabled()) return false;
  const key = normalizeKey(identifier);
  if (!key) return false;
  const now = Date.now();
  let rec = attempts.get(key);
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
  return justLocked;
}

function recordSuccess(identifier) {
  const key = normalizeKey(identifier);
  if (key) attempts.delete(key);
}

module.exports = { isLocked, recordFailure, recordSuccess, MAX_FAILS, LOCK_MS };
