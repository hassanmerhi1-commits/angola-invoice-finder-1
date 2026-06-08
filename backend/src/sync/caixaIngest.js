/**
 * Phase B3+ — shop client caixa.close → city server mirror.
 */
const db = require('../db');

function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] != null && obj[k] !== '') return obj[k];
  }
  return null;
}

async function caixaTablesExist() {
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = 'caixa_sessions' LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'caixa_sessions' LIMIT 1`
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function applyCaixaClose(payload) {
  if (!(await caixaTablesExist())) {
    return { skipped: true, reason: 'caixa tables not migrated' };
  }

  const session = payload?.sessionData || payload?.session || payload;
  const caixa = payload?.caixaData || payload?.caixa || null;
  const sessionId = pick(session, 'id');
  if (!sessionId) return { skipped: true, reason: 'no session id' };

  const dup = await db.query(`SELECT id FROM caixa_sessions WHERE id = $1 LIMIT 1`, [sessionId]);
  if (dup.rows.length > 0 && dup.rows[0]) {
    const existing = await db.query(`SELECT status FROM caixa_sessions WHERE id = $1`, [sessionId]);
    if (existing.rows[0]?.status === 'closed') {
      return { skipped: true, reason: 'duplicate', id: sessionId };
    }
  }

  const caixaId = pick(session, 'caixaId', 'caixa_id');
  const branchId = pick(session, 'branchId', 'branch_id') || pick(caixa, 'branchId', 'branch_id');

  if (caixa && caixaId) {
    await db.query(
      `INSERT INTO caixas (
        id, branch_id, branch_name, name, opening_balance, current_balance, closing_balance,
        status, petty_limit, daily_limit, requires_approval,
        opened_by, closed_by, opened_at, closed_at, notes, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        current_balance = excluded.current_balance,
        closing_balance = excluded.closing_balance,
        status = excluded.status,
        closed_by = excluded.closed_by,
        closed_at = excluded.closed_at,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP`,
      [
        caixaId,
        branchId,
        pick(caixa, 'branchName', 'branch_name') || '',
        pick(caixa, 'name') || 'Caixa',
        Number(pick(caixa, 'openingBalance', 'opening_balance') ?? 0),
        Number(pick(session, 'closingBalance', 'closing_balance') ?? pick(caixa, 'currentBalance', 'current_balance') ?? 0),
        Number(pick(session, 'closingBalance', 'closing_balance') ?? 0),
        'closed',
        Number(pick(caixa, 'pettyLimit', 'petty_limit') ?? 0),
        Number(pick(caixa, 'dailyLimit', 'daily_limit') ?? 0),
        !!(pick(caixa, 'requiresApproval', 'requires_approval')),
        pick(caixa, 'openedBy', 'opened_by') || pick(session, 'openedBy', 'opened_by') || '',
        pick(session, 'closedBy', 'closed_by') || '',
        pick(caixa, 'openedAt', 'opened_at') || pick(session, 'openedAt', 'opened_at'),
        pick(session, 'closedAt', 'closed_at') || new Date().toISOString(),
        pick(session, 'notes') || pick(caixa, 'closingNotes', 'notes') || '',
      ]
    );
  }

  await db.query(
    `INSERT INTO caixa_sessions (
      id, caixa_id, branch_id, date, opening_balance, closing_balance,
      total_in, total_out, sales_total, expenses_total, adjustments,
      status, opened_by, closed_by, opened_at, closed_at, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    ON CONFLICT (id) DO UPDATE SET
      closing_balance = excluded.closing_balance,
      total_in = excluded.total_in,
      total_out = excluded.total_out,
      sales_total = excluded.sales_total,
      expenses_total = excluded.expenses_total,
      adjustments = excluded.adjustments,
      status = excluded.status,
      closed_by = excluded.closed_by,
      closed_at = excluded.closed_at,
      notes = excluded.notes`,
    [
      sessionId,
      caixaId,
      branchId,
      pick(session, 'date') || new Date().toISOString().slice(0, 10),
      Number(pick(session, 'openingBalance', 'opening_balance') ?? 0),
      Number(pick(session, 'closingBalance', 'closing_balance') ?? 0),
      Number(pick(session, 'totalIn', 'total_in') ?? 0),
      Number(pick(session, 'totalOut', 'total_out') ?? 0),
      Number(pick(session, 'salesTotal', 'sales_total') ?? 0),
      Number(pick(session, 'expensesTotal', 'expenses_total') ?? 0),
      Number(pick(session, 'adjustments') ?? 0),
      'closed',
      pick(session, 'openedBy', 'opened_by') || '',
      pick(session, 'closedBy', 'closed_by') || '',
      pick(session, 'openedAt', 'opened_at'),
      pick(session, 'closedAt', 'closed_at') || new Date().toISOString(),
      pick(session, 'notes') || '',
    ]
  );

  return { ok: true, sessionId, caixaId, branchId };
}

module.exports = { applyCaixaClose };
