const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { attachUserBranchScope, resolveListBranchId } = require('../middleware/branchScope');
const { runNotificationScans, ensureNotificationStore } = require('../lib/notifications');
const {
  visibleNotificationTypes,
  isRestrictedToOwnNotifications,
} = require('../lib/notificationVisibility');

function idText(column) {
  return db.engine === 'postgres' ? `${column}::text` : `CAST(${column} AS TEXT)`;
}

function sqlBool(on) {
  return db.engine === 'postgres' ? !!on : (on ? 1 : 0);
}

function notDismissedSql() {
  return db.engine === 'postgres'
    ? 'COALESCE(st.dismissed, false) = false'
    : 'COALESCE(st.dismissed, 0) = 0';
}

function readExpr() {
  return db.engine === 'postgres'
    ? 'CASE WHEN n.user_id IS NULL THEN COALESCE(st.is_read, false) ELSE n.is_read END'
    : 'CASE WHEN n.user_id IS NULL THEN COALESCE(st.is_read, 0) ELSE n.is_read END';
}

function typePlaceholders(types, firstIndex) {
  return types.map((_, i) => `$${firstIndex + i}`).join(', ');
}

/** Rows this user is allowed to read. Restricted users see only their own, by type. */
function readScope(user, startIndex = 1, alias = '') {
  const userCol = alias ? `${alias}.user_id` : 'user_id';
  const typeCol = alias ? `${alias}.type` : 'type';
  const types = visibleNotificationTypes(user);
  if (!types) {
    return { where: `(${userCol} IS NULL OR ${userCol} = $${startIndex})`, params: [user.id] };
  }
  if (!types.length) return { where: '1 = 0', params: [] };
  return {
    where: `(${userCol} = $${startIndex} AND ${typeCol} IN (${typePlaceholders(types, startIndex + 1)}))`,
    params: [user.id, ...types],
  };
}

/** A city sees shared alerts for that city only. Head office sees every city. */
function branchClause(branchId, startIndex) {
  if (!branchId) return { sql: '', params: [] };
  return {
    sql: ` AND (${idText('n.user_id')} IS NOT NULL OR ${idText('n.branch_id')} = $${startIndex})`,
    params: [String(branchId)],
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

async function upsertBroadcastState(userId, { isRead, dismissed, writeDismissed, branchId, onlyId }) {
  const params = [userId, sqlBool(isRead), sqlBool(dismissed), sqlBool(writeDismissed)];
  const filters = ['n.user_id IS NULL'];
  if (onlyId) {
    params.push(String(onlyId));
    filters.push(`${idText('n.id')} = $${params.length}`);
  }
  if (branchId) {
    params.push(String(branchId));
    filters.push(`${idText('n.branch_id')} = $${params.length}`);
  }
  const writeCheck = db.engine === 'postgres' ? '$4 IS TRUE' : '$4 = 1';
  await db.query(
    `INSERT INTO notification_user_state (user_id, notification_id, is_read, dismissed, updated_at)
     SELECT $1, n.id, $2, $3, CURRENT_TIMESTAMP
     FROM notifications n
     WHERE ${filters.join(' AND ')}
     ON CONFLICT (user_id, notification_id) DO UPDATE SET
       is_read = EXCLUDED.is_read,
       dismissed = CASE WHEN ${writeCheck} THEN EXCLUDED.dismissed ELSE notification_user_state.dismissed END,
       updated_at = CURRENT_TIMESTAMP`,
    params,
  );
}

module.exports = function notificationsRouter() {
  const router = express.Router();
  router.use(attachUserBranchScope);

  router.get('/', requireAuth, async (req, res) => {
    try {
      await ensureNotificationStore();
      const scopedBranchId = resolveListBranchId(req, req.query.branchId);
      if (scopedBranchId === undefined) return res.json([]);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
      const scope = readScope(req.user, 1, 'n');
      const branch = branchClause(scopedBranchId || '', scope.params.length + 1);
      const r = await db.query(
        `SELECT n.id, n.type, n.title, n.message, n.severity, n.link, n.created_at,
                n.user_id, n.branch_id, ${readExpr()} AS is_read
         FROM notifications n
         LEFT JOIN notification_user_state st
           ON ${idText('st.notification_id')} = ${idText('n.id')}
          AND st.user_id = $1
         WHERE ${scope.where}
           AND (n.user_id IS NOT NULL OR ${notDismissedSql()})
           ${branch.sql}
         ORDER BY n.created_at DESC
         LIMIT $${scope.params.length + branch.params.length + 1}`,
        [...scope.params, ...branch.params, limit],
      );
      res.json(r.rows.map(mapRow));
    } catch (e) {
      console.error('[NOTIFICATIONS]', e);
      res.status(500).json({ error: e.message || 'Failed to list notifications' });
    }
  });

  router.post('/mark-read', requireAuth, async (req, res) => {
    try {
      await ensureNotificationStore();
      const scopedBranchId = resolveListBranchId(req, req.body?.branchId);
      const branchId = scopedBranchId || '';
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
      const readFlag = sqlBool(true);
      if (req.body?.all) {
        const scope = readScope(req.user, 2);
        const unread = db.engine === 'postgres' ? 'is_read = false' : 'is_read = 0';
        await db.query(
          `UPDATE notifications SET is_read = $1
           WHERE ${scope.where} AND user_id IS NOT NULL AND ${unread}`,
          [readFlag, ...scope.params],
        );
        if (!isRestrictedToOwnNotifications(req.user) && scopedBranchId !== undefined) {
          await upsertBroadcastState(req.user.id, {
            isRead: true,
            dismissed: false,
            writeDismissed: false,
            branchId,
          });
        }
      } else if (ids.length) {
        const scope = readScope(req.user, 3);
        for (const id of ids) {
          await db.query(
            `UPDATE notifications SET is_read = $1 WHERE id = $2 AND ${scope.where} AND user_id IS NOT NULL`,
            [readFlag, id, ...scope.params],
          );
          if (!isRestrictedToOwnNotifications(req.user) && scopedBranchId !== undefined) {
            await upsertBroadcastState(req.user.id, {
              isRead: true,
              dismissed: false,
              writeDismissed: false,
              branchId,
              onlyId: id,
            });
          }
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to mark read' });
    }
  });

  /**
   * Own rows are deleted. Shared rows stay for everyone else; this user stops seeing them.
   */
  router.post('/dismiss', requireAuth, async (req, res) => {
    try {
      await ensureNotificationStore();
      const scopedBranchId = resolveListBranchId(req, req.body?.branchId);
      const branchId = scopedBranchId || '';
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === 'string') : [];
      // Shared rows stay for the other people. This user just stops seeing them.
      const sharesBroadcasts = !isRestrictedToOwnNotifications(req.user) && scopedBranchId !== undefined;
      if (req.body?.all) {
        const scope = ownScope(req.user);
        await db.query(
          `DELETE FROM notification_user_state
           WHERE notification_id IN (SELECT id FROM notifications WHERE ${scope.where})`,
          scope.params,
        ).catch(() => undefined);
        await db.query(`DELETE FROM notifications WHERE ${scope.where}`, scope.params);
        if (sharesBroadcasts) {
          await upsertBroadcastState(req.user.id, {
            isRead: true,
            dismissed: true,
            writeDismissed: true,
            branchId,
          });
        }
      } else if (ids.length) {
        const scope = ownScope(req.user, 2);
        for (const id of ids) {
          await db.query(
            `DELETE FROM notification_user_state
             WHERE notification_id IN (
               SELECT id FROM notifications WHERE id = $1 AND ${scope.where}
             )`,
            [id, ...scope.params],
          ).catch(() => undefined);
          await db.query(
            `DELETE FROM notifications WHERE id = $1 AND ${scope.where}`,
            [id, ...scope.params],
          );
          if (sharesBroadcasts) {
            await upsertBroadcastState(req.user.id, {
              isRead: true,
              dismissed: true,
              writeDismissed: true,
              branchId,
              onlyId: id,
            });
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
      await ensureNotificationStore();
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
