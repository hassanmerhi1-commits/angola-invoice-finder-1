const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { parseEvents } = require('../lib/webhooks');

function mapWebhook(row, { includeSecret = false } = {}) {
  const events = parseEvents(row.events);
  const mapped = {
    id: row.id,
    name: row.name,
    url: row.url,
    events,
    isActive: row.is_active !== false && row.is_active !== 0,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSecret && row.secret) mapped.secret = row.secret;
  return mapped;
}

function normalizeEvents(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim());
}

module.exports = function webhooksRouter() {
  const router = express.Router();

  router.get('/', requireAuth, requirePermission('admin_settings'), async (_req, res) => {
    try {
      const r = await db.query(
        `SELECT id, name, url, secret, events, is_active, created_by, created_at, updated_at
         FROM webhooks
         ORDER BY created_at DESC`,
      );
      res.json((r.rows || []).map((row) => mapWebhook(row)));
    } catch (e) {
      console.error('[WEBHOOKS]', e);
      res.status(500).json({ error: e.message || 'Failed to list webhooks' });
    }
  });

  router.post('/', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const { name, url, events, secret, isActive } = req.body || {};
      if (!name || !url) {
        return res.status(400).json({ error: 'name and url are required' });
      }
      const id = crypto.randomUUID();
      const webhookSecret = typeof secret === 'string' && secret.trim()
        ? secret.trim()
        : crypto.randomBytes(32).toString('hex');
      const eventsJson = JSON.stringify(normalizeEvents(events));
      const active = isActive !== false;
      await db.query(
        `INSERT INTO webhooks (id, name, url, secret, events, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, String(name).trim(), String(url).trim(), webhookSecret, eventsJson, active, req.user?.id || null],
      );
      const r = await db.query('SELECT * FROM webhooks WHERE id = $1', [id]);
      res.status(201).json(mapWebhook(r.rows[0], { includeSecret: true }));
    } catch (e) {
      console.error('[WEBHOOKS]', e);
      res.status(500).json({ error: e.message || 'Failed to create webhook' });
    }
  });

  router.get('/deliveries/recent', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
      const webhookId = typeof req.query.webhookId === 'string' ? req.query.webhookId.trim() : '';
      const params = [];
      let where = '';
      if (webhookId) {
        params.push(webhookId);
        where = `WHERE d.webhook_id = $${params.length}`;
      }
      params.push(limit);
      const r = await db.query(
        `SELECT d.id, d.webhook_id, d.event_type, d.status, d.attempts, d.last_error,
                d.created_at, d.delivered_at, w.name AS webhook_name, w.url AS webhook_url
         FROM webhook_deliveries d
         LEFT JOIN webhooks w ON w.id = d.webhook_id
         ${where}
         ORDER BY d.created_at DESC
         LIMIT $${params.length}`,
        params,
      );
      res.json((r.rows || []).map((row) => ({
        id: row.id,
        webhookId: row.webhook_id,
        webhookName: row.webhook_name || '',
        webhookUrl: row.webhook_url || '',
        eventType: row.event_type,
        status: row.status,
        attempts: Number(row.attempts) || 0,
        lastError: row.last_error || null,
        createdAt: row.created_at,
        deliveredAt: row.delivered_at || null,
      })));
    } catch (e) {
      console.error('[WEBHOOKS deliveries]', e);
      res.status(500).json({ error: e.message || 'Failed to list deliveries' });
    }
  });

  router.post('/deliveries/:id/retry', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const r = await db.query(
        `UPDATE webhook_deliveries
         SET status = 'pending', last_error = NULL, attempts = 0
         WHERE id = $1 AND status IN ('failed', 'pending')
         RETURNING id, status`,
        [req.params.id],
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Delivery not found or not retryable' });
      res.json({ success: true, id: r.rows[0].id, status: r.rows[0].status });
    } catch (e) {
      console.error('[WEBHOOKS retry]', e);
      res.status(500).json({ error: e.message || 'Failed to retry delivery' });
    }
  });

  router.post('/:id/test', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const existing = await db.query('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Webhook not found' });
      const body = JSON.stringify({
        event: 'webhook.test',
        data: { webhookId: req.params.id, message: 'NEXOR webhook test ping' },
        timestamp: new Date().toISOString(),
      });
      const id = crypto.randomUUID();
      await db.query(
        `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status)
         VALUES ($1, $2, 'webhook.test', $3, 'pending')`,
        [id, req.params.id, body],
      );
      const { deliverPendingWebhooks } = require('../lib/webhooks');
      await deliverPendingWebhooks(5);
      const d = await db.query(
        `SELECT id, status, attempts, last_error, delivered_at FROM webhook_deliveries WHERE id = $1`,
        [id],
      );
      res.json({
        deliveryId: id,
        status: d.rows[0]?.status || 'pending',
        attempts: Number(d.rows[0]?.attempts) || 0,
        lastError: d.rows[0]?.last_error || null,
        deliveredAt: d.rows[0]?.delivered_at || null,
      });
    } catch (e) {
      console.error('[WEBHOOKS test]', e);
      res.status(500).json({ error: e.message || 'Failed to test webhook' });
    }
  });

  router.put('/:id', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const existing = await db.query('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
      if (!existing.rows[0]) return res.status(404).json({ error: 'Webhook not found' });
      const row = existing.rows[0];
      const { name, url, events, secret, isActive } = req.body || {};
      const nextName = name != null ? String(name).trim() : row.name;
      const nextUrl = url != null ? String(url).trim() : row.url;
      const nextEvents = events != null ? JSON.stringify(normalizeEvents(events)) : row.events;
      const nextSecret = typeof secret === 'string' && secret.trim() ? secret.trim() : row.secret;
      const nextActive = isActive != null ? isActive !== false : row.is_active !== false && row.is_active !== 0;
      await db.query(
        `UPDATE webhooks
         SET name = $2, url = $3, secret = $4, events = $5, is_active = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [req.params.id, nextName, nextUrl, nextSecret, nextEvents, nextActive],
      );
      const r = await db.query('SELECT * FROM webhooks WHERE id = $1', [req.params.id]);
      res.json(mapWebhook(r.rows[0]));
    } catch (e) {
      console.error('[WEBHOOKS]', e);
      res.status(500).json({ error: e.message || 'Failed to update webhook' });
    }
  });

  router.delete('/:id', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const r = await db.query('DELETE FROM webhooks WHERE id = $1 RETURNING id', [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Webhook not found' });
      res.json({ success: true, id: r.rows[0].id });
    } catch (e) {
      console.error('[WEBHOOKS]', e);
      res.status(500).json({ error: e.message || 'Failed to delete webhook' });
    }
  });

  return router;
};
