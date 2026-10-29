/**
 * A daily payment may only debit a real cost account.
 * Groups such as 752 are headers — posting there hides the amount on the income statement.
 */
function isHeaderFlag(value) {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true';
}

function isInactive(value) {
  return value === false || value === 0 || value === '0' || value === 'f' || value === 'false';
}

function expenseAccountRejection(row) {
  if (!row || isInactive(row.is_active)) return 'Chart account not found';
  if (isHeaderFlag(row.is_header)) {
    return 'That account is a group. Choose an 8-digit account under it.';
  }
  if (String(row.account_type || '') !== 'expense') return 'Choose a cost account';
  const code = String(row.code || '').trim();
  if (!/^\d{3,8}$/.test(code)) return 'Choose a cost account';
  return '';
}

module.exports = {
  expenseAccountRejection,
};
