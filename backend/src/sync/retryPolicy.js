/**
 * Staged retry delays for sync workers (Phase B0 spec).
 * 1m → 5m → 15m → 30m → 1h (then stays at 1h).
 */
const RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000,
  60 * 60 * 1000,
];

const MAX_ATTEMPTS_BEFORE_DEAD = 12;

function retryDelayMs(attempts) {
  const idx = Math.max(0, Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[idx];
}

function computeNextRetryAt(attempts) {
  const delayMs = retryDelayMs(attempts);
  return new Date(Date.now() + delayMs).toISOString();
}

function shouldMarkDead(attempts) {
  return attempts >= MAX_ATTEMPTS_BEFORE_DEAD;
}

module.exports = {
  RETRY_DELAYS_MS,
  MAX_ATTEMPTS_BEFORE_DEAD,
  retryDelayMs,
  computeNextRetryAt,
  shouldMarkDead,
};
