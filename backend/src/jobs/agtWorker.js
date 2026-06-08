/**
 * AGT async worker — sign + transmit for queued sale events.
 */
const db = require('../db');
const { signSaleInvoice } = require('../agt/signSale');
const { transmitInvoice } = require('../agt/connector');
const {
  fetchPendingForDestination,
  markSyncEventSent,
  markSyncEventFailed,
} = require('../sync/outbox');

let intervalHandle = null;
let running = false;

function parsePayload(row) {
  try {
    return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  } catch {
    return {};
  }
}

async function processAgtForSale(saleId, snapshot) {
  await signSaleInvoice(saleId);

  const sale = snapshot?.sale || (await db.query('SELECT * FROM sales WHERE id = $1', [saleId])).rows[0];
  if (!sale) throw new Error('Sale not found for AGT');

  const payload = {
    documentType: 'FT',
    invoiceNumber: sale.invoice_number,
    date: sale.created_at,
    customerNif: sale.customer_nif || '999999990',
    customerName: sale.customer_name || 'Consumidor Final',
    subtotal: parseFloat(sale.subtotal),
    taxAmount: parseFloat(sale.tax_amount),
    total: parseFloat(sale.total),
    hash: sale.saft_hash,
  };

  const crypto = require('crypto');
  const transmissionId = crypto.randomUUID();
  await db.query(
    `INSERT INTO agt_transmissions (id, invoice_id, invoice_number, transmission_type, request_payload, agt_status)
     VALUES ($1, $2, $3, 'invoice', $4, 'pending')`,
    [transmissionId, saleId, sale.invoice_number, JSON.stringify(payload)]
  );

  const result = await transmitInvoice(payload);

  if (transmissionId) {
    await db.query(
      `UPDATE agt_transmissions
       SET response_payload = $1, agt_code = $2, agt_status = $3, validated_at = $4
       WHERE id = $5`,
      [
        JSON.stringify(result.responsePayload),
        result.agtCode,
        result.agtStatus,
        result.validatedAt,
        transmissionId,
      ]
    );
  }

  await db.query(
    `UPDATE sales SET agt_status = $1, agt_code = $2, agt_validated_at = $3 WHERE id = $4`,
    [result.agtStatus, result.agtCode, result.validatedAt, saleId]
  );

  return result;
}

async function runAgtCycle() {
  if (running) return;
  running = true;
  try {
    const events = await fetchPendingForDestination('agt', 10);
    for (const event of events) {
      if (event.event_type !== 'sale.created') {
        await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
        continue;
      }
      const snapshot = parsePayload(event);
      const saleId = event.entity_id || snapshot?.sale?.id;
      const snapSale = snapshot?.sale;
      const existingStatus = String(snapSale?.agt_status || '').toLowerCase();
      if (existingStatus && ['validated', 'submitted', 'approved'].includes(existingStatus)) {
        await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
        continue;
      }
      if (saleId) {
        const live = await db.query('SELECT agt_status FROM sales WHERE id = $1', [saleId]);
        const liveStatus = String(live.rows[0]?.agt_status || '').toLowerCase();
        if (liveStatus && ['validated', 'submitted', 'approved'].includes(liveStatus)) {
          await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
          continue;
        }
      }
      if (!saleId) {
        await markSyncEventFailed(
          event.id,
          'missing sale id',
          Number(event.attempts || 0) + 1,
          'agt',
          { source: 'agt_worker' }
        );
        continue;
      }
      try {
        await processAgtForSale(saleId, snapshot);
        await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
      } catch (e) {
        const attempts = Number(event.attempts || 0) + 1;
        await markSyncEventFailed(event.id, e.message, attempts, 'agt', { source: 'agt_worker' });
        console.warn('[AGT WORKER]', saleId, e.message);
      }
    }
  } finally {
    running = false;
  }
}

function startAgtWorker(intervalMs = 5000) {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runAgtCycle().catch((e) => console.warn('[AGT WORKER]', e.message));
  }, intervalMs);
  runAgtCycle().catch(() => {});
  console.log('[AGT WORKER] Started');
}

function stopAgtWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { startAgtWorker, stopAgtWorker, runAgtCycle };
