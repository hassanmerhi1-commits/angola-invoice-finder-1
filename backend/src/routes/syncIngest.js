/**
 * Sync ingest — main HQ mirror + city server client batch (offline shop).
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const {
  authenticateSyncIngest,
  authenticateClientIngest,
  configuredClientIngestKeys,
} = require('../middleware/syncAuth');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { applyClientIngestEvent, SUPPORTED_TYPES } = require('../sync/clientIngestHandlers');
const { fetchMasterDataForBranch } = require('../sync/masterData');
const { buildDownPackage, verifyUpPackage } = require('../sync/usbPackage');
const { logSyncAudit, fetchRecentAudit } = require('../sync/auditLog');
const { applyHqIngestEvent, findHqIngestReceipt } = require('../sync/hqIngestMirror');
const { buildConsolidationReport } = require('../sync/consolidation');
const {
  fetchDeadLetterEvents,
  replayDeadLetterEvent,
  resolveDeadLetterEvent,
} = require('../sync/outbox');

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
  const idem = event.idempotency_key || event.idempotencyKey;
  switch (event.event_type) {
    case 'sale.created':
      return mirrorSaleEvent(payload);
    case 'payment.created':
      return mirrorPaymentEvent(payload);
    case 'purchase_invoice.created':
    case 'stock_movement':
      return applyHqIngestEvent({ event_type: event.event_type, payload, idempotency_key: idem });
    case 'journal.posted':
      return applyHqIngestEvent({ event_type: event.event_type, payload, idempotency_key: idem });
    default:
      return { skipped: true, reason: 'unknown type' };
  }
}

async function buildSyncStatusReport() {
  const pending = await db.query(
    `SELECT COUNT(*) AS n FROM sync_events WHERE status IN ('pending', 'failed')`
  );
  const dead = await db.query(
    `SELECT COUNT(*) AS n FROM sync_events WHERE status = 'dead'`
  );
  const sent = await db.query(
    `SELECT COUNT(*) AS n FROM sync_events WHERE status = 'sent'`
  );

  let byBranch = [];
  let byDestination = { main: 0, agt: 0, other: 0 };

  try {
    const branchSql = db.engine === 'postgres'
      ? `SELECT branch_id, status, COUNT(*)::int AS n
         FROM sync_events
         WHERE status IN ('pending', 'failed', 'dead')
         GROUP BY branch_id, status`
      : `SELECT branch_id, status, COUNT(*) AS n
         FROM sync_events
         WHERE status IN ('pending', 'failed', 'dead')
         GROUP BY branch_id, status`;
    const branchRes = await db.query(branchSql);
    const branchMap = new Map();
    for (const row of branchRes.rows) {
      const bid = row.branch_id || 'unknown';
      if (!branchMap.has(bid)) {
        branchMap.set(bid, { branchId: bid, pending: 0, failed: 0, dead: 0 });
      }
      const entry = branchMap.get(bid);
      if (row.status === 'pending') entry.pending += Number(row.n);
      else if (row.status === 'failed') entry.failed += Number(row.n);
      else if (row.status === 'dead') entry.dead += Number(row.n);
    }
    byBranch = Array.from(branchMap.values());
  } catch {
    /* sync_events may be empty */
  }

  try {
    const destSql = db.engine === 'postgres'
      ? `SELECT COALESCE(destination, 'legacy') AS dest, COUNT(*)::int AS n
         FROM sync_events
         WHERE status IN ('pending', 'failed')
         GROUP BY COALESCE(destination, 'legacy')`
      : `SELECT COALESCE(destination, 'legacy') AS dest, COUNT(*) AS n
         FROM sync_events
         WHERE status IN ('pending', 'failed')
         GROUP BY COALESCE(destination, 'legacy')`;
    const destRes = await db.query(destSql);
    for (const row of destRes.rows) {
      const d = row.dest;
      const n = Number(row.n);
      if (d === 'main') byDestination.main += n;
      else if (d === 'agt') byDestination.agt += n;
      else byDestination.other += n;
    }
  } catch {
    /* ignore */
  }

  const recentAudit = await fetchRecentAudit(15);

  return {
    pending: Number(pending.rows[0]?.n || 0),
    failed: Number(
      (await db.query(`SELECT COUNT(*) AS n FROM sync_events WHERE status = 'failed'`)).rows[0]?.n || 0
    ),
    dead: Number(dead.rows[0]?.n || 0),
    sent: Number(sent.rows[0]?.n || 0),
    byBranch,
    byDestination,
    recentAudit,
    clientIngestSecured: configuredClientIngestKeys().any,
  };
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
          const receipt = await findHqIngestReceipt(idem);
          if (receipt?.entity_id) {
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
        await logSyncAudit({
          eventType: row.event_type || row.type,
          entityType: 'ingest',
          source: 'hq_ingest',
          destination: 'main',
          idempotencyKey: idem,
          status: result.skipped ? 'completed' : 'completed',
        });
        results.push({ idempotencyKey: idem, ok: true, result });
      }
      if (broadcastTable) {
        await broadcastTable('sales');
        await broadcastTable('payments');
        await broadcastTable('purchase_invoices');
        await broadcastTable('products');
        await broadcastTable('journal_entries');
      }
      res.json({ success: true, results });
    } catch (e) {
      console.error('[SYNC INGEST]', e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Shop client batch — sales, payments, stock movements (Phase B3) */
  router.post('/client-ingest', authenticateClientIngest, async (req, res) => {
    const poolClient = await db.pool.connect();
    try {
      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      const results = [];
      let touchedSales = false;
      let touchedProducts = false;
      let touchedPayments = false;
      let touchedPurchases = false;
      let touchedCaixa = false;

      for (const ev of events) {
        const key = ev.idempotencyKey || ev.idempotency_key;
        const type = ev.type || ev.event_type;
        try {
          const result = await applyClientIngestEvent(poolClient, ev);
          if (result.ok !== false) {
            await logSyncAudit({
              eventType: type,
              entityType: result.eventType || type,
              entityId:
                result.saleId
                || result.paymentId
                || result.movementId
                || result.purchaseInvoiceId
                || result.sessionId
                || null,
              branchId:
                ev.payload?.saleData?.branchId
                || ev.payload?.paymentData?.branchId
                || ev.payload?.invoiceData?.branchId
                || ev.payload?.sessionData?.branchId
                || null,
              source: 'shop_client',
              destination: 'city_server',
              idempotencyKey: key,
              status: 'completed',
            });
            if (type === 'sale.created') touchedSales = true;
            if (type === 'payment.created') touchedPayments = true;
            if (type === 'stock_movement' || type === 'purchase_invoice.created') touchedProducts = true;
            if (type === 'purchase_invoice.created') touchedPurchases = true;
            if (type === 'caixa.close') touchedCaixa = true;
          } else {
            await logSyncAudit({
              eventType: type,
              source: 'shop_client',
              destination: 'city_server',
              idempotencyKey: key,
              status: 'failed',
              errorMessage: result.error,
            });
          }
          results.push({ idempotencyKey: key, ...result });
        } catch (e) {
          await poolClient.query('ROLLBACK').catch(() => {});
          await logSyncAudit({
            eventType: type,
            source: 'shop_client',
            destination: 'city_server',
            idempotencyKey: key,
            status: 'failed',
            errorMessage: e.message,
          });
          results.push({ ok: false, idempotencyKey: key, error: e.message });
        }
      }

      if (broadcastTable) {
        if (touchedSales) await broadcastTable('sales');
        if (touchedPayments) await broadcastTable('payments');
        if (touchedProducts) await broadcastTable('products');
        if (touchedPurchases) await broadcastTable('purchase_invoices');
        if (touchedCaixa) {
          await broadcastTable('caixas');
          await broadcastTable('caixa_sessions');
        }
      }
      res.json({ success: true, supportedTypes: Array.from(SUPPORTED_TYPES), results });
    } catch (e) {
      console.error('[SYNC CLIENT INGEST]', e);
      res.status(500).json({ error: e.message });
    } finally {
      poolClient.release();
    }
  });

  /** City → shop: products + clients snapshot (incremental via ?since=ISO) */
  router.get('/master-data', authenticateClientIngest, async (req, res) => {
    try {
      const branchId = String(req.query.branchId || '').trim();
      const since = req.query.since ? String(req.query.since) : null;
      if (!branchId) return res.status(400).json({ error: 'branchId query required' });
      const data = await fetchMasterDataForBranch(branchId, since);
      res.json(data);
    } catch (e) {
      console.error('[SYNC MASTER DATA]', e);
      res.status(500).json({ error: e.message });
    }
  });

  /** Connected PC: export nexor-down catalog + POS stock snapshot for USB. */
  router.get('/usb-catalog', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const branchId = String(req.query.branchId || '').trim();
      if (!branchId) return res.status(400).json({ error: 'branchId query required' });
      const data = await fetchMasterDataForBranch(branchId, null);
      const branch = await db.query(`SELECT name FROM branches WHERE id = $1 LIMIT 1`, [branchId]).catch(() => ({ rows: [] }));
      const pkg = buildDownPackage({
        branchId,
        branchName: branch.rows[0]?.name || null,
        appVersion: process.env.NEXOR_APP_VERSION || null,
        data,
      });
      res.json({ package: pkg });
    } catch (e) {
      console.error('[SYNC USB CATALOG]', e);
      res.status(500).json({ error: e.message });
    }
  });

  /** City office: apply nexor-up USB package through the same ingest handlers. */
  router.post('/usb-ingest', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    const poolClient = await db.pool.connect();
    try {
      const pkg = req.body?.package || req.body;
      const verified = verifyUpPackage(pkg);
      if (!verified.ok) return res.status(400).json({ error: verified.error });

      const events = Array.isArray(pkg.events) ? pkg.events : [];
      const results = [];
      let touchedSales = false;
      let touchedProducts = false;
      let touchedPayments = false;
      let touchedPurchases = false;
      let touchedCaixa = false;

      for (const ev of events) {
        const key = ev.idempotencyKey || ev.idempotency_key;
        const type = ev.type || ev.event_type;
        try {
          const result = await applyClientIngestEvent(poolClient, ev);
          if (result.ok !== false) {
            await logSyncAudit({
              eventType: type,
              entityType: result.eventType || type,
              entityId:
                result.saleId
                || result.paymentId
                || result.movementId
                || result.purchaseInvoiceId
                || result.sessionId
                || null,
              branchId:
                ev.payload?.saleData?.branchId
                || ev.payload?.paymentData?.branchId
                || ev.payload?.invoiceData?.branchId
                || ev.payload?.sessionData?.branchId
                || pkg.fromBranchId
                || null,
              source: 'usb_folder',
              destination: 'city_server',
              idempotencyKey: key,
              status: 'completed',
            });
            if (type === 'sale.created') touchedSales = true;
            if (type === 'payment.created') touchedPayments = true;
            if (type === 'stock_movement' || type === 'purchase_invoice.created') touchedProducts = true;
            if (type === 'purchase_invoice.created') touchedPurchases = true;
            if (type === 'caixa.close') touchedCaixa = true;
          } else {
            await logSyncAudit({
              eventType: type,
              source: 'usb_folder',
              destination: 'city_server',
              idempotencyKey: key,
              status: 'failed',
              errorMessage: result.error,
            });
          }
          results.push({ idempotencyKey: key, ...result });
        } catch (e) {
          await poolClient.query('ROLLBACK').catch(() => {});
          await logSyncAudit({
            eventType: type,
            source: 'usb_folder',
            destination: 'city_server',
            idempotencyKey: key,
            status: 'failed',
            errorMessage: e.message,
          });
          results.push({ ok: false, idempotencyKey: key, error: e.message });
        }
      }

      if (broadcastTable) {
        if (touchedSales) await broadcastTable('sales');
        if (touchedPayments) await broadcastTable('payments');
        if (touchedProducts) await broadcastTable('products');
        if (touchedPurchases) await broadcastTable('purchase_invoices');
        if (touchedCaixa) {
          await broadcastTable('caixas');
          await broadcastTable('caixa_sessions');
        }
      }

      const applied = results.filter((r) => r.ok !== false).length;
      const duplicates = results.filter((r) => r.duplicate).length;
      const failed = results.filter((r) => r.ok === false).length;
      res.json({
        success: failed === 0,
        applied,
        duplicates,
        failed,
        results,
      });
    } catch (e) {
      console.error('[SYNC USB INGEST]', e);
      res.status(500).json({ error: e.message });
    } finally {
      poolClient.release();
    }
  });

  /** HQ consolidation rollup from mirrored city data */
  router.get('/consolidation', requireAuth, async (req, res) => {
    try {
      const report = await buildConsolidationReport({
        startDate: req.query.startDate ? String(req.query.startDate) : undefined,
        endDate: req.query.endDate ? String(req.query.endDate) : undefined,
      });
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Dead letter queue — failed sync events after max retries */
  router.get('/dead-letter', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 100);
      const events = await fetchDeadLetterEvents(limit);
      res.json({ events });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/dead-letter/:id/replay', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const ok = await replayDeadLetterEvent(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Dead letter not found' });
      await logSyncAudit({
        eventType: 'dead_letter.replay',
        entityType: 'sync_event',
        entityId: req.params.id,
        source: 'hq_admin',
        destination: 'main',
        status: 'completed',
      });
      res.json({ success: true, replayed: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/dead-letter/:id/resolve', requireAuth, requirePermission('admin_settings'), async (req, res) => {
    try {
      const note = req.body?.note || 'manually resolved';
      const ok = await resolveDeadLetterEvent(req.params.id, note);
      if (!ok) return res.status(404).json({ error: 'Dead letter not found' });
      await logSyncAudit({
        eventType: 'dead_letter.resolve',
        entityType: 'sync_event',
        entityId: req.params.id,
        source: 'hq_admin',
        destination: 'main',
        status: 'completed',
      });
      res.json({ success: true, resolved: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Logged-in server UI — sync queue health (single laptop / city server) */
  router.get('/overview', requireAuth, async (_req, res) => {
    try {
      const { drainRedundantMainQueueOnHq } = require('../sync/outbox');
      await drainRedundantMainQueueOnHq().catch(() => 0);
      const report = await buildSyncStatusReport();
      let recentIngest = [];
      try {
        const r = await db.query(
          `SELECT idempotency_key, event_type, branch_id, entity_id, created_at
           FROM client_ingest_log ORDER BY created_at DESC LIMIT 15`
        );
        recentIngest = r.rows;
      } catch {
        /* table may not exist pre-migration */
      }
      res.json({
        ...report,
        recentClientIngest: recentIngest,
        supportedClientTypes: Array.from(SUPPORTED_TYPES),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/status', authenticateSyncIngest, async (_req, res) => {
    try {
      res.json(await buildSyncStatusReport());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  /** Lighter status for city ops / shop scripts (same key as client-ingest). */
  router.get('/status/summary', authenticateClientIngest, async (_req, res) => {
    try {
      const full = await buildSyncStatusReport();
      res.json({
        pending: full.pending,
        failed: full.failed,
        dead: full.dead,
        byBranch: full.byBranch,
        clientIngestSecured: full.clientIngestSecured,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
