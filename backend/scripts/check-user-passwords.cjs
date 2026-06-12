#!/usr/bin/env node
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const TEST_PASSWORDS = [
  'merhi123', 'hussien123', 'Merhi123', 'password', '12345678',
  'merhi', 'hussien', 'changeme', 'merhi@123', 'hussien@123',
  'Password1', 'password1', 'nexor123', 'kwanza123',
];

async function main() {
  const r = await db.query(
    `SELECT id, email, username, password_hash, is_active
     FROM users
     WHERE email NOT IN ('admin@kwanzaerp.ao', 'caixa1@kwanzaerp.ao')
     ORDER BY email`,
  );
  for (const row of r.rows) {
    let matched = null;
    for (const p of TEST_PASSWORDS) {
      if (await bcrypt.compare(p, row.password_hash)) matched = p;
    }
    console.log(
      `${row.email} active=${row.is_active} hash_ok=${/^\$2/.test(row.password_hash)} matched=${matched || 'NONE'}`,
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
