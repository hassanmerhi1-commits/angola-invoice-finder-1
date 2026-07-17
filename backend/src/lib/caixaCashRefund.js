/**
 * Record cash leaving the drawer when a credit note is issued against a cash POS sale.
 */
const db = require('../db');
const { resolveBranchFilterId, normalizeBranchIdKey } = require('./branchIdMatch');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isCashPaymentMethod(paymentMethod) {
  return String(paymentMethod || '').trim().toLowerCase() === 'cash';
}

function branchText(column) {
  return db.engine === 'postgres' ? `${column}::text` : `CAST(${column} AS TEXT)`;
}

function openSessionOrderBy() {
  return db.engine === 'postgres' ? 'opened_at DESC NULLS LAST' : 'opened_at DESC';
}

function openSessionBranchClause(startIdx = 1) {
  const col = branchText('branch_id');
  const p1 = `$${startIdx}`;
  const p2 = `$${startIdx + 1}`;
  return {
    sql: `(${col} = ${p1} OR REPLACE(LOWER(TRIM(COALESCE(${col}, ''))), '-', '') = ${p2})`,
    paramsCount: 2,
  };
}

/**
 * @param {import('pg').PoolClient|null} client - When inside a transaction, pass the client.
 */
async function recordCashRefundOnOpenSession(
  client,
  {
    branchId,
    amount,
    creditNoteId,
    documentNumber,
    originalInvoiceNumber,
  },
) {
  const refundAmount = roundMoney(amount);
  if (!branchId || refundAmount <= 0) {
    return { recorded: false, reason: 'invalid_input' };
  }

  const query = client ? client.query.bind(client) : db.query.bind(db);

  const resolvedBranchId = (await resolveBranchFilterId(db, branchId)) || branchId;
  const branchKey = normalizeBranchIdKey(resolvedBranchId) || normalizeBranchIdKey(branchId);
  const branchClause = openSessionBranchClause(1);
  const sessionRes = await query(
    `SELECT id, caixa_id, total_out
     FROM caixa_sessions
     WHERE status = 'open'
       AND ${branchClause.sql}
     ORDER BY ${openSessionOrderBy()}
     LIMIT 1`,
    [resolvedBranchId, branchKey],
  );
  if (!sessionRes.rows.length) {
    return { recorded: false, reason: 'no_open_session' };
  }

  const session = sessionRes.rows[0];
  const sessionId = session.id;
  const caixaId = session.caixa_id;

  await query(
    `UPDATE caixa_sessions
     SET total_out = COALESCE(total_out, 0) + $1
     WHERE id = $2`,
    [refundAmount, sessionId],
  );

  if (caixaId) {
    await query(
      `UPDATE caixas
       SET current_balance = COALESCE(current_balance, 0) - $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [refundAmount, caixaId],
    );
  }

  return {
    recorded: true,
    sessionId,
    caixaId,
    amount: refundAmount,
    creditNoteId,
    documentNumber,
    originalInvoiceNumber,
  };
}

/**
 * Record cash leaving the open drawer when an expense is paid from a caixa.
 * Updates session total_out + expenses_total (EOD / POS open register).
 * Does NOT change caixas.current_balance — caller applies that separately.
 *
 * Matches credit notes: prefer the open session for this caixa, else any open
 * session on the same branch (users often open "Caixa Principal" but pay from
 * the COA-synced "Caixa - SOYO XX" register).
 */
async function recordExpenseOnOpenSession(
  client,
  {
    caixaId,
    branchId,
    amount,
    expenseId,
  },
) {
  const expenseAmount = roundMoney(amount);
  const registerId = String(caixaId || '').trim();
  const branchKey = String(branchId || '').trim();
  if ((!registerId && !branchKey) || expenseAmount <= 0) {
    return { recorded: false, reason: 'invalid_input' };
  }

  const query = client ? client.query.bind(client) : db.query.bind(db);

  let sessionRes;
  if (registerId) {
    const caixaCol = branchText('caixa_id');
    sessionRes = await query(
      `SELECT id, caixa_id, branch_id
       FROM caixa_sessions
       WHERE status = 'open' AND ${caixaCol} = $1
       ORDER BY ${openSessionOrderBy()}
       LIMIT 1`,
      [registerId],
    );
  }
  if ((!sessionRes || !sessionRes.rows.length) && branchKey) {
    const resolvedBranchId = (await resolveBranchFilterId(db, branchKey)) || branchKey;
    const branchNorm = normalizeBranchIdKey(resolvedBranchId) || normalizeBranchIdKey(branchKey);
    const branchClause = openSessionBranchClause(1);
    sessionRes = await query(
      `SELECT id, caixa_id, branch_id
       FROM caixa_sessions
       WHERE status = 'open'
         AND ${branchClause.sql}
       ORDER BY ${openSessionOrderBy()}
       LIMIT 1`,
      [resolvedBranchId, branchNorm],
    );
  }
  if (!sessionRes?.rows?.length) {
    return { recorded: false, reason: 'no_open_session' };
  }

  const session = sessionRes.rows[0];

  await query(
    `UPDATE caixa_sessions
     SET total_out = COALESCE(total_out, 0) + $1,
         expenses_total = COALESCE(expenses_total, 0) + $1
     WHERE id = $2`,
    [expenseAmount, session.id],
  );

  return {
    recorded: true,
    sessionId: session.id,
    caixaId: session.caixa_id || registerId || null,
    amount: expenseAmount,
    expenseId,
    matchedBy: registerId && String(session.caixa_id || '') === registerId ? 'caixa' : 'branch',
  };
}

/**
 * Idempotent: set open-session expenses_total from paid caixa expenses since opened_at.
 * Safe to call after every pay (avoids double-count on GL-already-posted retries).
 */
async function syncOpenSessionExpensesFromLedger(client, branchId) {
  const query = client ? client.query.bind(client) : db.query.bind(db);
  const rawBranch = String(branchId || '').trim();
  if (!rawBranch) return { synced: false, reason: 'no_branch' };

  const resolvedBranchId = (await resolveBranchFilterId(db, rawBranch)) || rawBranch;
  const branchNorm = normalizeBranchIdKey(resolvedBranchId) || normalizeBranchIdKey(rawBranch);
  const branchClause = openSessionBranchClause(1);
  const sessionRes = await query(
    `SELECT * FROM caixa_sessions
     WHERE status = 'open' AND ${branchClause.sql}
     ORDER BY ${openSessionOrderBy()}
     LIMIT 1`,
    [resolvedBranchId, branchNorm],
  );
  if (!sessionRes.rows.length) return { synced: false, reason: 'no_open_session' };

  const sessionRow = sessionRes.rows[0];
  const openedAt =
    sessionRow.opened_at instanceof Date
      ? sessionRow.opened_at.toISOString()
      : String(sessionRow.opened_at || '');
  if (!openedAt) return { synced: false, reason: 'no_opened_at', sessionId: sessionRow.id };

  const branchCol = branchText('branch_id');
  const paidAtCol = db.engine === 'postgres' ? 'paid_at::text' : 'CAST(paid_at AS TEXT)';
  const sumRes = await query(
    `SELECT COALESCE(SUM(total_amount), 0) AS total
     FROM expenses
     WHERE status = 'paid'
       AND LOWER(TRIM(COALESCE(payment_source, 'caixa'))) = 'caixa'
       AND (${branchCol} = $1 OR REPLACE(LOWER(TRIM(COALESCE(${branchCol}, ''))), '-', '') = $2)
       AND paid_at IS NOT NULL
       AND ${paidAtCol} >= $3`,
    [resolvedBranchId, branchNorm, openedAt],
  );
  const expenseSum = roundMoney(sumRes.rows[0]?.total);
  const current = roundMoney(sessionRow.expenses_total);
  if (expenseSum <= current) {
    return { synced: true, sessionId: sessionRow.id, expensesTotal: current, changed: false };
  }

  const delta = roundMoney(expenseSum - current);
  await query(
    `UPDATE caixa_sessions
     SET expenses_total = $1,
         total_out = COALESCE(total_out, 0) + $2
     WHERE id = $3 AND status = 'open'`,
    [expenseSum, delta, sessionRow.id],
  );
  return {
    synced: true,
    sessionId: sessionRow.id,
    expensesTotal: expenseSum,
    changed: true,
    delta,
  };
}

module.exports = {
  isCashPaymentMethod,
  recordCashRefundOnOpenSession,
  recordExpenseOnOpenSession,
  syncOpenSessionExpensesFromLedger,
};
