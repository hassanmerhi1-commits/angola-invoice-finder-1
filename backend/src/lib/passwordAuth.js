const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

/** Used when the user does not exist — still run bcrypt to reduce timing leaks. */
const DUMMY_BCRYPT_HASH =
  '$2a$12$eMqfxQm/5MvHdBkKV4vSj.aX3PxAyFYn08TQ25LGXFtQHL2vxBQwa';

function isBcryptHash(value) {
  const h = String(value || '');
  return /^\$2[aby]\$\d{2}\$/.test(h);
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * Verify password against bcrypt hash or legacy plain-text hash in DB.
 */
async function verifyPassword(plainPassword, storedHash) {
  const plain = String(plainPassword ?? '');
  const stored = String(storedHash ?? '');
  if (!plain || !stored) return false;

  if (isBcryptHash(stored)) {
    try {
      return await bcrypt.compare(plain, stored);
    } catch {
      return false;
    }
  }

  return timingSafeEqualString(plain, stored);
}

async function hashPassword(plainPassword) {
  return bcrypt.hash(String(plainPassword), BCRYPT_ROUNDS);
}

/**
 * After a successful login with a legacy plain-text hash, upgrade to bcrypt.
 */
async function upgradePasswordHashIfLegacy(db, userId, plainPassword, storedHash) {
  if (!userId || isBcryptHash(storedHash)) return;
  try {
    const passwordHash = await hashPassword(plainPassword);
    await db.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
      passwordHash,
      userId,
    ]);
  } catch (err) {
    console.warn('[AUTH] Could not upgrade password hash:', err.message);
  }
}

async function verifyPasswordWithDummyFallback(plainPassword, storedHash) {
  const hash = storedHash && String(storedHash).length > 0 ? storedHash : DUMMY_BCRYPT_HASH;
  return verifyPassword(plainPassword, hash);
}

module.exports = {
  BCRYPT_ROUNDS,
  DUMMY_BCRYPT_HASH,
  isBcryptHash,
  verifyPassword,
  verifyPasswordWithDummyFallback,
  hashPassword,
  upgradePasswordHashIfLegacy,
};
