/**
 * Date bounds for a list query, in the Angola business day.
 *
 * A row's `created_at` is an absolute timestamp. Comparing it to a bare date
 * would use the database's own zone, so a sale made at 01:00 in Luanda (still
 * the previous evening in UTC) would fall on the wrong day. The bounds are the
 * Luanda midnights instead: inclusive of `from`, exclusive of the day after `to`.
 *
 * @param {{ engine: string }} db
 * @param {string} column SQL timestamp column, e.g. 'created_at'
 * @param {string[]} params query parameter list, appended to
 * @param {string} [dateFrom] 'YYYY-MM-DD'
 * @param {string} [dateTo] 'YYYY-MM-DD'
 * @returns {string} SQL fragment beginning with ' AND', or '' when no dates given
 */
function dateRangeSql(db, column, params, dateFrom, dateTo) {
  const from = String(dateFrom || '').trim().slice(0, 10);
  const to = String(dateTo || '').trim().slice(0, 10);
  const postgres = db.engine === 'postgres';
  let sql = '';

  if (from) {
    params.push(postgres ? from : `${from}T00:00:00`);
    sql += postgres
      ? ` AND ${column} >= ($${params.length}::date AT TIME ZONE 'Africa/Luanda')`
      : ` AND ${column} >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    sql += postgres
      ? ` AND ${column} < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Africa/Luanda')`
      : ` AND date(${column}) <= date($${params.length})`;
  }
  return sql;
}

module.exports = { dateRangeSql };
