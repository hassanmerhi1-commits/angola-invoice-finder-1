/**
 * Trial-balance / balance-sheet movement amounts.
 *
 * Date and posted flags live on journal_entries. If they are applied only on a
 * LEFT JOIN to `je`, `SUM(jel.debit_amount)` still includes every line. Gate
 * the SUM on `je.id` so unmatched (out of period / unposted) lines contribute 0.
 *
 * Period movement (total_debits / total_credits) uses `periodAlias` (default `je`).
 * Closing / current balance uses `closeAlias` so a second join can include all
 * posted journals through the period end without mixing them into period columns.
 */
function movementSumExprs(alias) {
  const a = String(alias || 'je').replace(/[^a-zA-Z0-9_]/g, '') || 'je';
  const debits = `COALESCE(SUM(CASE WHEN ${a}.id IS NOT NULL THEN COALESCE(jel.debit_amount, 0) ELSE 0 END), 0)`;
  const credits = `COALESCE(SUM(CASE WHEN ${a}.id IS NOT NULL THEN COALESCE(jel.credit_amount, 0) ELSE 0 END), 0)`;
  return { debits, credits };
}

function natureClosingSql(debits, credits) {
  return `COALESCE(coa.opening_balance, 0) +
            CASE
              WHEN coa.account_nature = 'debit' THEN ${debits} - ${credits}
              ELSE ${credits} - ${debits}
            END`;
}

function journalFilteredSumSql(opts = {}) {
  const periodAlias = opts.periodAlias || 'je';
  const closeAlias = opts.closeAlias || periodAlias;
  const period = movementSumExprs(periodAlias);
  const close = movementSumExprs(closeAlias);
  return {
    totalDebitsExpr: period.debits,
    totalCreditsExpr: period.credits,
    totalDebits: `${period.debits} AS total_debits`,
    totalCredits: `${period.credits} AS total_credits`,
    closingBalance: `${natureClosingSql(close.debits, close.credits)} AS closing_balance`,
    currentBalance: `${natureClosingSql(close.debits, close.credits)} AS current_balance`,
  };
}

/** Posted journals on or before the period end — used for TB closing. */
function journalThroughEndJoinSql({ alias = 'je_close', endDateParam, extraAnd = '' }) {
  const a = String(alias || 'je_close').replace(/[^a-zA-Z0-9_]/g, '') || 'je_close';
  return `LEFT JOIN journal_entries ${a} ON ${a}.id = jel.journal_entry_id AND ${a}.is_posted = true AND ${a}.entry_date <= ${endDateParam}${extraAnd}`;
}

module.exports = {
  journalFilteredSumSql,
  journalThroughEndJoinSql,
};
