const db = require('../db');
const { hashPassword, isBcryptHash, verifyPassword } = require('./passwordAuth');

const DEFAULT_ACCOUNTS = [
  {
    localPart: 'admin',
    emails: ['admin@kwanzaerp.ao', 'admin@nexor.local'],
    passwords: ['changeme', 'admin'],
    canonicalEmail: 'admin@kwanzaerp.ao',
  },
  {
    localPart: 'caixa1',
    emails: ['caixa1@kwanzaerp.ao'],
    passwords: ['caixa1'],
    canonicalEmail: 'caixa1@kwanzaerp.ao',
  },
];

function isBrokenBcryptHash(storedHash) {
  const h = String(storedHash || '');
  if (!isBcryptHash(h)) return false;
  if (h.includes('xxxxxxxx')) return true;
  if (h.length < 50) return true;
  return false;
}

async function repairUserPassword(user, account) {
  const stored = user.password_hash;
  const preferred = account.passwords[0];
  const needsRepair =
    !stored
    || !isBcryptHash(stored)
    || isBrokenBcryptHash(stored)
    || !(await verifyPassword(preferred, stored));

  if (!needsRepair) return false;
  const passwordHash = await hashPassword(preferred);
  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [passwordHash, user.id],
  );
  console.log(`[AUTH] Reset password for ${user.email} → use "${preferred}"`);
  return true;
}

/**
 * Align default admin/caixa accounts so login works after legacy seeds and security migration.
 */
async function ensureAuthUsersReady() {
  try {
    const result = await db.query('SELECT id, email, password_hash, is_active FROM users');
    let repaired = 0;

    for (const user of result.rows) {
      const email = String(user.email || '').trim().toLowerCase();
      const account = DEFAULT_ACCOUNTS.find(
        (a) => a.emails.includes(email) || email.split('@')[0] === a.localPart,
      );
      if (!account) continue;

      if (email !== account.canonicalEmail && account.emails.includes(email)) {
        try {
          await db.query('UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
            account.canonicalEmail,
            user.id,
          ]);
          console.log(`[AUTH] Normalized email ${email} → ${account.canonicalEmail}`);
          user.email = account.canonicalEmail;
        } catch (err) {
          if (!String(err.message || '').includes('UNIQUE')) {
            console.warn('[AUTH] Could not normalize email:', err.message);
          }
        }
      }

      if (await repairUserPassword(user, account)) repaired += 1;
    }

    const hasUser = result.rows.length > 0;
    if (!hasUser) return;

    if (repaired > 0) {
      console.log(`[AUTH] Repaired ${repaired} default account password(s)`);
    }

    try {
      await db.query(
        `UPDATE users SET username = LOWER(substr(email, 1, instr(email, '@') - 1))
         WHERE (username IS NULL OR username = '') AND email LIKE '%@%'`,
      );
    } catch (_) {}
  } catch (err) {
    console.warn('[AUTH] ensureAuthUsersReady skipped:', err.message);
  }
}

module.exports = { ensureAuthUsersReady };
