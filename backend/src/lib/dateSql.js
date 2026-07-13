/**
 * Normalize values for PostgreSQL DATE / TEXT date columns (YYYY-MM-DD).
 * node-pg may return Date objects; legacy code often did String(date).slice(0,10)
 * which turns a Date into "Mon Jul 13" and breaks PostgreSQL.
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatYmd(year, monthIndex, day) {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function fromDateObject(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  // Use UTC components — node-pg DATE values arrive as UTC midnight.
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function normalizeSqlDate(value, { allowNull = true } = {}) {
  const fallback = () => (allowNull ? null : new Date().toISOString().slice(0, 10));

  if (value == null || value === '') return fallback();

  if (value instanceof Date) {
    return fromDateObject(value) || fallback();
  }

  const s = String(value).trim();
  if (!s) return fallback();

  // Already ISO date (or ISO datetime)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  // Truncated Date#toString() fragment: "Mon Jul 13" (missing year) — recover from full string if possible
  const truncatedWeekday = /^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}$/;
  if (truncatedWeekday.test(s)) {
    const withYear = `${s} ${new Date().getUTCFullYear()} 12:00:00 GMT`;
    const parsed = Date.parse(withYear);
    if (!Number.isNaN(parsed)) {
      return fromDateObject(new Date(parsed)) || fallback();
    }
  }

  // Full Date#toString() / locale strings
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    return fromDateObject(new Date(parsed)) || fallback();
  }

  return fallback();
}

module.exports = { normalizeSqlDate };
