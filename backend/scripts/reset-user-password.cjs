#!/usr/bin/env node
/**
 * Reset a user password in PostgreSQL (server admin CLI).
 * Usage: node scripts/reset-user-password.cjs <email-or-username> <new-password>
 */
const { hashPassword } = require('../src/lib/passwordAuth');
const db = require('../src/db');
const { findUserForLogin } = require('../src/lib/loginUserLookup');

async function main() {
  const identifier = process.argv[2];
  const password = process.argv[3];
  if (!identifier || !password) {
    console.error('Usage: node scripts/reset-user-password.cjs <email-or-username> <new-password>');
    process.exit(1);
  }
  if (String(password).length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const user = await findUserForLogin(db, identifier);
  if (!user) {
    console.error(`User not found: ${identifier}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [passwordHash, user.id],
  );

  console.log(`Password reset OK for ${user.email} (${user.name})`);
  console.log(`Login with: ${user.username || user.email.split('@')[0]} or ${user.email}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
