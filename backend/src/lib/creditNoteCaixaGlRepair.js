/**
 * Re-point historical cash credit-note GL credits from global 451 → branch caixa (45x).
 * Works on PostgreSQL and SQLite (migration 050 is PostgreSQL-only).
 * Idempotent — guarded by app_meta flag (v2 re-runs after orphan account linking).
 */
const { resolveBranchCaixaGlAccountCode } = require('./resolveBranchCaixaGlAccount');

const REPAIR_FLAG = 'credit_note_caixa_gl_repair_v2';

async function ensureAppMetaTable(db) {
  try {
    if (db.engine === 'postgres') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key VARCHAR(64) PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else if (db.sqlite) {
      db.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }
  } catch (_) { /* table may exist */ }
}

async function repairAlreadyDone(db) {
  await ensureAppMetaTable(db);
  try {
    const row = await db.query('SELECT value FROM app_meta WHERE key = $1', [REPAIR_FLAG]);
    return !!(row.rows && row.rows.length);
  } catch (_) {
    return false;
  }
}

async function markRepairDone(db) {
  try {
    if (db.engine === 'postgres') {
      await db.query(
        `INSERT INTO app_meta (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [REPAIR_FLAG, '1'],
      );
    } else if (db.sqlite) {
      db.sqlite
        .prepare(
          `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        )
        .run(REPAIR_FLAG, '1');
    }
  } catch (err) {
    console.warn('[SCHEMA] credit note GL repair flag write:', err.message);
  }
}

/**
 * @param {typeof import('../db')} db
 * @returns {Promise<{ repaired: number }>}
 */
async function repairCreditNoteCaixaGlAccounts(db) {
  if (await repairAlreadyDone(db)) {
    return { repaired: 0, skipped: true };
  }

  let repaired = 0;

  try {
    const candidates = await db.query(
      `SELECT
         jel.id AS line_id,
         jel.credit_amount AS amount,
         old_acc.id AS old_account_id,
         je.branch_id AS branch_id,
         cn.original_invoice_id AS sale_id
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       JOIN chart_of_accounts old_acc ON old_acc.id = jel.account_id
       LEFT JOIN credit_notes cn ON cn.id = je.reference_id AND je.reference_type = 'credit_note'
       WHERE je.reference_type = 'credit_note'
         AND je.branch_id IS NOT NULL
         AND TRIM(COALESCE(je.branch_id, '')) != ''
         AND old_acc.code = '451'
         AND jel.credit_amount > 0`,
    );

    for (const row of candidates.rows || []) {
      const branchId = row.branch_id;
      const newCode = await resolveBranchCaixaGlAccountCode(db, {
        branchId,
        saleId: row.sale_id,
      });
      if (!newCode || newCode === '451') continue;

      const branchAccount = await db.query(
        `SELECT id, code FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
        [newCode],
      );
      const newAcc = branchAccount.rows[0];
      if (!newAcc || newAcc.id === row.old_account_id) continue;

      const amount = Number(row.amount) || 0;
      if (!(amount > 0)) continue;

      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          'UPDATE journal_entry_lines SET account_id = $1 WHERE id = $2',
          [newAcc.id, row.line_id],
        );

        await client.query(
          `UPDATE chart_of_accounts
           SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [amount, row.old_account_id],
        );

        await client.query(
          `UPDATE chart_of_accounts
           SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [amount, newAcc.id],
        );

        await client.query('COMMIT');
        repaired += 1;
        console.log(`[SCHEMA] NC GL fix: line ${row.line_id} moved 451 → ${newAcc.code} (${amount})`);
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.warn('[SCHEMA] NC GL fix row failed:', err.message);
      } finally {
        client.release();
      }
    }
  } catch (err) {
    console.warn('[SCHEMA] credit note caixa GL repair query failed:', err.message);
  }

  if (repaired > 0) {
    console.log(`[SCHEMA] Credit note caixa GL repair: ${repaired} line(s) corrected`);
  }

  await markRepairDone(db);
  return { repaired };
}

module.exports = {
  repairCreditNoteCaixaGlAccounts,
  REPAIR_FLAG,
};
