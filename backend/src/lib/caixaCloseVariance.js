/**
 * End-of-day drawer count vs expected cash.
 * Short: debit 758 (outros custos operacionais), credit the drawer cash account.
 * Over:  debit the drawer cash account, credit 638 (outros proveitos operacionais).
 * The counted amount is what the cashier typed. No post when that number was not sent.
 */
const CASH_SHORT_ACCOUNT = '758';
const CASH_OVER_ACCOUNT = '638';

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj?.[key] != null && obj[key] !== '') return obj[key];
  }
  return null;
}

function cashCloseVariance(expected, counted) {
  const exp = Number(expected);
  const cnt = Number(counted);
  if (!Number.isFinite(exp) || !Number.isFinite(cnt)) return null;
  const diff = roundMoney(cnt - exp);
  if (Math.abs(diff) < 0.01) {
    return { kind: 'balanced', amount: 0 };
  }
  if (diff < 0) {
    return {
      kind: 'short',
      amount: roundMoney(Math.abs(diff)),
      direction: 'out',
      accountCode: CASH_SHORT_ACCOUNT,
      description: 'Quebra de caixa',
    };
  }
  return {
    kind: 'over',
    amount: diff,
    direction: 'in',
    accountCode: CASH_OVER_ACCOUNT,
    description: 'Sobra de caixa',
  };
}

async function postCaixaCloseVariance(session) {
  const expected = pick(session, 'expectedCash', 'expected_cash');
  if (expected == null) return { skipped: true, reason: 'no expected cash' };

  const variance = cashCloseVariance(
    expected,
    pick(session, 'closingBalance', 'closing_balance'),
  );
  if (!variance || variance.kind === 'balanced') {
    return { skipped: true, reason: 'balanced' };
  }

  const branchId = pick(session, 'branchId', 'branch_id');
  const sessionId = pick(session, 'id');
  if (!branchId || !sessionId) return { skipped: true, reason: 'missing branch or session' };
  const db = require('../db');
  if (!db.pool) return { skipped: true, reason: 'no ledger' };
  const { postCaixaGlMovement } = require('./caixaGlPosting');

  const posted = await postCaixaGlMovement({
    branchId: String(branchId),
    caixaId: pick(session, 'caixaId', 'caixa_id'),
    amount: variance.amount,
    direction: variance.direction,
    counterAccountCode: variance.accountCode,
    description: variance.description,
    referenceType: 'caixa_close',
    referenceId: String(sessionId),
    createdByName: pick(session, 'closedBy', 'closed_by') || '',
    entryDate: pick(session, 'date', 'closedAt', 'closed_at') || undefined,
  });

  return { skipped: false, ...variance, ...posted };
}

module.exports = {
  CASH_SHORT_ACCOUNT,
  CASH_OVER_ACCOUNT,
  cashCloseVariance,
  postCaixaCloseVariance,
};
