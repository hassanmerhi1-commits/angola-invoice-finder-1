/**
 * Accounting period helpers — seed missing months and enforce status transitions.
 */
const crypto = require('crypto');
const db = require('../db');

const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function periodDisplayName(year, month) {
  const m = Math.trunc(Number(month));
  const y = Math.trunc(Number(year));
  const label = MONTH_NAMES_PT[m - 1] || `Mês ${m}`;
  return `${label} ${y}`;
}

/** Ensure all 12 months exist for a fiscal year (idempotent). */
async function ensureYearPeriods(year) {
  const y = Math.trunc(Number(year));
  if (!Number.isFinite(y) || y < 2000 || y > 2100) {
    throw new Error('Ano inválido');
  }

  const existing = await db.query(
    'SELECT month FROM accounting_periods WHERE year = $1',
    [y],
  );
  const have = new Set(existing.rows.map((r) => Number(r.month)));

  for (let month = 1; month <= 12; month++) {
    if (have.has(month)) continue;
    const name = periodDisplayName(y, month);
    const id = crypto.randomUUID();
    if (db.engine === 'postgres') {
      await db.query(
        `INSERT INTO accounting_periods (id, year, month, name, status)
         VALUES ($1, $2, $3, $4, 'open')
         ON CONFLICT (year, month) DO NOTHING`,
        [id, y, month, name],
      );
    } else {
      await db.query(
        `INSERT OR IGNORE INTO accounting_periods (id, year, month, name, status)
         VALUES ($1, $2, $3, $4, 'open')`,
        [id, y, month, name],
      );
    }
  }
}

async function fetchPeriods({ year } = {}) {
  if (year != null && year !== '') {
    await ensureYearPeriods(year);
  }

  let sql = 'SELECT * FROM accounting_periods';
  const params = [];
  if (year != null && year !== '') {
    sql += ' WHERE year = $1';
    params.push(Math.trunc(Number(year)));
  }
  sql += ' ORDER BY year DESC, month DESC';

  const result = await db.query(sql, params);
  return result.rows;
}

async function getPeriodById(id) {
  const result = await db.query('SELECT * FROM accounting_periods WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

module.exports = {
  MONTH_NAMES_PT,
  periodDisplayName,
  ensureYearPeriods,
  fetchPeriods,
  getPeriodById,
};
