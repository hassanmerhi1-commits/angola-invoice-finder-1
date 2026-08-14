// Audit Trail API Routes
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');

const AUDIT_LIST_COLS = `id, table_name, record_id, action, user_id, user_name, branch_id, description, created_at`;

function parseAuditLimit(raw, fallback = 100, max = 200) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  router.get('/', requireAuth, requirePermission('reports_audit'), async (req, res) => {
    try {
      const { tableName, recordId, userId, action, startDate, endDate, limit } = req.query;
      const params = [];
      const conditions = [];

      if (tableName) { params.push(tableName); conditions.push(`table_name = $${params.length}`); }
      if (recordId) { params.push(recordId); conditions.push(`record_id = $${params.length}`); }
      if (userId) { params.push(userId); conditions.push(`user_id = $${params.length}`); }
      if (action) { params.push(action); conditions.push(`action = $${params.length}`); }
      if (startDate) { params.push(startDate); conditions.push(`created_at >= $${params.length}`); }
      if (endDate) { params.push(endDate); conditions.push(`created_at <= $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      params.push(parseAuditLimit(limit));
      const limitSql = `LIMIT $${params.length}`;
      const sql = `SELECT ${AUDIT_LIST_COLS} FROM audit_log ${where} ORDER BY created_at DESC ${limitSql}`;

      let result;
      if (db.engine === 'postgres' && db.pool) {
        const client = await db.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SET LOCAL statement_timeout = '2500'`);
          result = await client.query(sql, params);
          await client.query('COMMIT');
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch { /* ignore */ }
          throw err;
        } finally {
          client.release();
        }
      } else {
        result = await db.query(sql, params);
      }
      res.json(result.rows);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  router.get('/record/:tableName/:recordId', requireAuth, requirePermission('reports_audit'), async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM audit_log WHERE table_name = $1 AND record_id = $2 ORDER BY created_at DESC',
        [req.params.tableName, req.params.recordId],
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch record history' });
    }
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const { tableName, recordId, action, oldValues, newValues, description, metadata } = req.body;
      const id = await logFiscalEventFromReq(req, {
        tableName: tableName || 'system',
        recordId,
        action,
        oldValues,
        newValues,
        description,
        metadata,
      });
      if (!id) {
        return res.status(500).json({ error: 'Failed to create audit entry' });
      }
      const result = await db.query('SELECT * FROM audit_log WHERE id = $1', [id]);
      res.status(201).json(result.rows[0] || { id });
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to create audit entry' });
    }
  });

  router.get('/stats', requireAuth, requirePermission('reports_audit'), async (req, res) => {
    try {
      const daysBack = parseInt(req.query.days, 10) || 30;
      const dateFilter = db.engine === 'postgres'
        ? `created_at >= NOW() - INTERVAL '${daysBack} days'`
        : `datetime(created_at) >= datetime('now', '-${daysBack} days')`;

      const result = await db.query(
        `SELECT action, table_name, COUNT(*) as count,
                COUNT(DISTINCT user_id) as unique_users
         FROM audit_log
         WHERE ${dateFilter}
         GROUP BY action, table_name
         ORDER BY count DESC`,
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch audit stats' });
    }
  });

  router.get('/:id', requireAuth, requirePermission('reports_audit'), async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM audit_log WHERE id::text = $1::text LIMIT 1',
        [req.params.id],
      );
      if (!result.rows[0]) {
        return res.status(404).json({ error: 'Audit entry not found' });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch audit entry' });
    }
  });

  return router;
};
