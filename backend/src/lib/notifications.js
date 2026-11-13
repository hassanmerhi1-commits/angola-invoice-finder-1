const db = require('../db');
const crypto = require('crypto');
const { selectExpenseApprovers } = require('./expenseApprovers');
const { broadcastTable } = require('./tableBroadcast');
const {
  overdueDocKey,
  overdueDedupeKey,
  overdueIdentityFromDedupe,
  periodDedupeKey,
  agtDedupeKey,
} = require('./notificationDedupe');

const AGT_DOC = {
  sale: { table: 'sales', numberCol: 'invoice_number' },
  credit_note: { table: 'credit_notes', numberCol: 'document_number' },
  debit_note: { table: 'debit_notes', numberCol: 'document_number' },
};

let storeReady = null;

/** Postgres gets the tables from migration 062/085; SQLite still needs them here. */
async function ensureNotificationStore() {
  if (storeReady) return storeReady;
  storeReady = (async () => {
    if (db.engine === 'postgres') {
      await db.query(`
        CREATE TABLE IF NOT EXISTS notification_user_state (
          user_id TEXT NOT NULL,
          notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
          is_read BOOLEAN NOT NULL DEFAULT false,
          dismissed BOOLEAN NOT NULL DEFAULT false,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, notification_id)
        )
      `);
      return;
    }
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
      CREATE TABLE IF NOT EXISTS notification_user_state (
        user_id TEXT NOT NULL,
        notification_id TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0,
        dismissed INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, notification_id)
      );
    `);
  })().catch((err) => {
    storeReady = null;
    throw err;
  });
  return storeReady;
}

function sqlFlag(on) {
  if (db.engine === 'postgres') return on ? true : false;
  return on ? 1 : 0;
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
  bump = false,
}) {
  const id = crypto.randomUUID();
  try {
    await ensureNotificationStore();
    if (dedupeKey) {
      const existing = await db.query(
        'SELECT id, link FROM notifications WHERE dedupe_key = $1 LIMIT 1',
        [dedupeKey],
      );
      const row = existing.rows[0];
      if (row) {
        await db.query(
          `UPDATE notifications
           SET title = $1, message = $2, severity = $3, link = $4, branch_id = $5
           WHERE id = $6`,
          [title, message, severity, link, branchId, row.id],
        );
        if (bump) {
          await db.query(
            `UPDATE notifications
             SET created_at = CURRENT_TIMESTAMP, is_read = $1
             WHERE id = $2`,
            [sqlFlag(false), row.id],
          );
          await db.query(
            'DELETE FROM notification_user_state WHERE notification_id = $1',
            [row.id],
          );
        }
        return { ...row, link, inserted: false };
      }
    }
    const r = await db.query(
      `INSERT INTO notifications (
         id, user_id, branch_id, type, title, message, severity, link, dedupe_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [id, userId, branchId, type, title, message, severity, link, dedupeKey],
    );
    return { ...(r.rows[0] || { id }), inserted: true };
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
    await ensureNotificationStore();
    await db.query("DELETE FROM notifications WHERE type = 'low_stock'");
  } catch (err) {
    console.warn('[NOTIFICATIONS] purge:', err.message);
  }
}

async function loadAgtDocument(entityType, entityId) {
  const meta = AGT_DOC[entityType];
  if (!meta || !entityId) return null;
  try {
    const r = await db.query(
      `SELECT branch_id, ${meta.numberCol} AS document_number
       FROM ${meta.table}
       WHERE id = $1`,
      [entityId],
    );
    return r.rows[0] || null;
  } catch (err) {
    console.warn('[NOTIFICATIONS] AGT document lookup skipped:', err.message);
    return null;
  }
}

function agtDocumentLink(entityId, documentNumber) {
  const params = new URLSearchParams();
  if (entityId) params.set('invoiceId', String(entityId));
  const number = String(documentNumber || '').trim();
  if (number) params.set('q', number);
  const qs = params.toString();
  return qs ? `/invoices?${qs}` : '/invoices';
}

async function notifyAgtFailure({ entityType, entityId, message }) {
  const doc = await loadAgtDocument(entityType, entityId);
  const number = String(doc?.document_number || '').trim();
  const detail = String(message || '').trim() || 'O documento não foi aceite';
  const row = await createNotification({
    type: 'agt_failure',
    title: 'Falha no envio à AGT',
    message: number ? `${number}: ${detail}` : detail,
    severity: 'critical',
    link: agtDocumentLink(entityId, number),
    branchId: doc?.branch_id || null,
    dedupeKey: agtDedupeKey(entityType, entityId),
    bump: true,
  });
  if (row && row.id) {
    try { broadcastTable('notifications'); } catch (_) { /* non-fatal */ }
  }
  return row;
}

function overdueReceivableLink(entityId, entityName) {
  const params = new URLSearchParams();
  params.set('openReceipt', '1');
  params.set('entityId', String(entityId || '').trim());
  const name = String(entityName || '').trim();
  if (name) params.set('entityName', name);
  return `/payments?${params.toString()}`;
}

async function deleteNotificationIds(queryable, ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  await queryable.query(
    `DELETE FROM notification_user_state WHERE notification_id IN (${placeholders})`,
    ids,
  ).catch(() => undefined);
  await queryable.query(
    `DELETE FROM notifications WHERE id IN (${placeholders})`,
    ids,
  );
  return ids.length;
}

/** Drop paid invoices, and the extra daily copies of one that is still overdue. */
async function pruneSettledOverdueNotifications(queryable = db) {
  const today = new Date().toISOString().slice(0, 10);
  let open;
  try {
    await ensureNotificationStore();
    open = await queryable.query(
      `SELECT entity_id, document_number
       FROM open_items
       WHERE entity_type = 'customer'
         AND status != 'cleared'
         AND due_date IS NOT NULL
         AND CAST(due_date AS TEXT) < $1
         AND COALESCE(remaining_amount, 0) > 0.01`,
      [today],
    );
  } catch (err) {
    console.warn('[NOTIFICATIONS] overdue prune skipped:', err.message);
    return 0;
  }
  const live = new Set(
    (open.rows || []).map((row) => overdueDocKey(row.entity_id, row.document_number)),
  );
  const existing = await queryable.query(
    `SELECT id, dedupe_key FROM notifications WHERE type = 'overdue_ar'`,
  );
  const stale = [];
  for (const row of existing.rows || []) {
    const identity = overdueIdentityFromDedupe(row.dedupe_key);
    const stable = identity ? `overdue_ar:${identity}` : '';
    if (!identity || !live.has(identity) || row.dedupe_key !== stable) stale.push(row.id);
  }
  return deleteNotificationIds(queryable, stale);
}

/** Overdue customer receivables (open_items). */
async function scanOverdueReceivables() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await db.query(
      `SELECT oi.entity_id, oi.document_number, oi.remaining_amount, oi.due_date,
              c.name AS entity_name,
              COALESCE(oi.branch_id, s.branch_id) AS branch_id
       FROM open_items oi
       LEFT JOIN clients c ON c.id = oi.entity_id
       LEFT JOIN sales s ON s.id = oi.document_id
       WHERE oi.entity_type = 'customer'
         AND oi.status != 'cleared'
         AND oi.due_date IS NOT NULL
         AND CAST(oi.due_date AS TEXT) < $1
         AND COALESCE(oi.remaining_amount, 0) > 0
       ORDER BY oi.due_date ASC
       LIMIT 40`,
      [today],
    );
    let created = 0;
    for (const row of r.rows || []) {
      const due = Number(row.remaining_amount || 0);
      const link = overdueReceivableLink(row.entity_id, row.entity_name);
      const dueDay = String(row.due_date || '').slice(0, 10);
      const n = await createNotification({
        type: 'overdue_ar',
        title: 'Factura em atraso',
        message: `${row.document_number || 'Documento'}: ${formatAoa(due)} em atraso (venceu em ${dueDay})`,
        severity: 'warning',
        link,
        branchId: row.branch_id || null,
        dedupeKey: overdueDedupeKey(row.entity_id, row.document_number || row.entity_id),
      });
      if (n?.inserted) created += 1;
    }
    const pruned = await pruneSettledOverdueNotifications();
    return { created, pruned };
  } catch (err) {
    console.warn('[NOTIFICATIONS] overdue AR scan:', err.message);
    return { created: 0, pruned: 0 };
  }
}

async function prunePeriodCloseNotifications(liveIds) {
  const existing = await db.query(
    `SELECT id, dedupe_key FROM notifications WHERE type = 'period_close'`,
  );
  const live = new Set(liveIds || []);
  const stale = [];
  for (const row of existing.rows || []) {
    const key = String(row.dedupe_key || '');
    const periodId = key.startsWith('period_close:') ? key.slice('period_close:'.length).split(':')[0] : '';
    const stable = periodId ? periodDedupeKey(periodId) : '';
    if (!periodId || !live.has(periodId) || key !== stable) stale.push(row.id);
  }
  return deleteNotificationIds(db, stale);
}

/** Remind when current month period is still open near month end / after. */
async function scanPeriodCloseReminders() {
  try {
    await ensureNotificationStore();
    const now = new Date();
    const day = now.getDate();
    // Before the 25th the reminder is noise. From the 25th, one line per open period.
    if (day < 25) {
      const pruned = await prunePeriodCloseNotifications([]);
      return { created: 0, pruned };
    }
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
    const liveIds = [];
    for (const p of r.rows || []) {
      liveIds.push(String(p.id));
      const n = await createNotification({
        type: 'period_close',
        title: 'Fecho do período',
        message: `O período ainda está aberto: ${p.name || p.id}`,
        severity: 'info',
        link: '/accounting-periods',
        dedupeKey: periodDedupeKey(p.id),
      });
      if (n?.inserted) created += 1;
    }
    const pruned = await prunePeriodCloseNotifications(liveIds);
    return { created, pruned };
  } catch (err) {
    console.warn('[NOTIFICATIONS] period close scan:', err.message);
    return { created: 0, pruned: 0 };
  }
}

/** The id keeps the request visible even when the approver's branch scope would hide it. */
function expenseListLink() {
  return '/expenses';
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
      link: expenseListLink(),
      userId: String(approver.id),
      branchId: expense.branchId || null,
      dedupeKey: `expense_approval:${expense.id}:${approver.id}`,
      bump: true,
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
    link: expenseListLink(),
    userId: requesterId,
    branchId: expense.branchId || null,
    dedupeKey: `expense_decision:${expense.id}:${approved ? 'approved' : 'rejected'}`,
    bump: true,
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
  const created = Number(ar.created) + Number(periods.created);
  const pruned = Number(ar.pruned) + Number(periods.pruned);
  if (created > 0 || pruned > 0) {
    try { broadcastTable('notifications'); } catch (_) { /* non-fatal */ }
  }
  return { ar: ar.created, periods: periods.created, pruned, total: created };
}

module.exports = {
  createNotification,
  ensureNotificationStore,
  ensureNotificationsTable: ensureNotificationStore,
  notifyExpenseApprovalChange,
  resolveExpenseApprovers,
  purgeRetiredNotifications,
  scanOverdueReceivables,
  pruneSettledOverdueNotifications,
  scanPeriodCloseReminders,
  runNotificationScans,
  notifyAgtFailure,
};
