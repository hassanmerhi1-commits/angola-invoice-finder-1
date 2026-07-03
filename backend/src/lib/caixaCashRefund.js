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

module.exports = {
  isCashPaymentMethod,
  recordCashRefundOnOpenSession,
};
