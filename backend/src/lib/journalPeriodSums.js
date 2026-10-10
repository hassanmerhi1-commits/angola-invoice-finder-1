/**
 * Trial-balance / balance-sheet movement amounts.
 *
 * Date and posted flags live on journal_entries. If they are applied only on a
 * LEFT JOIN to `je`, `SUM(jel.debit_amount)` still includes every line. Gate
 * the SUM on `je.id` so unmatched (out of period / unposted) lines contribute 0.
 */
function journalFilteredSumSql() {
  const debits = `COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN COALESCE(jel.debit_amount, 0) ELSE 0 END), 0)`;
  const credits = `COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN COALESCE(jel.credit_amount, 0) ELSE 0 END), 0)`;
  return {
    totalDebitsExpr: debits,
    totalCreditsExpr: credits,
    totalDebits: `${debits} AS total_debits`,
    totalCredits: `${credits} AS total_credits`,
    closingBalance: `COALESCE(coa.opening_balance, 0) +
            CASE
              WHEN coa.account_nature = 'debit' THEN ${debits} - ${credits}
              ELSE ${credits} - ${debits}
            END AS closing_balance`,
    currentBalance: `COALESCE(coa.opening_balance, 0) +
            CASE
              WHEN coa.account_nature = 'debit' THEN ${debits} - ${credits}
              ELSE ${credits} - ${debits}
            END AS current_balance`,
  };
}

module.exports = {
  journalFilteredSumSql,
};
