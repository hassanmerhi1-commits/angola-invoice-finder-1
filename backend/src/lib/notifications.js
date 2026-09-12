const db = require('../db');
const crypto = require('crypto');
const { selectExpenseApprovers } = require('./expenseApprovers');

/** Postgres gets the table from migration 062; SQLite (tests, Electron local) needs it here. */
async function ensureNotificationsTable() {
  if (db.engine === 'postgres') return;
  try {
    db.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        branch_id TEXT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        link TEXT,
        is_read INTEGER NOT NULL DEFAULT 0,
        dedupe_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    `);
  } catch (_) {}
}

/**
 * Insert a notification. When dedupeKey is set, duplicate inserts are ignored.
 */
async function createNotification({
  type,
  title,
  message,
  severity = 'info',
  link = null,
  userId = null,
  branchId = null,
  dedupeKey = null,
}) {
  const id = crypto.randomUUID();
  try {
    await ensureNotificationsTable();
    if (dedupeKey) {
      const existing = await db.query(
        'SELECT id FROM notifications WHERE dedupe_key = $1 LIMIT 1',
        [dedupeKey],
      );
      if (existing.rows[0]) return existing.rows[0];
    }
    const r = await db.query(
      `INSERT INTO notifications (
         id, user_id, branch_id, type, title, message, severity, link, dedupe_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [id, userId, branchId, type, title, message, severity, link, dedupeKey],
    );
    return r.rows[0];
  } catch (err) {
    // Unique violation on dedupe
    if (err.code === '23505') return null;
    throw err;
  }
}

/**
 * Low stock belongs to the daily checklist, which reads the products directly.
 * As notifications they were unreadable noise: the dedupe key carried the date, so
 * dismissing them only bought a day of silence. Drop the ones already stored.
 */
async function purgeRetiredNotifications() {
  try {
    await ensureNotificationsTable();
    await db.query("DELETE FROM notifications WHERE type = 'low_stock'");
  } catch (err) {
    console.warn('[NOTIFICATIONS] purge:', err.message);
  }
}

async function notifyAgtFailure({ entityType, entityId, message }) {
  const day = new Date().toISOString().slice(0, 10);
  return createNotification({
    type: 'agt_failure',
    title: 'AGT transmission failed',
    message: message || `${entityType || 'document'} ${entityId || ''}`.trim(),
    severity: 'critical',
    link: '/settings',
    dedupeKey: `agt_fail:${entityType || 'x'}:${entityId || 'x'}:${day}`,
  });
}

/** Overdue customer receivables (open_items). */
async function scanOverdueReceivables() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await db.query(
      `SELECT entity_id, document_number, remaining_amount, due_date
       FROM open_items
       WHERE entity_type = 'customer'
         AND status != 'cleared'
         AND due_date IS NOT NULL
         AND CAST(due_date AS TEXT) < $1
         AND COALESCE(remaining_amount, 0) > 0
       ORDER BY due_date ASC
       LIMIT 40`,
      [today],
    ).catch(() => ({ rows: [] }));
    let created = 0;
    const day = today;
    for (const row of r.rows || []) {
      const due = Number(row.remaining_amount || 0);
      const n = await createNotification({
        type: 'overdue_ar',
        title: 'Overdue receivable',
        message: `${row.document_number || row.entity_id}: ${due.toFixed(2)} overdue (due ${String(row.due_date).slice(0, 10)})`,
        severity: 'warning',
        link: '/receivables',
        dedupeKey: `overdue_ar:${row.entity_id}:${row.document_number || row.entity_id}:${day}`,
      });
      if (n && n.id) created += 1;
    }
    return created;
  } catch (err) {
    console.warn('[NOTIFICATIONS] overdue AR scan:', err.message);
    return 0;
  }
}

/** Remind when current month period is still open near month end / after. */
async function scanPeriodCloseReminders() {
  try {
    const now = new Date();
    const day = now.getDate();
    // From day 25 onward, nudge open periods for current month.
    if (day < 25) return 0;
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const periodKey = `${y}-${m}`;
    const r = await db.query(
      `SELECT id, name, status, start_date, end_date
       FROM accounting_periods
       WHERE status = 'open'
         AND (
           (start_date IS NOT NULL AND CAST(start_date AS TEXT) LIKE $1)
           OR (name IS NOT NULL AND name LIKE $2)
         )
       LIMIT 10`,
      [`${periodKey}%`, `%${periodKey}%`],
    ).catch(() => ({ rows: [] }));
    let created = 0;
    const today = now.toISOString().slice(0, 10);
    for (const p of r.rows || []) {
      const n = await createNotification({
        type: 'period_close',
        title: 'Period close reminder',
        message: `Accounting period still open: ${p.name || p.id}`,
        severity: 'info',
        link: '/accounting-periods',
        dedupeKey: `period_close:${p.id}:${today}`,
      });
      if (n && n.id) created += 1;
    }
    return created;
  } catch (err) {
    console.warn('[NOTIFICATIONS] period close scan:', err.message);
    return 0;
  }
}

/** The id keeps the request visible even when the approver's branch scope would hide it. */
function expensePendingLink(expenseId) {
  return `/expenses?expenseId=${encodeURIComponent(expenseId)}`;
}

function expenseDecisionLink(expenseId) {
  return `/expenses?expenseId=${encodeURIComponent(expenseId)}`;
}
const DECIDED_EXPENSE_STATUSES = new Set(['approved', 'rejected', 'paid']);

function formatAoa(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('pt-AO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AOA`;
}

async function listUsersForNotifications() {
  const columns = [
    'SELECT id, name, role, branch_id, is_active, permissions FROM users',
    'SELECT id, name, role, branch_id, is_active FROM users',
  ];
  for (const sql of columns) {
    try {
      const r = await db.query(sql);
      return r.rows || [];
    } catch (_) { /* older schema: try a narrower projection */ }
  }
  return [];
}

/**
 * `expenses.created_by` holds whatever the client stamped — a display name from the
 * Expenses page and POS, an id elsewhere — so the requester is matched on either.
 */
function findUserIdByRef(users, ref) {
  const value = String(ref || '').trim();
  if (!value) return null;
  const match = users.find((u) => String(u.id) === value)
    || users.find((u) => String(u.name || '').trim() === value);
  return match ? String(match.id) : null;
}

async function resolveUserIdByRef(ref) {
  return findUserIdByRef(await listUsersForNotifications(), ref);
}

async function resolveExpenseApprovers(branchId) {
  return selectExpenseApprovers(await listUsersForNotifications(), branchId);
}

async function notifyExpensePendingApproval(expense) {
  const users = await listUsersForNotifications();
  const approvers = selectExpenseApprovers(users, expense.branchId);
  if (!approvers.length) return 0;
  const requesterId = findUserIdByRef(users, expense.requestedBy);
  const requester = String(expense.requestedBy || '').trim();
  const detail = expense.description || expense.expenseNumber || 'despesa';
  let created = 0;
  for (const approver of approvers) {
    if (requesterId && String(approver.id) === requesterId) continue;
    const row = await createNotification({
      type: 'approval_pending',
      title: 'Despesa aguarda aprovação',
      message: `${requester || 'Operador'} pediu ${formatAoa(expense.totalAmount)} — ${detail}`,
      severity: 'warning',
      link: expensePendingLink(expense.id),
      userId: String(approver.id),
      branchId: expense.branchId || null,
      dedupeKey: `expense_approval:${expense.id}:${approver.id}`,
    });
    if (row && row.id) created += 1;
  }
  return created;
}

/** Once someone decides, the request must stop counting as unread for the other approvers. */
async function clearExpenseApprovalAlerts(expenseId) {
  await db.query(
    'UPDATE notifications SET is_read = true WHERE dedupe_key LIKE $1',
    [`expense_approval:${expenseId}:%`],
  ).catch(() => undefined);
}

async function notifyExpenseDecision(expense, decision, actorName) {
  const requesterId = await resolveUserIdByRef(expense.requestedBy);
  if (!requesterId) return 0;
  const approved = decision !== 'rejected';
  const by = String(actorName || '').trim();
  const detail = expense.description || expense.expenseNumber || 'despesa';
  const row = await createNotification({
    type: 'approval_result',
    title: approved ? 'Despesa aprovada' : 'Despesa recusada',
    message: `${formatAoa(expense.totalAmount)} — ${detail}${by ? ` (${by})` : ''}`,
    severity: approved ? 'info' : 'warning',
    link: expenseDecisionLink(expense.id),
    userId: requesterId,
    branchId: expense.branchId || null,
    dedupeKey: `expense_decision:${expense.id}:${approved ? 'approved' : 'rejected'}`,
  });
  return row && row.id ? 1 : 0;
}

/**
 * Drive the approval inbox off the expense status transition: a new pending_approval
 * alerts the branch approvers, and any decision closes those alerts and tells the
 * cashier what happened. Returns how many clients should refresh.
 */
async function notifyExpenseApprovalChange(expense, priorStatus, actor) {
  try {
    if (!expense || !expense.id) return 0;
    const before = String(priorStatus || '').toLowerCase();
    const after = String(expense.status || '').toLowerCase();
    if (before === after) return 0;
    if (after === 'pending_approval') return await notifyExpensePendingApproval(expense);
    if (before === 'pending_approval' && DECIDED_EXPENSE_STATUSES.has(after)) {
      await clearExpenseApprovalAlerts(expense.id);
      await notifyExpenseDecision(expense, after === 'rejected' ? 'rejected' : 'approved', actor?.name);
      return 1;
    }
    return 0;
  } catch (err) {
    console.warn('[NOTIFICATIONS] expense approval:', err.message);
    return 0;
  }
}

async function runNotificationScans() {
  const ar = await scanOverdueReceivables();
  const periods = await scanPeriodCloseReminders();
  return { ar, periods, total: ar + periods };
}

module.exports = {
  createNotification,
  ensureNotificationsTable,
  notifyExpenseApprovalChange,
  resolveExpenseApprovers,
  purgeRetiredNotifications,
  scanOverdueReceivables,
  scanPeriodCloseReminders,
  runNotificationScans,
  notifyAgtFailure,
};
