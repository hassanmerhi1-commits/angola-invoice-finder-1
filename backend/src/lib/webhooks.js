const crypto = require('crypto');
const db = require('../db');

const MAX_DELIVERY_ATTEMPTS = 5;

function parseEvents(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildDeliveryBody(eventType, payload) {
  return JSON.stringify({
    event: eventType,
    data: payload,
    timestamp: new Date().toISOString(),
  });
}

function signPayload(secret, body) {
  return crypto.createHmac('sha256', secret || '').update(body).digest('hex');
}

function webhookMatchesEvent(events, eventType) {
  return events.includes('*') || events.includes(eventType);
}

/**
 * Queue webhook deliveries for all active endpoints subscribed to eventType (or '*').
 */
async function enqueueWebhookEvent(eventType, payload) {
  const r = await db.query(
    `SELECT id, url, secret, events FROM webhooks WHERE is_active = true`,
  );
  const body = buildDeliveryBody(eventType, payload);
  for (const wh of r.rows || []) {
    const events = parseEvents(wh.events);
    if (!webhookMatchesEvent(events, eventType)) continue;
    await db.query(
      `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [crypto.randomUUID(), wh.id, eventType, body],
    );
  }
}

/**
 * POST pending deliveries; marks delivered or failed (retries until MAX_DELIVERY_ATTEMPTS).
 */
async function deliverPendingWebhooks(limit = 20) {
  const pending = await db.query(
    `SELECT d.id, d.payload, d.attempts, w.url, w.secret, w.is_active
     FROM webhook_deliveries d
     INNER JOIN webhooks w ON w.id = d.webhook_id
     WHERE d.status = 'pending'
     ORDER BY d.created_at ASC
     LIMIT $1`,
    [limit],
  );

  let delivered = 0;
  for (const row of pending.rows || []) {
    if (row.is_active === false || row.is_active === 0) {
      await db.query(
        `UPDATE webhook_deliveries SET status = 'failed', last_error = $2, attempts = attempts + 1
         WHERE id = $1`,
        [row.id, 'Webhook inactive'],
      );
      continue;
    }

    const attempts = Number(row.attempts || 0) + 1;
    try {
      const signature = signPayload(row.secret, row.payload);
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nexor-Signature': signature,
        },
        body: row.payload,
        signal: AbortSignal.timeout(Number(process.env.WEBHOOK_TIMEOUT_MS || 15000)),
      });
      if (res.ok) {
        await db.query(
          `UPDATE webhook_deliveries
           SET status = 'delivered', attempts = $2, delivered_at = CURRENT_TIMESTAMP, last_error = NULL
           WHERE id = $1`,
          [row.id, attempts],
        );
        delivered += 1;
      } else {
        const err = `HTTP ${res.status}`;
        if (attempts >= MAX_DELIVERY_ATTEMPTS) {
          await db.query(
            `UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`,
            [row.id, attempts, err],
          );
        } else {
          await db.query(
            `UPDATE webhook_deliveries SET attempts = $2, last_error = $3 WHERE id = $1`,
            [row.id, attempts, err],
          );
        }
      }
    } catch (e) {
      const err = String(e?.message || e || 'delivery failed');
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        await db.query(
          `UPDATE webhook_deliveries SET status = 'failed', attempts = $2, last_error = $3 WHERE id = $1`,
          [row.id, attempts, err],
        );
      } else {
        await db.query(
          `UPDATE webhook_deliveries SET attempts = $2, last_error = $3 WHERE id = $1`,
          [row.id, attempts, err],
        );
      }
    }
  }
  return delivered;
}

module.exports = {
  enqueueWebhookEvent,
  deliverPendingWebhooks,
  signPayload,
  parseEvents,
};
