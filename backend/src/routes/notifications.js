const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { scanLowStockNotifications, runNotificationScans } = require('../lib/notifications');

function mapRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity || 'info',
    link: row.link || undefined,
    timestamp: row.created_at,
    read: row.is_read === true || row.is_read === 1,
    userId: row.user_id,
    branchId: row.branch_id,
  };
}

module.exports = function notificationsRouter() {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const r = await db.query(
        `SELECT * FROM notifications
         WHERE user_id IS NULL OR user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.user.id, limit],
      );
      res.json(r.rows.map(mapRow));
    } catch (e) {
      console.error('[NOTIFICATIONS]', e);
      res.status(500).json({ error: e.message || 'Failed to list notifications' });
    }
  });

  router.post('/mark-read', requireAuth, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
      if (req.body?.all) {
        await db.query(
          `UPDATE notifications SET is_read = true
           WHERE (user_id IS NULL OR user_id = $1) AND (is_read = false OR is_read = 0)`,
          [req.user.id],
        );
      } else if (ids.length) {
        for (const id of ids) {
          await db.query(
            `UPDATE notifications SET is_read = true
             WHERE id = $1 AND (user_id IS NULL OR user_id = $2)`,
            [id, req.user.id],
          );
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to mark read' });
    }
  });

  router.post('/scan-low-stock', requireAuth, async (req, res) => {
    try {
      if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      const created = await scanLowStockNotifications();
      res.json({ success: true, created });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Scan failed' });
    }
  });

  router.post('/scan', requireAuth, async (req, res) => {
    try {
      if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      const result = await runNotificationScans();
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Scan failed' });
    }
  });

  return router;
};
