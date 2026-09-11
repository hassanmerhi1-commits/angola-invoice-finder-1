const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { runNotificationScans } = require('../lib/notifications');
const {
  visibleNotificationTypes,
  isRestrictedToOwnNotifications,
} = require('../lib/notificationVisibility');

function typePlaceholders(types, firstIndex) {
  return types.map((_, i) => `$${firstIndex + i}`).join(', ');
}

/** Rows this user is allowed to read. Restricted users see only their own, by type. */
function readScope(user, startIndex = 1) {
  const types = visibleNotificationTypes(user);
  if (!types) {
    return { where: `(user_id IS NULL OR user_id = $${startIndex})`, params: [user.id] };
  }
  if (!types.length) return { where: '1 = 0', params: [] };
  return {
    where: `(user_id = $${startIndex} AND type IN (${typePlaceholders(types, startIndex + 1)}))`,
    params: [user.id, ...types],
  };
}

/** Rows this user owns, so may delete. Never matches broadcasts, which are shared. */
function ownScope(user, startIndex = 1) {
  const types = visibleNotificationTypes(user);
  if (!types) return { where: `user_id = $${startIndex}`, params: [user.id] };
  if (!types.length) return { where: '1 = 0', params: [] };
  return {
    where: `(user_id = $${startIndex} AND type IN (${typePlaceholders(types, startIndex + 1)}))`,
    params: [user.id, ...types],
  };
}

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
      const scope = readScope(req.user);
      const r = await db.query(
        `SELECT * FROM notifications
         WHERE ${scope.where}
         ORDER BY created_at DESC
         LIMIT $${scope.params.length + 1}`,
        [...scope.params, limit],
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
        const scope = readScope(req.user);
        await db.query(
          `UPDATE notifications SET is_read = true
           WHERE ${scope.where} AND (is_read = false OR is_read = 0)`,
          scope.params,
        );
      } else if (ids.length) {
        const scope = readScope(req.user, 2);
        for (const id of ids) {
          await db.query(
            `UPDATE notifications SET is_read = true WHERE id = $1 AND ${scope.where}`,
            [id, ...scope.params],
          );
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to mark read' });
    }
  });

  /**
   * Clearing must outlive the next refresh, so own notifications are deleted rather
   * than hidden locally. Broadcast rows belong to everyone, so those are only read.
   */
  router.post('/dismiss', requireAuth, async (req, res) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
      // A restricted user must not touch shared rows they cannot even see.
      const sharesBroadcasts = !isRestrictedToOwnNotifications(req.user);
      if (req.body?.all) {
        const scope = ownScope(req.user);
        await db.query(`DELETE FROM notifications WHERE ${scope.where}`, scope.params);
        if (sharesBroadcasts) {
          await db.query('UPDATE notifications SET is_read = true WHERE user_id IS NULL');
        }
      } else if (ids.length) {
        const scope = ownScope(req.user, 2);
        for (const id of ids) {
          await db.query(
            `DELETE FROM notifications WHERE id = $1 AND ${scope.where}`,
            [id, ...scope.params],
          );
          if (sharesBroadcasts) {
            await db.query(
              'UPDATE notifications SET is_read = true WHERE id = $1 AND user_id IS NULL',
              [id],
            );
          }
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to dismiss' });
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
