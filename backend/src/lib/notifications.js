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
    const r = await db.query(
      `SELECT id, name, sku, stock, min_stock, branch_id
       FROM products
       WHERE COALESCE(is_active, true) = true
         AND min_stock IS NOT NULL
         AND stock IS NOT NULL
         AND stock <= min_stock
       ORDER BY stock ASC
       LIMIT 40`,
    );
    let created = 0;
    const day = new Date().toISOString().slice(0, 10);
    for (const p of r.rows) {
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

module.exports = {
  createNotification,
  scanLowStockNotifications,
  notifyAgtFailure,
};
