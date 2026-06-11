/**
 * AGT async worker — transmit queued sale events via unified transmission service.
 */
const db = require('../db');
const { transmitFiscalEntity } = require('../agt/agtTransmission');
const { getAgtConfig } = require('../agt/agtConfig');
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

async function processAgtForSale(saleId) {
  return transmitFiscalEntity('sale', saleId);
}

async function runAgtCycle() {
  if (running) return;
  running = true;
  try {
    const config = await getAgtConfig();
    if (!config.autoTransmit) return;

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
          { source: 'agt_worker' },
        );
        continue;
      }
      try {
        await processAgtForSale(saleId);
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
