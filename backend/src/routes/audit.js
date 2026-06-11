// Audit Trail API Routes
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');

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
      const limitClause = `LIMIT ${parseInt(limit, 10) || 500}`;

      const result = await db.query(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC ${limitClause}`,
        params,
      );
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

  return router;
};
