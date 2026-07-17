/**
 * Record cash leaving the drawer when a credit note is issued against a cash POS sale.
 */
const db = require('../db');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isCashPaymentMethod(paymentMethod) {
  return String(paymentMethod || '').trim().toLowerCase() === 'cash';
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

  const sessionRes = await query(
    `SELECT id, caixa_id, total_out
     FROM caixa_sessions
     WHERE branch_id = $1 AND status = 'open'
     ORDER BY opened_at DESC NULLS LAST
     LIMIT 1`,
    [branchId],
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
    sessionRes = await query(
      `SELECT id, caixa_id, branch_id
       FROM caixa_sessions
       WHERE status = 'open' AND caixa_id::text = $1
       ORDER BY opened_at DESC NULLS LAST
       LIMIT 1`,
      [registerId],
    );
  }
  if ((!sessionRes || !sessionRes.rows.length) && branchKey) {
    sessionRes = await query(
      `SELECT id, caixa_id, branch_id
       FROM caixa_sessions
       WHERE status = 'open' AND branch_id::text = $1
       ORDER BY opened_at DESC NULLS LAST
       LIMIT 1`,
      [branchKey],
    );
  }
  if (!sessionRes?.rows?.length) {
    return { recorded: false, reason: 'no_open_session' };
  }

  const session = sessionRes.rows[0];
  // If session is for another register, still record outflows on the matching branch session
  // only when expense caixa matches or session has no caixa_id.
  const sessionCaixa = session.caixa_id != null ? String(session.caixa_id) : '';
  if (registerId && sessionCaixa && sessionCaixa !== registerId) {
    return { recorded: false, reason: 'open_session_other_caixa', sessionId: session.id };
  }

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
  };
}

module.exports = {
  isCashPaymentMethod,
  recordCashRefundOnOpenSession,
  recordExpenseOnOpenSession,
};
