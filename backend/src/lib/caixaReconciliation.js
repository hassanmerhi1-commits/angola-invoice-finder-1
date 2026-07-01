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

async function sumErpCashSales(branchId, date) {
  const result = await db.query(
    `SELECT COALESCE(SUM(total), 0) AS total
     FROM sales
     WHERE branch_id = $1
       AND payment_method = 'cash'
       AND status IN ('completed', 'confirmed')
       AND ${salesDateFilterSql()}`,
    [branchId, date],
  );
  return roundMoney(result.rows[0]?.total);
}

async function sumGlCashMovements(accountId, accountCode, branchId, date) {
  if (!accountId && !accountCode) {
    return { saleDebits: 0, debits: 0, credits: 0, net: 0 };
  }

  const accountClause = accountId
    ? 'jel.account_id = $1'
    : `coa.code = $1`;

  const params = accountId ? [accountId, branchId, date] : [accountCode, branchId, date];

  const movement = await db.query(
    `SELECT
       COALESCE(SUM(jel.debit_amount), 0) AS debits,
       COALESCE(SUM(jel.credit_amount), 0) AS credits,
       COALESCE(SUM(CASE WHEN je.reference_type = 'sale' THEN jel.debit_amount ELSE 0 END), 0) AS sale_debits
     FROM journal_entry_lines jel
     INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
     INNER JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE ${accountClause}
       AND je.branch_id = $2
       AND je.is_posted = true
       AND ${journalDateFilterSql()}`,
    params,
  );

  const debits = roundMoney(movement.rows[0]?.debits);
  const credits = roundMoney(movement.rows[0]?.credits);
  const saleDebits = roundMoney(movement.rows[0]?.sale_debits);
  return {
    saleDebits,
    debits,
    credits,
    net: roundMoney(debits - credits),
  };
}

/**
 * @param {{
 *   branchId: string,
 *   date: string,
 *   session?: { openingBalance?: number, totalIn?: number, totalOut?: number, salesTotal?: number },
 * }} input
 */
async function buildCaixaReconciliation(input) {
  const branchId = String(input.branchId || '').trim();
  const date = String(input.date || '').slice(0, 10);
  if (!branchId || !date) {
    throw new Error('branchId e date são obrigatórios');
  }

  const account = await resolveBranchCaixaGlAccount(branchId);
  const erpCashSalesTotal = await sumErpCashSales(branchId, date);
  const gl = await sumGlCashMovements(account.id, account.code, branchId, date);

  const sessionOpening = roundMoney(input.session?.openingBalance ?? 0);
  const sessionCashIn = roundMoney(input.session?.totalIn ?? input.session?.salesTotal ?? 0);
  const sessionCashOut = roundMoney(input.session?.totalOut ?? 0);
  const sessionExpectedCash = roundMoney(sessionOpening + sessionCashIn - sessionCashOut);

  const sessionCashVsErpSales = roundMoney(sessionCashIn - erpCashSalesTotal);
  const sessionCashVsGlDebits = roundMoney(sessionCashIn - gl.saleDebits);
  const erpSalesVsGlDebits = roundMoney(erpCashSalesTotal - gl.saleDebits);

  return {
    branchId,
    date,
    caixaAccountCode: account.code,
    caixaAccountName: account.name,
    erpCashSalesTotal,
    glCashSaleDebits: gl.saleDebits,
    glDebits: gl.debits,
    glCredits: gl.credits,
    glNetMovement: gl.net,
    session: {
      openingBalance: sessionOpening,
      cashIn: sessionCashIn,
      cashOut: sessionCashOut,
      expectedCash: sessionExpectedCash,
    },
    variances: {
      sessionCashVsErpSales,
      sessionCashVsGlDebits,
      erpSalesVsGlDebits,
    },
    balanced:
      Math.abs(sessionCashVsErpSales) < 0.01
      && Math.abs(sessionCashVsGlDebits) < 0.01
      && Math.abs(erpSalesVsGlDebits) < 0.01,
  };
}

module.exports = {
  buildCaixaReconciliation,
  resolveBranchCaixaGlAccount,
};
