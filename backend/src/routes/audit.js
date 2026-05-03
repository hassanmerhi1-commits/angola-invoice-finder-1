// Audit Trail API Routes
const express = require('express');
const db = require('../db');

module.exports = function(broadcastTable) {
  const router = express.Router();

  // Get audit log entries
  router.get('/', async (req, res) => {
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
      const limitClause = `LIMIT ${parseInt(limit) || 100}`;

      const result = await db.query(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC ${limitClause}`,
        params
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // Get audit history for a specific record
  router.get('/record/:tableName/:recordId', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM audit_log WHERE table_name = $1 AND record_id = $2 ORDER BY created_at DESC',
        [req.params.tableName, req.params.recordId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch record history' });
    }
  });

  // Create audit entry (used internally and for manual logging)
  router.post('/', async (req, res) => {
    try {
      const { tableName, recordId, action, userId, userName, branchId, oldValues, newValues, description, metadata } = req.body;
      const result = await db.query(
        `INSERT INTO audit_log (table_name, record_id, action, user_id, user_name, branch_id, old_values, new_values, description, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [tableName, recordId, action, userId, userName, branchId,
         oldValues ? JSON.stringify(oldValues) : null,
         newValues ? JSON.stringify(newValues) : null,
         description, metadata ? JSON.stringify(metadata) : null]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to create audit entry' });
    }
  });

  // Audit stats
  router.get('/stats', async (req, res) => {
    try {
      const { days } = req.query;
      const daysBack = parseInt(days) || 30;

      const result = await db.query(
        `SELECT 
           action, table_name, COUNT(*) as count,
           COUNT(DISTINCT user_id) as unique_users
         FROM audit_log 
         WHERE datetime(created_at) >= datetime('now', '-' || $1 || ' days')
         GROUP BY action, table_name
         ORDER BY count DESC`,
        [String(daysBack)]
      );
      res.json(result.rows);
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch audit stats' });
    }
  });

  return router;
};
