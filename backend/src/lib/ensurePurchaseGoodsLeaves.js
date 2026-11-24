/**
 * Add the goods-purchase leaves under 2121 and 2122 when the chart was
 * seeded before those lines existed. Does not deactivate other accounts
 * and does not rename an account that is already there.
 */
const crypto = require('crypto');
const { PGC_ACCOUNTS } = require('./pgcChartOfAccounts');

const PURCHASE_GOODS_CODES = new Set(['2121', '2122', '21210001', '21220001']);

function purchaseGoodsRows() {
  return PGC_ACCOUNTS
    .filter((account) => PURCHASE_GOODS_CODES.has(account.code))
    .slice()
    .sort((a, b) => a.code.length - b.code.length || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

async function ensurePurchaseGoodsLeaves(db) {
  if (!db || typeof db.query !== 'function') return { created: 0, linked: 0 };
  const rows = purchaseGoodsRows();
  let created = 0;

  for (const account of rows) {
    const existing = await db.query(
      'SELECT id FROM chart_of_accounts WHERE code = $1 LIMIT 1',
      [account.code],
    );
    if (existing.rows && existing.rows.length) {
      await db.query(
        `UPDATE chart_of_accounts
            SET is_header = $1, is_active = $2
          WHERE code = $3`,
        [!!account.is_header, true, account.code],
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
      WHERE code IN ('212', '2121', '2122')
    `);
  } catch (err) {
    console.warn('[SCHEMA] purchase goods children_count:', err.message);
  }

  if (created > 0) {
    console.log(`[SCHEMA] Purchase goods accounts added — ${created} account(s)`);
  }
  return { created, linked };
}

module.exports = {
  purchaseGoodsRows,
  ensurePurchaseGoodsLeaves,
};
