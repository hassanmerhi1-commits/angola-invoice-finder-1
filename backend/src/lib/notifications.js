const db = require('../db');
const crypto = require('crypto');

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

async function scanLowStockNotifications() {
  try {
    const { queryLowStockProducts } = require('./lowStock');
    const rows = await queryLowStockProducts({ limit: 40 });
    let created = 0;
    const day = new Date().toISOString().slice(0, 10);
    for (const p of rows) {
      const stock = Number(p.stock);
      const min = Number(p.min_stock);
      const row = await createNotification({
        type: 'low_stock',
        title: 'Low stock',
        message: `${p.name || p.sku}: ${stock} (min ${min})`,
        severity: stock <= 0 ? 'critical' : 'warning',
        link: '/inventory',
        branchId: p.branch_id || null,
        dedupeKey: `low_stock:${p.id}:${day}`,
      });
      if (row && row.id) created += 1;
    }
    return created;
  } catch (err) {
    console.warn('[NOTIFICATIONS] low-stock scan:', err.message);
    return 0;
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

async function runNotificationScans() {
  const low = await scanLowStockNotifications();
  const ar = await scanOverdueReceivables();
  const periods = await scanPeriodCloseReminders();
  return { low, ar, periods, total: low + ar + periods };
}

module.exports = {
  createNotification,
  scanLowStockNotifications,
  scanOverdueReceivables,
  scanPeriodCloseReminders,
  runNotificationScans,
  notifyAgtFailure,
};
