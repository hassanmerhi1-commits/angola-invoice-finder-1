#!/usr/bin/env node
/**
 * Move supplier/customer payment journal lines off parent 321/311 onto the
 * correct 8-digit leaf account (create leaf if missing), and rebalance COA.
 *
 * Usage:
 *   node scripts/repair-entity-payment-coa.js
 *   node scripts/repair-entity-payment-coa.js PAG-2026-00655
 *   node scripts/repair-entity-payment-coa.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      `postgres://postgres:${process.env.POSTGRES_PASSWORD || 'yel3an7azi'}@127.0.0.1:5432/kwanza_erp`;
    process.env.DB_ENGINE = 'postgres';
  }

  const dryRun = process.argv.includes('--dry-run');
  const filter = process.argv.slice(2).find((a) => a !== '--dry-run') || '';

  const db = require('../src/db');
  const { resolveEntityAccountCode } = require('../src/lib/entityCoaAccounts');

  const rows = (
    await db.query(
      `SELECT
         jel.id AS line_id,
         jel.debit_amount,
         jel.credit_amount,
         jel.account_id AS old_account_id,
         coa.code AS old_code,
         je.entry_number,
         p.payment_number,
         p.entity_type,
         p.entity_id,
         COALESCE(NULLIF(TRIM(p.entity_name), ''), s.name, c.name) AS entity_name
       FROM journal_entry_lines jel
       INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
       INNER JOIN chart_of_accounts coa ON coa.id = jel.account_id
       INNER JOIN payments p ON p.id = je.reference_id
       LEFT JOIN suppliers s ON p.entity_type = 'supplier' AND s.id = p.entity_id
       LEFT JOIN clients c ON p.entity_type = 'customer' AND c.id = p.entity_id
       WHERE coa.code IN ('321', '311')
         AND je.reference_type IN ('payment', 'payment_out', 'payment_receipt', 'receipt')
         AND p.entity_type IN ('supplier', 'customer')
         AND p.entity_id IS NOT NULL
         ${filter ? 'AND p.payment_number = $1' : ''}
       ORDER BY je.entry_date, je.created_at`,
      filter ? [filter] : [],
    )
  ).rows;

  console.log(
    `[repair-entity-payment-coa] Found ${rows.length} line(s) on parent 321/311${dryRun ? ' (dry-run)' : ''}`,
  );

  let moved = 0;
  let skipped = 0;

  for (const row of rows) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const leafCode = await resolveEntityAccountCode(
        client,
        row.entity_type,
        row.entity_id,
        row.entity_name,
      );
      if (!leafCode || leafCode === row.old_code) {
        console.log(`  skip ${row.payment_number}: still on ${row.old_code}`);
        skipped += 1;
        await client.query('ROLLBACK');
        continue;
      }

      const leaf = await client.query(
        `SELECT id, code FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
        [leafCode],
      );
      if (!leaf.rows[0]) {
        console.log(`  skip ${row.payment_number}: leaf ${leafCode} missing`);
        skipped += 1;
        await client.query('ROLLBACK');
        continue;
      }

      const leafId = leaf.rows[0].id;
      const debit = Number(row.debit_amount) || 0;
      const credit = Number(row.credit_amount) || 0;
      const delta = debit - credit;

      if (dryRun) {
        console.log(
          `  would move ${row.payment_number} ${row.entry_number}: ${row.old_code} → ${leafCode} (D${debit}/C${credit})`,
        );
        await client.query('ROLLBACK');
        moved += 1;
        continue;
      }

      await client.query(`UPDATE journal_entry_lines SET account_id = $1 WHERE id = $2`, [
        leafId,
        row.line_id,
      ]);
      await client.query(
        `UPDATE chart_of_accounts
         SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [delta, row.old_account_id],
      );
      await client.query(
        `UPDATE chart_of_accounts
         SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [delta, leafId],
      );
      await client.query('COMMIT');
      console.log(`  moved ${row.payment_number} ${row.entry_number}: ${row.old_code} → ${leafCode}`);
      moved += 1;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      console.error(`  error ${row.payment_number}:`, e.message);
      skipped += 1;
    } finally {
      client.release();
    }
  }

  console.log(`[repair-entity-payment-coa] Done. moved=${moved} skipped=${skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
