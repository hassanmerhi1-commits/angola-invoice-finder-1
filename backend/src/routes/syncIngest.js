/**
 * Sync ingest — main HQ mirror + city server client batch (offline shop).
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { authenticateSyncIngest } = require('../middleware/syncAuth');
const { processSale } = require('../transactionEngine');
const { enqueueSaleCreated } = require('../sync/outbox');

function parseJsonField(val) {
  if (!val) return {};
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

async function mirrorSaleEvent(payload) {
  const { sale, items } = payload;
  if (!sale?.id) return { skipped: true, reason: 'no sale' };

  const dup = await db.query(
    `SELECT id FROM sales WHERE id = $1 OR client_request_id = $2 LIMIT 1`,
    [sale.id, sale.client_request_id || sale.id]
  );
  if (dup.rows.length > 0) {
    return { skipped: true, reason: 'duplicate', id: dup.rows[0].id };
  }

  await db.query(
    `INSERT INTO sales (id, invoice_number, branch_id, cashier_id, cashier_name,
      subtotal, tax_amount, discount, total, payment_method, amount_paid, change,
      customer_nif, customer_name, status, saft_hash, agt_status, agt_code, agt_validated_at,
      client_request_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      sale.id, sale.invoice_number, sale.branch_id, sale.cashier_id, sale.cashier_name,
      sale.subtotal, sale.tax_amount, sale.discount || 0, sale.total,
      sale.payment_method, sale.amount_paid, sale.change,
      sale.customer_nif, sale.customer_name, sale.status || 'completed',
      sale.saft_hash, sale.agt_status, sale.agt_code, sale.agt_validated_at,
      sale.client_request_id || sale.id,
      sale.created_at || new Date().toISOString(),
      sale.updated_at || sale.created_at || new Date().toISOString(),
    ]
  );

  for (const item of items || []) {
    const itemId = item.id || crypto.randomUUID();
    const exists = await db.query(`SELECT 1 FROM sale_items WHERE id = $1`, [itemId]);
    if (exists.rows.length) continue;
    await db.query(
      `INSERT INTO sale_items (id, sale_id, product_id, product_name, sku, quantity,
        unit_price, discount, tax_rate, tax_amount, subtotal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        itemId, sale.id, item.product_id, item.product_name, item.sku, item.quantity,
        item.unit_price, item.discount || 0, item.tax_rate, item.tax_amount, item.subtotal,
      ]
    );
  }
  return { mirrored: true, id: sale.id };
}

async function mirrorPaymentEvent(payload) {
  const { payment } = payload;
  if (!payment?.id) return { skipped: true };
  const dup = await db.query(`SELECT id FROM payments WHERE id = $1`, [payment.id]);
  if (dup.rows.length > 0) return { skipped: true, reason: 'duplicate' };
  await db.query(
    `INSERT INTO payments (id, payment_number, payment_type, entity_type, entity_id, entity_name,
      payment_method, amount, bank_account, reference, notes, branch_id, created_by, posted_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      payment.id, payment.payment_number, payment.payment_type, payment.entity_type,
      payment.entity_id, payment.entity_name, payment.payment_method, payment.amount,
      payment.bank_account || '', payment.reference || '', payment.notes || '',
      payment.branch_id, payment.created_by, payment.posted_at || payment.created_at,
      payment.created_at || new Date().toISOString(),
    ]
  );
  return { mirrored: true, id: payment.id };
}

async function applyEvent(event) {
  const payload = parseJsonField(event.payload);
  switch (event.event_type) {
    case 'sale.created':
      return mirrorSaleEvent(payload);
    case 'payment.created':
      return mirrorPaymentEvent(payload);
    case 'journal.posted':
      return { mirrored: false, reason: 'journal mirror deferred' };
    default:
      return { skipped: true, reason: 'unknown type' };
  }
}

module.exports = function syncIngestRouter(broadcastTable) {
  const router = express.Router();

  router.post('/ingest', authenticateSyncIngest, async (req, res) => {
    try {
      const events = Array.isArray(req.body?.events) ? req.body.events : [req.body];
      const results = [];
      for (const ev of events) {
        const row = ev.payload
          ? ev
          : { event_type: ev.type, payload: ev.payload, idempotency_key: ev.idempotencyKey };
        const idem = row.idempotency_key || row.idempotencyKey;
        if (idem) {
          const exists = await db.query(
            `SELECT id FROM sync_events WHERE idempotency_key = $1 AND status = 'sent' LIMIT 1`,
            [idem]
          );
          if (exists.rows.length > 0) {
            results.push({ idempotencyKey: idem, ok: true, duplicate: true });
            continue;
          }
        }
        const payload = row.payload != null
          ? (typeof row.payload === 'string' ? parseJsonField(row.payload) : row.payload)
          : parseJsonField(row);
        const result = await applyEvent({
          event_type: row.event_type || row.type,
          payload,
        });
        results.push({ idempotencyKey: idem, ok: true, result });
      }
      if (broadcastTable) {
        await broadcastTable('sales');
        await broadcastTable('payments');
      }
      res.json({ success: true, results });
    } catch (e) {
      console.error('[SYNC INGEST]', e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Shop client offline batch — applies sales on city server via transaction engine */
  router.post('/client-ingest', async (req, res) => {
    const client = await db.pool.connect();
    try {
      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      const results = [];

      for (const ev of events) {
        const key = ev.idempotencyKey || ev.idempotency_key;
        if (!key) {
          results.push({ ok: false, error: 'missing idempotencyKey' });
          continue;
        }

        const dup = await db.query(
          `SELECT id FROM sales WHERE client_request_id = $1 LIMIT 1`,
          [key]
        );
        if (dup.rows.length > 0) {
          results.push({ ok: true, duplicate: true, saleId: dup.rows[0].id });
          continue;
        }

        if (ev.type !== 'sale.created') {
          results.push({ ok: false, error: `unsupported type ${ev.type}` });
          continue;
        }

        const body = ev.payload?.saleData || ev.payload;
        body.clientRequestId = key;

        await client.query('BEGIN');
        const sale = await processSale(client, body);
        await client.query('COMMIT');

        await db.query(
          `UPDATE sales SET client_request_id = $1 WHERE id = $2`,
          [key, sale.id]
        );

        await enqueueSaleCreated(null, sale.id, body.branchId, key);
        results.push({ ok: true, saleId: sale.id, invoiceNumber: sale.invoice_number });
      }

      if (broadcastTable) {
        await broadcastTable('sales');
        await broadcastTable('products');
      }
      res.json({ success: true, results });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SYNC CLIENT INGEST]', e);
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  router.get('/status', authenticateSyncIngest, async (_req, res) => {
    try {
      const pending = await db.query(
        `SELECT COUNT(*) AS n FROM sync_events WHERE status IN ('pending', 'failed')`
      );
      const dead = await db.query(
        `SELECT COUNT(*) AS n FROM sync_events WHERE status = 'dead'`
      );
      res.json({
        pending: Number(pending.rows[0]?.n || 0),
        dead: Number(dead.rows[0]?.n || 0),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
