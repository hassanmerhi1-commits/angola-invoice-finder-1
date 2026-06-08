const db = require('./db');
const { openItemDebitAmountCase } = require('./lib/sqlDialect');

/** Open-items balance for suppliers/customers (SQLite + PostgreSQL). */
function getEntityBalanceSelect() {
  const amountCase = openItemDebitAmountCase(db);
  return `
  SELECT
    entity_type,
    entity_id,
    COALESCE(SUM(${amountCase}), 0) AS balance,
    COALESCE(SUM(CASE WHEN status != 'cleared' THEN 1 ELSE 0 END), 0) AS open_items_count
  FROM open_items
  WHERE entity_type = $1 AND entity_id = $2
    AND status != 'cleared'
  GROUP BY entity_type, entity_id
`;
}

/** @deprecated Use getEntityBalanceSelect() — static SQL breaks on PostgreSQL booleans. */
const ENTITY_BALANCE_SELECT = getEntityBalanceSelect();

module.exports = { ENTITY_BALANCE_SELECT, getEntityBalanceSelect };
