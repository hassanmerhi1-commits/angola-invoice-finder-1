/**
 * Compare POS caixa session totals with ERP cash sales and GL account 45x movements.
 */
const db = require('../db');

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function salesDateFilterSql() {
  if (db.engine === 'postgres') {
    return `created_at::date = $2::date`;
  }
  return `date(created_at) = date($2)`;
}

function salesShiftFilterSql(paramIndex) {
  if (db.engine === 'postgres') {
    return ` AND created_at >= $${paramIndex}::timestamptz`;
  }
  return ` AND datetime(created_at) >= datetime($${paramIndex})`;
}

function journalShiftFilterSql(paramIndex) {
  if (db.engine === 'postgres') {
    return ` AND je.created_at >= $${paramIndex}::timestamptz`;
  }
  return ` AND datetime(je.created_at) >= datetime($${paramIndex})`;
}

function journalDateFilterSql() {
  if (db.engine === 'postgres') {
    return `je.entry_date = $3::date`;
  }
  return `date(je.entry_date) = date($3)`;
}

async function resolveBranchCaixaGlAccount(branchId) {
  const branchAccount = await db.query(
    `SELECT id, code, name, opening_balance, account_nature
     FROM chart_of_accounts
     WHERE branch_id = $1 AND is_active = true AND is_header = false
       AND code LIKE '45%'
     ORDER BY LENGTH(code) DESC, code
     LIMIT 1`,
    [branchId],
  );
  if (branchAccount.rows[0]) return branchAccount.rows[0];

  const fallback = await db.query(
    `SELECT id, code, name, opening_balance, account_nature
     FROM chart_of_accounts
     WHERE code = '451' AND is_active = true
     LIMIT 1`,
  );
  return fallback.rows[0] || {
    id: null,
    code: '451',
    name: 'Caixa',
    opening_balance: 0,
    account_nature: 'debit',
  };
}

async function sumErpCashSales(branchId, date, shiftOpenedAt) {
  const params = [branchId, date];
  let shiftClause = '';
  if (shiftOpenedAt) {
    params.push(String(shiftOpenedAt));
    shiftClause = salesShiftFilterSql(params.length);
  }
  const result = await db.query(
    `SELECT COALESCE(SUM(total), 0) AS total
     FROM sales
     WHERE branch_id = $1
       AND payment_method = 'cash'
       AND status IN ('completed', 'confirmed')
       AND ${salesDateFilterSql()}${shiftClause}`,
    params,
  );
  return roundMoney(result.rows[0]?.total);
}

function creditNoteDateFilterSql() {
  if (db.engine === 'postgres') {
    return `cn.issued_at::date = $2::date`;
  }
  return `date(cn.issued_at) = date($2)`;
}

function creditNoteShiftFilterSql(paramIndex) {
  if (db.engine === 'postgres') {
    return ` AND cn.issued_at >= $${paramIndex}::timestamptz`;
  }
  return ` AND datetime(cn.issued_at) >= datetime($${paramIndex})`;
}

async function sumErpCashRefunds(branchId, date, shiftOpenedAt) {
  const params = [branchId, date];
  let shiftClause = '';
  if (shiftOpenedAt) {
    params.push(String(shiftOpenedAt));
    shiftClause = creditNoteShiftFilterSql(params.length);
  }
  const result = await db.query(
    `SELECT COALESCE(SUM(cn.total), 0) AS total
     FROM credit_notes cn
     INNER JOIN sales s ON s.id = cn.original_invoice_id
     WHERE cn.branch_id = $1
       AND cn.status = 'issued'
       AND LOWER(COALESCE(s.payment_method, '')) = 'cash'
       AND ${creditNoteDateFilterSql()}${shiftClause}`,
    params,
  );
  return roundMoney(result.rows[0]?.total);
}

async function sumGlCashMovements(accountId, accountCode, branchId, date, shiftOpenedAt) {
  if (!accountId && !accountCode) {
    return { saleDebits: 0, refundCredits: 0, debits: 0, credits: 0, net: 0, netCashSales: 0 };
  }

  const accountClause = accountId
    ? 'jel.account_id = $1'
    : `coa.code = $1`;

  const params = accountId ? [accountId, branchId, date] : [accountCode, branchId, date];
  let shiftClause = '';
  if (shiftOpenedAt) {
    params.push(String(shiftOpenedAt));
    shiftClause = journalShiftFilterSql(params.length);
  }

  const movement = await db.query(
    `SELECT
       COALESCE(SUM(jel.debit_amount), 0) AS debits,
       COALESCE(SUM(jel.credit_amount), 0) AS credits,
       COALESCE(SUM(CASE WHEN je.reference_type = 'sale' THEN jel.debit_amount ELSE 0 END), 0) AS sale_debits,
       COALESCE(SUM(CASE WHEN je.reference_type = 'credit_note' THEN jel.credit_amount ELSE 0 END), 0) AS refund_credits
     FROM journal_entry_lines jel
     INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
     INNER JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE ${accountClause}
       AND je.branch_id = $2
       AND je.is_posted = true
       AND ${journalDateFilterSql()}${shiftClause}`,
    params,
  );

  const debits = roundMoney(movement.rows[0]?.debits);
  const credits = roundMoney(movement.rows[0]?.credits);
  const saleDebits = roundMoney(movement.rows[0]?.sale_debits);
  const refundCredits = roundMoney(movement.rows[0]?.refund_credits);
  return {
    saleDebits,
    refundCredits,
    debits,
    credits,
    net: roundMoney(debits - credits),
    netCashSales: roundMoney(saleDebits - refundCredits),
  };
}

/**
 * @param {{
 *   branchId: string,
 *   date: string,
 *   session?: { openingBalance?: number, totalIn?: number, totalOut?: number, salesTotal?: number, expensesTotal?: number, openedAt?: string },
 * }} input
 */
async function buildCaixaReconciliation(input) {
  const branchId = String(input.branchId || '').trim();
  const date = String(input.date || '').slice(0, 10);
  const shiftOpenedAt = input.session?.openedAt
    ? String(input.session.openedAt).trim()
    : input.shiftOpenedAt
      ? String(input.shiftOpenedAt).trim()
      : null;
  if (!branchId || !date) {
    throw new Error('branchId e date são obrigatórios');
  }

  const account = await resolveBranchCaixaGlAccount(branchId);
  const erpCashSalesTotal = await sumErpCashSales(branchId, date, shiftOpenedAt);
  const erpCashRefundsTotal = await sumErpCashRefunds(branchId, date, shiftOpenedAt);
  const erpNetCashTotal = roundMoney(erpCashSalesTotal - erpCashRefundsTotal);
  const gl = await sumGlCashMovements(account.id, account.code, branchId, date, shiftOpenedAt);

  const sessionOpening = roundMoney(input.session?.openingBalance ?? 0);
  const sessionCashIn = roundMoney(input.session?.totalIn ?? input.session?.salesTotal ?? 0);
  const sessionCashOut = roundMoney(input.session?.totalOut ?? 0);
  const sessionExpensesTotal = roundMoney(input.session?.expensesTotal ?? 0);
  const sessionExpectedCash = roundMoney(sessionOpening + sessionCashIn - sessionCashOut);
  const sessionNetCash = roundMoney(sessionCashIn - sessionCashOut);
  const erpDrawerNet = roundMoney(erpNetCashTotal - sessionExpensesTotal);

  const sessionCashVsErpSales = roundMoney(sessionCashIn - erpCashSalesTotal);
  const sessionNetVsErpNet = roundMoney(sessionNetCash - erpDrawerNet);
  const sessionCashVsGlDebits = roundMoney(sessionCashIn - gl.saleDebits);
  const erpSalesVsGlDebits = roundMoney(erpCashSalesTotal - gl.saleDebits);
  const erpRefundsVsGlCredits = roundMoney(erpCashRefundsTotal - gl.refundCredits);
  const erpNetVsGlNet = roundMoney(erpNetCashTotal - gl.netCashSales);

  return {
    branchId,
    date,
    shiftOpenedAt,
    caixaAccountCode: account.code,
    caixaAccountName: account.name,
    erpCashSalesTotal,
    erpCashRefundsTotal,
    erpNetCashTotal,
    erpDrawerNet,
    sessionExpensesTotal,
    glCashSaleDebits: gl.saleDebits,
    glCashRefundCredits: gl.refundCredits,
    glNetCashSales: gl.netCashSales,
    glDebits: gl.debits,
    glCredits: gl.credits,
    glNetMovement: gl.net,
    session: {
      openingBalance: sessionOpening,
      cashIn: sessionCashIn,
      cashOut: sessionCashOut,
      expensesTotal: sessionExpensesTotal,
      expectedCash: sessionExpectedCash,
      netCash: sessionNetCash,
    },
    variances: {
      sessionCashVsErpSales,
      sessionNetVsErpNet,
      sessionCashVsGlDebits,
      erpSalesVsGlDebits,
      erpRefundsVsGlCredits,
      erpNetVsGlNet,
    },
    balanced:
      Math.abs(sessionNetVsErpNet) < 0.01
      && Math.abs(erpNetVsGlNet) < 0.01
      && Math.abs(erpRefundsVsGlCredits) < 0.01,
  };
}

module.exports = {
  buildCaixaReconciliation,
  resolveBranchCaixaGlAccount,
};
