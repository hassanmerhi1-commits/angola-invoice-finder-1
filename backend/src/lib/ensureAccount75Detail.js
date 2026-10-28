/**
 * Insert the account 75 supplies/tax detail if it is missing.
 * Does not deactivate customer, supplier, or till accounts.
 * Safe to run on every server start: existing codes are left in place,
 * except 752 and 753, which become groups once they have children.
 */
const crypto = require('crypto');
const { PGC_ACCOUNTS } = require('./pgcChartOfAccounts');

function isAccount75Detail(account) {
  const code = String(account?.code || '');
  return code === '752'
    || code === '753'
    || code.startsWith('7520')
    || code.startsWith('7521')
    || code.startsWith('7531')
    || code.startsWith('7532');
}

function account75DetailRows() {
  return PGC_ACCOUNTS.filter(isAccount75Detail);
}

async function ensureAccount75Detail(db) {
  if (!db || typeof db.query !== 'function') return { created: 0, linked: 0 };
  const rows = account75DetailRows()
    .slice()
    .sort((a, b) => a.code.length - b.code.length || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  let created = 0;
  for (const account of rows) {
    if (account.code === '752' || account.code === '753') {
      await db.query(
        'UPDATE chart_of_accounts SET is_header = $1 WHERE code = $2',
        [true, account.code],
      );
      continue;
    }
    const existing = await db.query(
      'SELECT id FROM chart_of_accounts WHERE code = $1 LIMIT 1',
      [account.code],
    );
    if (existing.rows && existing.rows.length) {
      await db.query(
        `UPDATE chart_of_accounts
            SET name = $1, level = $2, is_header = $3, is_active = $4
          WHERE code = $5`,
        [account.name, account.level, !!account.is_header, true, account.code],
      );
      continue;
    }
    await db.query(
      `INSERT INTO chart_of_accounts
         (id, code, name, account_type, account_nature, level, is_header, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        crypto.randomUUID(),
        account.code,
        account.name,
        account.account_type,
        account.account_nature,
        account.level,
        !!account.is_header,
        true,
      ],
    );
    created += 1;
  }

  let linked = 0;
  for (const account of rows) {
    if (!account.parent_code) continue;
    const updated = await db.query(
      `UPDATE chart_of_accounts
          SET parent_id = (SELECT id FROM chart_of_accounts WHERE code = $1 LIMIT 1)
        WHERE code = $2`,
      [account.parent_code, account.code],
    );
    linked += Number(updated.rowCount || 0);
  }

  try {
    await db.query(`
      UPDATE chart_of_accounts
      SET children_count = (
        SELECT COUNT(*) FROM chart_of_accounts child
        WHERE child.parent_id = chart_of_accounts.id
          AND (child.is_active = true OR child.is_active = 1)
      )
      WHERE code IN ('75', '752', '753', '7521', '7531', '7532')
    `);
  } catch (err) {
    console.warn('[SCHEMA] account 75 children_count:', err.message);
  }

  if (created > 0) {
    console.log(`[SCHEMA] Account 75 detail added — ${created} account(s)`);
  }
  return { created, linked };
}

module.exports = {
  isAccount75Detail,
  account75DetailRows,
  ensureAccount75Detail,
};
