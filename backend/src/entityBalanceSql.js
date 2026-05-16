/** Open-items balance for suppliers/customers (works on SQLite and PostgreSQL). */
const ENTITY_BALANCE_SELECT = `
  SELECT
    entity_type,
    entity_id,
    COALESCE(SUM(CASE WHEN is_debit = 1 OR is_debit = TRUE THEN remaining_amount ELSE -remaining_amount END), 0) AS balance,
    COALESCE(SUM(CASE WHEN status != 'cleared' THEN 1 ELSE 0 END), 0) AS open_items_count
  FROM open_items
  WHERE entity_type = $1 AND entity_id = $2
  GROUP BY entity_type, entity_id
`;

module.exports = { ENTITY_BALANCE_SELECT };
