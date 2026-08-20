// Audit Trail API Routes
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');

const AUDIT_LIST_COLS = `id, table_name, record_id, action, user_id, user_name, branch_id, description, created_at`;

function parseAuditLimit(raw, fallback, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

function parseOffset(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function dayBounds(from, to) {
  const start = String(from || '').trim().slice(0, 10);
  const end = String(to || '').trim().slice(0, 10);
  return { start, end };
}

function buildAuditWhere(req) {
  const { tableName, recordId, userId, userName, action, startDate, endDate, branchId, q } = req.query;
  const params = [];
  const conditions = [];
  const { start, end } = dayBounds(startDate, endDate);

  if (tableName) {
    params.push(tableName);
    conditions.push(`table_name = $${params.length}`);
  }
  if (recordId) {
    params.push(recordId);
    conditions.push(`CAST(record_id AS TEXT) = $${params.length}`);
  }
  if (userId) {
    params.push(userId);
    conditions.push(`CAST(user_id AS TEXT) = $${params.length}`);
  }
  if (userName) {
    params.push(userName);
    conditions.push(`user_name = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (branchId) {
    params.push(branchId);
    conditions.push(`CAST(branch_id AS TEXT) = $${params.length}`);
  }
  if (start) {
    params.push(`${start}T00:00:00`);
    conditions.push(`created_at >= $${params.length}`);
  }
  if (end) {
    params.push(end);
    conditions.push(
      db.engine === 'postgres'
        ? `created_at < ($${params.length}::date + INTERVAL '1 day')`
        : `date(created_at) <= date($${params.length})`,
    );
  }
  const search = String(q || '').trim();
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    const p = `$${params.length}`;
    conditions.push(
      `(LOWER(COALESCE(description, '')) LIKE ${p}
        OR LOWER(COALESCE(user_name, '')) LIKE ${p}
        OR LOWER(COALESCE(table_name, '')) LIKE ${p}
        OR LOWER(COALESCE(action, '')) LIKE ${p}
        OR LOWER(CAST(record_id AS TEXT)) LIKE ${p})`,
    );
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    dated: !!(start && end),
  };
}

module.exports = function(broadcastTable) {
  const router = express.Router();

  router.get('/', requireAuth, requirePermission('reports_audit'), async (req, res) => {
    try {
      const { where, params, dated } = buildAuditWhere(req);
      const max = dated ? 5000 : 500;
      const limit = parseAuditLimit(req.query.limit, 200, max);
      const offset = parseOffset(req.query.offset);

      const countResult = await db.query(
        `SELECT COUNT(*) AS total FROM audit_log ${where}`,
        params,
      );
      const total = Number(countResult.rows[0]?.total || 0);

      const listParams = [...params, limit, offset];
      const sql = `SELECT ${AUDIT_LIST_COLS} FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
      const result = await db.query(sql, listParams);

      res.json({
        items: result.rows,
        total,
        limit,
        offset,
        truncated: offset + result.rows.length < total,
      });
    } catch (error) {
      console.error('[AUDIT ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  router.get('/facets', requireAuth, requirePermission('reports_audit'), async (req, res) => {
    try {
      const facetQuery = { ...req.query, tableName: undefined, action: undefined, userId: undefined, q: undefined };
      const { where, params } = buildAuditWhere({ query: facetQuery });
      const userWhere = where
        ? `${where} AND user_name IS NOT NULL AND TRIM(user_name) <> ''`
        : `WHERE user_name IS NOT NULL AND TRIM(user_name) <> ''`;
      const tableWhere = where
        ? `${where} AND table_name IS NOT NULL AND TRIM(table_name) <> ''`
        : `WHERE table_name IS NOT NULL AND TRIM(table_name) <> ''`;
      const users = await db.query(
        `SELECT DISTINCT user_name FROM audit_log ${userWhere} ORDER BY user_name LIMIT 200`,
        params,
      );
      const tables = await db.query(
        `SELECT DISTINCT table_name FROM audit_log ${tableWhere} ORDER BY table_name LIMIT 200`,
        params,
      );
      res.json({
        users: (users.rows || []).map((r) => r.user_name),
        tables: (tables.rows || []).map((r) => r.table_name),
      });
    } catch (error) {
      console.error('[AUDIT FACETS]', error);
      res.status(500).json({ error: 'Failed to fetch audit facets' });
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
      const { where, params } = buildAuditWhere(req);
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const summarySql = db.engine === 'postgres'
        ? `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at >= $today::date AND created_at < ($today::date + INTERVAL '1 day'))::int AS today,
             COUNT(*) FILTER (WHERE action = 'create' OR action = 'issue')::int AS creates,
             COUNT(*) FILTER (WHERE action = 'update')::int AS updates,
             COUNT(*) FILTER (WHERE action IN ('delete', 'void'))::int AS voids,
             COUNT(*) FILTER (WHERE action = 'login')::int AS logins
           FROM audit_log ${where}`
        : `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN date(created_at) = date($today) THEN 1 ELSE 0 END) AS today,
             SUM(CASE WHEN action IN ('create', 'issue') THEN 1 ELSE 0 END) AS creates,
             SUM(CASE WHEN action = 'update' THEN 1 ELSE 0 END) AS updates,
             SUM(CASE WHEN action IN ('delete', 'void') THEN 1 ELSE 0 END) AS voids,
             SUM(CASE WHEN action = 'login' THEN 1 ELSE 0 END) AS logins
           FROM audit_log ${where}`;

      const summaryParams = [...params, todayIso];
      const todayIdx = summaryParams.length;
      const boundSql = summarySql.replace(/\$today/g, `$${todayIdx}`);
      const summary = await db.query(boundSql, summaryParams);
      const row = summary.rows[0] || {};

      const byAction = await db.query(
        `SELECT action, table_name, COUNT(*) as count,
                COUNT(DISTINCT user_id) as unique_users
         FROM audit_log
         ${where}
         GROUP BY action, table_name
         ORDER BY count DESC
         LIMIT 100`,
        params,
      );

      res.json({
        total: Number(row.total || 0),
        today: Number(row.today || 0),
        creates: Number(row.creates || 0),
        updates: Number(row.updates || 0),
        voids: Number(row.voids || 0),
        logins: Number(row.logins || 0),
        byAction: byAction.rows || [],
      });
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
