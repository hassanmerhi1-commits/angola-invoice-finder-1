/**
 * Recompute budgets.actual_amount from posted journal activity.
 * Cost-center filter uses cost_centers.branch_id ↔ journal_entries.branch_id when set.
 */
async function sumAccountActual(client, { accountCode, periodYear, periodMonth, branchId }) {
  const year = Number(periodYear);
  const month = Number(periodMonth);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 0;

  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  const end = endDate.toISOString().slice(0, 10);

  const params = [start, end];
  let branchSql = '';
  if (branchId) {
    params.push(String(branchId));
    branchSql = ` AND CAST(je.branch_id AS TEXT) = CAST($${params.length} AS TEXT)`;
  }

  const code = String(accountCode || '').trim();
  let accountSql = '';
  if (code && code !== '__total__') {
    params.push(code);
    accountSql = ` AND coa.code = $${params.length}`;
  } else {
    // Company/branch-wide spend proxy: expense-class accounts (6x)
    accountSql = ` AND coa.code LIKE '6%'`;
  }

  const r = await client.query(
    `SELECT COALESCE(SUM(
       CASE
         WHEN LOWER(COALESCE(coa.account_nature, 'debit')) = 'credit'
           THEN COALESCE(jel.credit_amount, 0) - COALESCE(jel.debit_amount, 0)
         ELSE COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)
       END
     ), 0) AS actual
     FROM journal_entry_lines jel
     INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
     INNER JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE COALESCE(je.is_posted, true) = true
       AND je.entry_date::date BETWEEN $1::date AND $2::date
       ${branchSql}
       ${accountSql}`,
    params,
  );
  return Math.max(0, Number(r.rows[0]?.actual || 0));
}

async function recomputeBudgetActuals(dbOrClient, opts = {}) {
  const client = dbOrClient;
  const params = [];
  const conditions = [];
  if (opts.year) {
    params.push(Number(opts.year));
    conditions.push(`b.period_year = $${params.length}`);
  }
  if (opts.month) {
    params.push(Number(opts.month));
    conditions.push(`b.period_month = $${params.length}`);
  }
  if (opts.costCenterId) {
    params.push(String(opts.costCenterId));
    conditions.push(`b.cost_center_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const budgets = await client.query(
    `SELECT b.id, b.cost_center_id, b.account_code, b.period_year, b.period_month, b.budget_amount,
            cc.branch_id AS cost_center_branch_id
     FROM budgets b
     LEFT JOIN cost_centers cc ON cc.id = b.cost_center_id
     ${where}`,
    params,
  );

  let updated = 0;
  for (const row of budgets.rows || []) {
    const actual = await sumAccountActual(client, {
      accountCode: row.account_code,
      periodYear: row.period_year,
      periodMonth: row.period_month,
      branchId: row.cost_center_branch_id || null,
    });
    const budgetAmt = Number(row.budget_amount || 0);
    let status = 'active';
    if (budgetAmt > 0 && actual > budgetAmt + 0.01) status = 'exceeded';
    await client.query(
      `UPDATE budgets
       SET actual_amount = $2,
           status = CASE WHEN status = 'closed' THEN status ELSE $3 END
       WHERE id = $1`,
      [row.id, actual, status],
    );
    updated += 1;
  }
  return { updated };
}

module.exports = {
  recomputeBudgetActuals,
  sumAccountActual,
};
