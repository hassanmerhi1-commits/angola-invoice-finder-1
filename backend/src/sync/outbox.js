/**
 * Sync outbox — enqueue fiscal/operational events for main + AGT workers.
 */
const crypto = require('crypto');
const db = require('../db');
const { getInstallationConfig } = require('./installation');

async function tableExists(name) {
  try {
    const r = await db.query(
      db.engine === 'postgres'
        ? `SELECT 1 FROM information_schema.tables WHERE table_name = $1 LIMIT 1`
        : `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      db.engine === 'postgres' ? [name] : [name]
    );
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

async function resolveCityId(branchId) {
  if (!branchId) return null;
  try {
    const r = await db.query(`SELECT city_id FROM branches WHERE id = $1 LIMIT 1`, [branchId]);
    return r.rows[0]?.city_id || null;
  } catch {
    return null;
  }
}

/**
 * @param {object} client - optional transaction client
 * @param {object} event
 */
async function enqueueSyncEvent(client, event) {
  if (!(await tableExists('sync_events'))) return null;

  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const {
    type,
    entityId,
    branchId,
    idempotencyKey,
    payload,
    destinations = ['main', 'agt'],
  } = event;

  const key = idempotencyKey || `${type}:${entityId || crypto.randomUUID()}`;
  const cityId = event.cityId || (await resolveCityId(branchId));
  const destJson = JSON.stringify(destinations);
  const payloadJson = JSON.stringify(payload || {});

  const existing = await q(
    `SELECT id, status FROM sync_events WHERE idempotency_key = $1 LIMIT 1`,
    [key]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const id = crypto.randomUUID();
  await q(
    `INSERT INTO sync_events
     (id, event_type, entity_id, branch_id, city_id, payload, idempotency_key, destinations, status, next_retry_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', CURRENT_TIMESTAMP)`,
    [id, type, entityId || null, branchId || null, cityId, payloadJson, key, destJson]
  );
  return { id, status: 'pending' };
}

async function buildSaleSnapshot(client, saleId) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const saleRes = await q(`SELECT * FROM sales WHERE id = $1`, [saleId]);
  if (!saleRes.rows.length) return null;
  const sale = saleRes.rows[0];
  const itemsRes = await q(`SELECT * FROM sale_items WHERE sale_id = $1`, [saleId]);
  return { sale, items: itemsRes.rows };
}

async function enqueueSaleCreated(client, saleId, branchId, idempotencyKey) {
  const snapshot = await buildSaleSnapshot(client, saleId);
  if (!snapshot) return null;
  return enqueueSyncEvent(client, {
    type: 'sale.created',
    entityId: saleId,
    branchId,
    idempotencyKey: idempotencyKey || `sale:${saleId}`,
    payload: snapshot,
    destinations: ['main', 'agt'],
  });
}

async function enqueuePaymentCreated(client, paymentId, branchId) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const payRes = await q(`SELECT * FROM payments WHERE id = $1`, [paymentId]);
  if (!payRes.rows.length) return null;
  return enqueueSyncEvent(client, {
    type: 'payment.created',
    entityId: paymentId,
    branchId,
    idempotencyKey: `payment:${paymentId}`,
    payload: { payment: payRes.rows[0] },
    destinations: ['main'],
  });
}

async function enqueueJournalPosted(client, entryId, branchId) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const entryRes = await q(`SELECT * FROM journal_entries WHERE id = $1`, [entryId]);
  if (!entryRes.rows.length) return null;
  const linesRes = await q(
    `SELECT jel.*, coa.code AS account_code FROM journal_entry_lines jel
     LEFT JOIN chart_of_accounts coa ON jel.account_id = coa.id
     WHERE jel.journal_entry_id = $1`,
    [entryId]
  );
  const ref = entryRes.rows[0].reference_type;
  if (['sale', 'receipt', 'payment', 'payment_receipt', 'payment_out'].includes(ref)) {
    return null;
  }
  return enqueueSyncEvent(client, {
    type: 'journal.posted',
    entityId: entryId,
    branchId,
    idempotencyKey: `journal:${entryId}`,
    payload: { entry: entryRes.rows[0], lines: linesRes.rows },
    destinations: ['main'],
  });
}

function parseJsonArray(val) {
  try {
    const v = typeof val === 'string' ? JSON.parse(val) : val;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function fetchPendingForDestination(destination, limit = 20) {
  if (!(await tableExists('sync_events'))) return [];
  const cfg = await getInstallationConfig();
  if (cfg.isMainServer && destination === 'main') return [];

  const r = await db.query(
    `SELECT * FROM sync_events
     WHERE status IN ('pending', 'failed')
       AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
       AND destinations LIKE $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [`%"${destination}"%`, limit]
  );
  return r.rows.filter((row) => {
    const dests = parseJsonArray(row.destinations);
    const done = parseJsonArray(row.destinations_done);
    return dests.includes(destination) && !done.includes(destination);
  });
}

async function markDestinationDone(id, destination) {
  const row = await db.query(`SELECT destinations, destinations_done FROM sync_events WHERE id = $1`, [id]);
  if (!row.rows.length) return;
  const dests = parseJsonArray(row.rows[0].destinations);
  const done = parseJsonArray(row.rows[0].destinations_done);
  if (!done.includes(destination)) done.push(destination);
  const allDone = dests.every((d) => done.includes(d));
  const doneJson = JSON.stringify(done);
  const nextRetry = new Date(Date.now() + 5000).toISOString();
  if (allDone) {
    await db.query(
      `UPDATE sync_events SET destinations_done = $1, status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $2`,
      [doneJson, id]
    );
  } else {
    await db.query(
      `UPDATE sync_events SET destinations_done = $1, status = 'pending', last_error = NULL, next_retry_at = $2 WHERE id = $3`,
      [doneJson, nextRetry, id]
    );
  }
}

async function markSyncEventSent(id, destination) {
  if (destination) return markDestinationDone(id, destination);
  await db.query(
    `UPDATE sync_events SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $1`,
    [id]
  );
}

async function markSyncEventFailed(id, error, attempts, destination) {
  const delaySec = Math.min(300, Math.pow(2, Math.min(attempts, 8)) * 2);
  const nextRetry = new Date(Date.now() + delaySec * 1000).toISOString();
  await db.query(
    `UPDATE sync_events
     SET status = CASE WHEN $2 >= 12 THEN 'dead' ELSE 'failed' END,
         attempts = $2,
         last_error = $3,
         next_retry_at = $4
     WHERE id = $1`,
    [id, attempts, String(error).slice(0, 2000), nextRetry]
  );
  if (destination) {
    console.warn(`[OUTBOX] ${destination} failed for ${id}:`, error);
  }
}

module.exports = {
  enqueueSyncEvent,
  enqueueSaleCreated,
  enqueuePaymentCreated,
  enqueueJournalPosted,
  buildSaleSnapshot,
  fetchPendingForDestination,
  markSyncEventSent,
  markSyncEventFailed,
  markDestinationDone,
};
