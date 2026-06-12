/**
 * AGT async worker — outbox (sales, NC, ND) + reconciliation retries.
 */
const db = require('../db');
const { transmitFiscalEntity } = require('../agt/agtTransmission');
const { getAgtConfig } = require('../agt/agtConfig');
const { isDoneStatus, runAgtReconcileCycle } = require('../agt/agtReconcile');
const {
  fetchPendingForDestination,
  markSyncEventSent,
  markSyncEventFailed,
} = require('../sync/outbox');

let intervalHandle = null;
let running = false;
let reconcileCounter = 0;

const AGT_OUTBOX_HANDLERS = {
  'sale.created': {
    kind: 'sale',
    resolveId: (event, payload) => event.entity_id || payload?.sale?.id,
    snapshotStatus: (payload) => payload?.sale?.agt_status,
    liveQuery: 'SELECT agt_status FROM sales WHERE id = $1',
  },
  'credit_note.created': {
    kind: 'credit_note',
    resolveId: (event, payload) => event.entity_id || payload?.credit_note?.id,
    snapshotStatus: (payload) => payload?.credit_note?.agt_status,
    liveQuery: 'SELECT agt_status FROM credit_notes WHERE id = $1',
  },
  'debit_note.created': {
    kind: 'debit_note',
    resolveId: (event, payload) => event.entity_id || payload?.debit_note?.id,
    snapshotStatus: (payload) => payload?.debit_note?.agt_status,
    liveQuery: 'SELECT agt_status FROM debit_notes WHERE id = $1',
  },
};

function parsePayload(row) {
  try {
    return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  } catch {
    return {};
  }
}

async function processAgtOutboxEvent(event) {
  const handler = AGT_OUTBOX_HANDLERS[event.event_type];
  if (!handler) {
    await markSyncEventSent(event.id, 'agt', { source: 'agt_worker', skipped: true });
    return;
  }

  const payload = parsePayload(event);
  const entityId = handler.resolveId(event, payload);
  const snapStatus = handler.snapshotStatus(payload);

  if (isDoneStatus(snapStatus)) {
    await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
    return;
  }

  if (entityId) {
    const live = await db.query(handler.liveQuery, [entityId]);
    const liveStatus = live.rows[0]?.agt_status;
    if (isDoneStatus(liveStatus)) {
      await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
      return;
    }
  }

  if (!entityId) {
    await markSyncEventFailed(
      event.id,
      'missing entity id',
      Number(event.attempts || 0) + 1,
      'agt',
      { source: 'agt_worker' },
    );
    return;
  }

  try {
    await transmitFiscalEntity(handler.kind, entityId);
    await markSyncEventSent(event.id, 'agt', { source: 'agt_worker' });
  } catch (e) {
    const attempts = Number(event.attempts || 0) + 1;
    await markSyncEventFailed(event.id, e.message, attempts, 'agt', { source: 'agt_worker' });
    console.warn('[AGT WORKER]', handler.kind, entityId, e.message);
  }
}

async function runAgtCycle() {
  if (running) return;
  running = true;
  try {
    const config = await getAgtConfig();
    if (!config.autoTransmit) return;

    const events = await fetchPendingForDestination('agt', 10);
    for (const event of events) {
      await processAgtOutboxEvent(event);
    }

    reconcileCounter += 1;
    if (reconcileCounter % 3 === 0) {
      const result = await runAgtReconcileCycle({ limit: 5 });
      const total =
        (result.failed?.retried || 0)
        + (result.backfill?.transmitted || 0)
        + (result.pending?.updated || 0);
      if (total > 0) {
        console.log('[AGT WORKER] Reconcile:', JSON.stringify(result));
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
  console.log('[AGT WORKER] Started (sales + NC + ND + reconcile)');
}

function stopAgtWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { startAgtWorker, stopAgtWorker, runAgtCycle };
