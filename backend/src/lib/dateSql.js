/**
 * Normalize values for PostgreSQL DATE / TEXT date columns (YYYY-MM-DD).
 * node-pg may return Date objects; legacy rows may store non-ISO strings.
 */
function normalizeSqlDate(value, { allowNull = true } = {}) {
  if (value == null || value === '') {
    return allowNull ? null : new Date().toISOString().slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return allowNull ? null : new Date().toISOString().slice(0, 10);
}

module.exports = { normalizeSqlDate };
