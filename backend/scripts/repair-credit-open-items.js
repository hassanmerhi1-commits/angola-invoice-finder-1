/* eslint-disable no-console */
/**
 * Create missing open_items + fix clients.current_balance for credit sales
 * that have client_id but no receivable open item.
 *
 * Usage (Docker):
 *   docker compose exec backend node scripts/repair-credit-open-items.js
 *   docker compose exec backend node scripts/repair-credit-open-items.js --dry-run
 */
const crypto = require('crypto');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const db = require('../src/db');
  await db.initPromise;

  const missing = await db.query(`
    SELECT s.id, s.invoice_number, s.client_id, s.branch_id, s.total, s.created_at
    FROM sales s
    WHERE LOWER(COALESCE(s.payment_method, '')) = 'credit'
      AND s.client_id IS NOT NULL
      AND TRIM(CAST(s.client_id AS TEXT)) <> ''
      AND COALESCE(s.status, 'completed') <> 'voided'
      AND NOT EXISTS (
        SELECT 1 FROM open_items oi
        WHERE oi.document_id = s.id
           OR (oi.document_number IS NOT NULL AND oi.document_number = s.invoice_number)
      )
    ORDER BY s.created_at
  `);

  const rows = missing.rows || [];
  console.log(`[repair-credit-open-items] found ${rows.length} credit sale(s) without open item`);
  if (rows.length === 0) {
    process.exit(0);
    return;
  }

  let created = 0;
  for (const s of rows) {
    const amount = Number(s.total) || 0;
    if (amount <= 0) {
      console.warn(`  skip ${s.invoice_number || s.id}: invalid total`);
      continue;
    }
    const oiId = crypto.randomUUID();
    const docDate = String(s.created_at || new Date().toISOString()).slice(0, 10);
    const dueDate = docDate;
    console.log(
      `  ${dryRun ? 'DRY ' : ''}${s.invoice_number || s.id} → client ${s.client_id} +${amount}`,
    );
    if (dryRun) continue;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO open_items
         (id, entity_type, entity_id, document_type, document_id, document_number,
          document_date, due_date, currency, original_amount, remaining_amount, is_debit, branch_id)
         VALUES ($1, 'customer', $2, 'invoice', $3, $4, $5, $6, 'AOA', $7, $7, true, $8)`,
        [
          oiId,
          s.client_id,
          s.id,
          s.invoice_number || s.id,
          docDate,
          dueDate,
          amount,
          s.branch_id || null,
        ],
      );
      await client.query(
        `UPDATE clients
         SET current_balance = COALESCE(current_balance, 0) + $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [amount, s.client_id],
      );
      await client.query('COMMIT');
      created += 1;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  FAIL ${s.invoice_number || s.id}:`, e.message);
    } finally {
      client.release();
    }
  }

  console.log(`[repair-credit-open-items] ${dryRun ? 'would create' : 'created'} ${created} open item(s)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
