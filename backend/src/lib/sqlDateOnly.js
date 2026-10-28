/**
 * Calendar day for a Postgres DATE.
 * node-pg turns DATE into a Date at local midnight. JSON then prints the
 * previous UTC evening (Angola is ahead of UTC), and clients that slice the
 * first 10 characters treat today's caixa as yesterday.
 */
function sqlDateOnly(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  if (!raw) return '';
  const zoned = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i);
  if (zoned) {
    const hour = Number(zoned[2]);
    const min = Number(zoned[3]);
    const sec = Number(zoned[4]);
    // Local midnight serialized from a timezone east of UTC: 22:00Z or 23:00Z.
    if (min === 0 && sec === 0 && hour >= 12 && hour <= 23) {
      const y = Number(zoned[1].slice(0, 4));
      const m = Number(zoned[1].slice(5, 7));
      const d = Number(zoned[1].slice(8, 10));
      return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    }
  }
  const ymd = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return ymd ? ymd[1] : '';
}

module.exports = { sqlDateOnly };
