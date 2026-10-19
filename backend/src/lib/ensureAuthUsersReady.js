const crypto = require('crypto');
const db = require('../db');
const { hashPassword, isBcryptHash, isBrokenBcryptHash } = require('./passwordAuth');

const DEFAULT_ACCOUNTS = [
  {
    localPart: 'admin',
    emails: ['admin@kwanzaerp.ao', 'admin@nexor.local'],
    passwords: ['changeme', 'admin'],
    canonicalEmail: 'admin@kwanzaerp.ao',
    name: 'Administrador',
    role: 'admin',
  },
  {
    localPart: 'caixa1',
    emails: ['caixa1@kwanzaerp.ao'],
    passwords: ['caixa1'],
    canonicalEmail: 'caixa1@kwanzaerp.ao',
    name: 'Caixa 1',
    role: 'cashier',
  },
];

function forceChangeDefaultPassword() {
  return process.env.NODE_ENV !== 'test'
    && process.env.E2E_ALLOW_DEFAULT_PASSWORD !== '1';
}

async function resolveSeedBranchId() {
  try {
    const result = await db.query(
      db.engine === 'postgres'
        ? `SELECT id FROM branches ORDER BY COALESCE(is_main, false) DESC, name LIMIT 1`
        : `SELECT id FROM branches ORDER BY COALESCE(is_main, 0) DESC, name LIMIT 1`,
    );
    if (result.rows[0]?.id) return result.rows[0].id;
  } catch (_) { /* branches table may not exist yet */ }

  const id = 'b0000000-0000-0000-0000-000000000001';
  try {
    await db.query(
      `INSERT INTO branches (id, name, code, address, phone, is_main)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, 'Filial Principal', 'FP', '', '', db.engine === 'postgres' ? true : 1],
    );
  } catch (_) { /* already present or schema too old */ }
  return id;
}

async function insertDefaultAccount(account, branchId) {
  const passwordHash = await hashPassword(account.passwords[0]);
  const forceChange = forceChangeDefaultPassword();
  const id = crypto.randomUUID();
  const active = db.engine === 'postgres' ? true : 1;
  try {
    await db.query(
      `INSERT INTO users (id, email, username, name, role, branch_id, password_hash, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        account.canonicalEmail,
        account.localPart,
        account.name,
        account.role,
        branchId,
        passwordHash,
        active,
        forceChange ? 1 : 0,
      ],
    );
  } catch (err) {
    try {
      await db.query(
        `INSERT INTO users (id, email, name, role, branch_id, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, account.canonicalEmail, account.name, account.role, branchId, passwordHash, active],
      );
    } catch (fallbackErr) {
      if (!/unique|duplicate|constraint/i.test(String(fallbackErr.message || ''))) {
        throw fallbackErr;
      }
      return false;
    }
  }
  console.log(`[AUTH] Seeded ${account.canonicalEmail} → use "${account.passwords[0]}" and change it after login`);
  return true;
}

async function repairUserPassword(user, account) {
  const stored = user.password_hash;
  const preferred = account.passwords[0];
  // Only repair when there is no usable credential at all (missing, non-bcrypt,
  // or a broken/placeholder hash). A valid bcrypt hash is left untouched even if
  // it no longer matches the factory default — otherwise a deliberate password
  // change would be silently reverted to the public default on every restart.
  const needsRepair =
    !stored
    || !isBcryptHash(stored)
    || isBrokenBcryptHash(stored);

  if (!needsRepair) return false;
  const passwordHash = await hashPassword(preferred);
  const forceChange = forceChangeDefaultPassword();
  try {
    await db.query(
      'UPDATE users SET password_hash = $1, must_change_password = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [passwordHash, forceChange ? 1 : 0, user.id],
    );
  } catch (err) {
    // Column may not exist until ensurePhaseSchema / migration 060.
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, user.id],
    );
    console.warn('[AUTH] must_change_password column missing; password repaired without flag:', err.message);
  }
  console.log(`[AUTH] Initialized default credential for ${user.email} → use "${preferred}" and change it after login`);
  return true;
}

function findAccountForUser(email) {
  return DEFAULT_ACCOUNTS.find(
    (a) => a.emails.includes(email) || email.split('@')[0] === a.localPart,
  );
}

/**
 * Align default admin/caixa accounts so login works after legacy seeds and security migration.
 * Also creates the factory admin when a fresh Postgres city DB has no users
 * (001 placeholder hash + skipped 009 / empty-ledger bootstrap).
 */
async function ensureAuthUsersReady() {
  try {
    const result = await db.query('SELECT id, email, password_hash, is_active FROM users');
    let repaired = 0;
    let seeded = 0;

    for (const user of result.rows) {
      const email = String(user.email || '').trim().toLowerCase();
      const account = findAccountForUser(email);
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

    const present = new Set(
      result.rows.map((row) => String(row.email || '').trim().toLowerCase().split('@')[0]),
    );
    const missing = DEFAULT_ACCOUNTS.filter((account) => !present.has(account.localPart));
    if (missing.length > 0) {
      const branchId = await resolveSeedBranchId();
      for (const account of missing) {
        if (await insertDefaultAccount(account, branchId)) seeded += 1;
      }
    }

    if (repaired > 0) {
      console.log(`[AUTH] Repaired ${repaired} default account password(s)`);
    }
    if (seeded > 0) {
      console.log(`[AUTH] Seeded ${seeded} missing default account(s)`);
    }

    try {
      if (db.engine === 'postgres') {
        await db.query(
          `UPDATE users SET username = LOWER(SPLIT_PART(email, '@', 1))
           WHERE (username IS NULL OR TRIM(COALESCE(username, '')) = '') AND email LIKE '%@%'`,
        );
      } else {
        await db.query(
          `UPDATE users SET username = LOWER(substr(email, 1, instr(email, '@') - 1))
           WHERE (username IS NULL OR username = '') AND email LIKE '%@%'`,
        );
      }
    } catch (_) {}
  } catch (err) {
    console.warn('[AUTH] ensureAuthUsersReady skipped:', err.message);
  }
}

module.exports = { ensureAuthUsersReady };
