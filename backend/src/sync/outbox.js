/**
 * Sync outbox — enqueue fiscal/operational events for main + AGT workers.
 * Phase B0: one row per destination; staged retry; audit trail.
 */
const crypto = require('crypto');
const db = require('../db');
const { getInstallationConfig } = require('./installation');
const { logSyncAudit } = require('./auditLog');
const { computeNextRetryAt, shouldMarkDead } = require('./retryPolicy');

const EVENT_ENTITY_TYPE = {
  'sale.created': 'sale',
  'credit_note.created': 'credit_note',
  'debit_note.created': 'debit_note',
  'payment.created': 'payment',
  'journal.posted': 'journal_entry',
  'purchase_invoice.created': 'purchase_invoice',
  'stock_movement': 'stock_movement',
};

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

async function hasDestinationColumn() {
  if (!(await tableExists('sync_events'))) return false;
  try {
    if (db.engine === 'postgres') {
      const r = await db.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'sync_events' AND column_name = 'destination' LIMIT 1`
      );
      return r.rows.length > 0;
    }
    const r = await db.query(`PRAGMA table_info(sync_events)`);
    return (r.rows || []).some((c) => c.name === 'destination');
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

function entityTypeForEvent(type) {
  return EVENT_ENTITY_TYPE[type] || 'unknown';
}

/**
 * @param {object} client - optional transaction client
 * @param {object} event
 */
async function filterDestinationsForRole(destinations) {
  const cfg = await getInstallationConfig();
  if (!cfg.isMainServer) return destinations;
  const filtered = destinations.filter((d) => d !== 'main');
  return filtered;
}

async function drainLegacyMainDestinationRows() {
  const mainJson = JSON.stringify(['main']);
  const legacySql = db.engine === 'postgres'
    ? `SELECT id, destinations, destinations_done FROM sync_events
       WHERE status IN ('pending', 'failed')
         AND (destination IS NULL OR TRIM(COALESCE(destination::text, '')) = '')
         AND destinations @> $1::jsonb`
    : `SELECT id, destinations, destinations_done FROM sync_events
       WHERE status IN ('pending', 'failed')
         AND (destination IS NULL OR destination = '')
         AND destinations LIKE $1`;
  const legacyParams = db.engine === 'postgres' ? [mainJson] : [`%"main"%`];
  const pending = await db.query(legacySql, legacyParams);

  let drained = 0;
  for (const row of pending.rows) {
    const dests = parseJsonArray(row.destinations);
    if (!dests.includes('main')) continue;
    const done = parseJsonArray(row.destinations_done);
    if (!done.includes('main')) done.push('main');
    const allDone = dests.every((d) => done.includes(d));
    await db.query(
      `UPDATE sync_events
       SET destinations_done = $1,
           status = $2,
           sent_at = CASE WHEN $2 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
           last_error = NULL
       WHERE id = $3`,
      [JSON.stringify(done), allDone ? 'sent' : 'pending', row.id]
    );
    drained += 1;
  }
  return drained;
}

/** HQ already holds canonical data — clear stale city→main rows on single-site installs. */
async function drainRedundantMainQueueOnHq() {
  if (!(await tableExists('sync_events'))) return 0;
  const cfg = await getInstallationConfig();
  if (!cfg.isMainServer) return 0;

  let drained = 0;

  if (await hasDestinationColumn()) {
    const r = await db.query(
      `UPDATE sync_events
       SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL
       WHERE status IN ('pending', 'failed') AND destination = 'main'
       RETURNING id`
    );
    drained += r.rows.length;
  }

  drained += await drainLegacyMainDestinationRows();

  if (drained > 0) {
    console.log(`[OUTBOX] HQ drained ${drained} redundant main destination row(s)`);
  }
  return drained;
}

async function enqueueSyncEvent(client, event) {
  if (!(await tableExists('sync_events'))) return null;

  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const {
    type,
    entityId,
    branchId,
    idempotencyKey,
    payload,
    destinations: requestedDestinations = ['main', 'agt'],
    entityType,
  } = event;

  const destinations = await filterDestinationsForRole(requestedDestinations);
  if (!destinations.length) return null;

  const baseKey = idempotencyKey || `${type}:${entityId || crypto.randomUUID()}`;
  const cityId = event.cityId || (await resolveCityId(branchId));
  const payloadJson = JSON.stringify(payload || {});
  const resolvedEntityType = entityType || entityTypeForEvent(type);
  const usePerDest = await hasDestinationColumn();

  const inserted = [];

  for (const dest of destinations) {
    const key = usePerDest ? `${baseKey}:${dest}` : baseKey;

    const existing = await q(
      `SELECT id, status FROM sync_events WHERE idempotency_key = $1 LIMIT 1`,
      [key]
    );
    if (existing.rows.length > 0) {
      inserted.push(existing.rows[0]);
      continue;
    }

    const id = crypto.randomUUID();
    const destJson = JSON.stringify(usePerDest ? [dest] : destinations);

    if (usePerDest) {
      await q(
        `INSERT INTO sync_events
         (id, event_type, entity_id, entity_type, branch_id, city_id, payload,
          idempotency_key, destination, destinations, status, next_retry_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', CURRENT_TIMESTAMP)`,
        [
          id, type, entityId || null, resolvedEntityType, branchId || null, cityId,
          payloadJson, key, dest, destJson,
        ]
      );
    } else {
      if (inserted.length > 0) continue;
      await q(
        `INSERT INTO sync_events
         (id, event_type, entity_id, branch_id, city_id, payload, idempotency_key, destinations, status, next_retry_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', CURRENT_TIMESTAMP)`,
        [id, type, entityId || null, branchId || null, cityId, payloadJson, key, destJson]
      );
    }

    await logSyncAudit({
      syncEventId: id,
      eventType: type,
      entityType: resolvedEntityType,
      entityId: entityId || null,
      branchId: branchId || null,
      source: 'city_server',
      destination: dest,
      idempotencyKey: key,
      status: 'pending',
    });

    inserted.push({ id, status: 'pending', destination: dest });
  }

  return inserted[0] || null;
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

async function buildCreditNoteSnapshot(client, noteId) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const noteRes = await q('SELECT * FROM credit_notes WHERE id = $1', [noteId]);
  if (!noteRes.rows.length) return null;
  const itemsRes = await q('SELECT * FROM credit_note_items WHERE credit_note_id = $1', [noteId]);
  return { credit_note: noteRes.rows[0], items: itemsRes.rows };
}

async function buildDebitNoteSnapshot(client, noteId) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const noteRes = await q('SELECT * FROM debit_notes WHERE id = $1', [noteId]);
  if (!noteRes.rows.length) return null;
  const itemsRes = await q('SELECT * FROM debit_note_items WHERE debit_note_id = $1', [noteId]);
  return { debit_note: noteRes.rows[0], items: itemsRes.rows };
}

async function enqueueCreditNoteCreated(client, noteId, branchId) {
  const snapshot = await buildCreditNoteSnapshot(client, noteId);
  if (!snapshot) return null;
  return enqueueSyncEvent(client, {
    type: 'credit_note.created',
    entityId: noteId,
    entityType: 'credit_note',
    branchId,
    idempotencyKey: `credit_note:${noteId}`,
    payload: snapshot,
    destinations: ['agt'],
  });
}

async function enqueueDebitNoteCreated(client, noteId, branchId) {
  const snapshot = await buildDebitNoteSnapshot(client, noteId);
  if (!snapshot) return null;
  return enqueueSyncEvent(client, {
    type: 'debit_note.created',
    entityId: noteId,
    entityType: 'debit_note',
    branchId,
    idempotencyKey: `debit_note:${noteId}`,
    payload: snapshot,
    destinations: ['agt'],
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

async function buildPurchaseInvoiceSnapshot(client, invoiceId, stockMovementIds = []) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const invRes = await q(`SELECT * FROM purchase_invoices WHERE id = $1`, [invoiceId]);
  if (!invRes.rows.length) return null;

  let movements = [];
  if (stockMovementIds?.length > 0) {
    if (db.engine === 'postgres') {
      const mRes = await q(
        `SELECT * FROM stock_movements WHERE id = ANY($1::uuid[])`,
        [stockMovementIds]
      );
      movements = mRes.rows;
    } else {
      const placeholders = stockMovementIds.map((_, i) => `$${i + 1}`).join(', ');
      const mRes = await q(
        `SELECT * FROM stock_movements WHERE id IN (${placeholders})`,
        stockMovementIds
      );
      movements = mRes.rows;
    }
  } else {
    const mRes = await q(
      `SELECT * FROM stock_movements WHERE reference_id = $1 ORDER BY created_at`,
      [invoiceId]
    );
    movements = mRes.rows;
  }

  return { purchase: invRes.rows[0], stockMovements: movements };
}

async function enqueuePurchaseInvoiceCreated(client, invoiceId, branchId, stockMovementIds = []) {
  const snapshot = await buildPurchaseInvoiceSnapshot(client, invoiceId, stockMovementIds);
  if (!snapshot) return null;
  return enqueueSyncEvent(client, {
    type: 'purchase_invoice.created',
    entityId: invoiceId,
    branchId,
    idempotencyKey: `purchase:${invoiceId}`,
    payload: snapshot,
    destinations: ['main'],
  });
}

async function enqueueStockMovementCreated(client, movementId, branchId) {
  const q = client?.query ? client.query.bind(client) : db.query.bind(db);
  const mRes = await q(`SELECT * FROM stock_movements WHERE id = $1`, [movementId]);
  if (!mRes.rows.length) return null;
  return enqueueSyncEvent(client, {
    type: 'stock_movement',
    entityId: movementId,
    branchId,
    idempotencyKey: `stock:${movementId}`,
    payload: { movement: mRes.rows[0] },
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

  const destJson = JSON.stringify([destination]);
  const usePerDest = await hasDestinationColumn();

  if (db.engine === 'postgres') {
    const sql = usePerDest
      ? `SELECT * FROM sync_events
         WHERE status IN ('pending', 'failed')
           AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
           AND (
             destination = $1
             OR (
               destination IS NULL
               AND destinations @> $2::jsonb
               AND NOT (COALESCE(destinations_done, '[]'::jsonb) @> $2::jsonb)
             )
           )
         ORDER BY created_at ASC
         LIMIT $3`
      : `SELECT * FROM sync_events
         WHERE status IN ('pending', 'failed')
           AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
           AND destinations @> $1::jsonb
           AND NOT (COALESCE(destinations_done, '[]'::jsonb) @> $1::jsonb)
         ORDER BY created_at ASC
         LIMIT $2`;
    const params = usePerDest ? [destination, destJson, limit] : [destJson, limit];
    const r = await db.query(sql, params);
    return r.rows;
  }

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
    if (usePerDest && row.destination) return row.destination === destination;
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
  const nextRetry = computeNextRetryAt(1);
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

async function markSyncEventSent(id, destination, meta = {}) {
  const row = await db.query(
    `SELECT destination, event_type, entity_id, entity_type, branch_id, idempotency_key
     FROM sync_events WHERE id = $1`,
    [id]
  );
  if (!row.rows.length) return;

  const ev = row.rows[0];
  const dest = destination || ev.destination || 'unknown';

  if (ev.destination) {
    await db.query(
      `UPDATE sync_events SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $1`,
      [id]
    );
  } else if (destination) {
    await markDestinationDone(id, destination);
  } else {
    await db.query(
      `UPDATE sync_events SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = $1`,
      [id]
    );
  }

  await logSyncAudit({
    syncEventId: id,
    eventType: ev.event_type,
    entityType: ev.entity_type,
    entityId: ev.entity_id,
    branchId: ev.branch_id,
    source: meta.source || 'sync_worker',
    destination: dest,
    idempotencyKey: ev.idempotency_key,
    status: 'completed',
  });
}

async function markSyncEventFailed(id, error, attempts, destination, meta = {}) {
  const nextRetry = computeNextRetryAt(attempts);
  const dead = shouldMarkDead(attempts);
  const row = await db.query(
    `SELECT destination, event_type, entity_id, entity_type, branch_id, idempotency_key
     FROM sync_events WHERE id = $1`,
    [id]
  );
  const ev = row.rows[0] || {};
  const dest = destination || ev.destination || 'unknown';

  await db.query(
    `UPDATE sync_events
     SET status = $2,
         attempts = $3,
         last_error = $4,
         next_retry_at = $5
     WHERE id = $1`,
    [id, dead ? 'dead' : 'failed', attempts, String(error).slice(0, 2000), nextRetry]
  );

  await logSyncAudit({
    syncEventId: id,
    eventType: ev.event_type,
    entityType: ev.entity_type,
    entityId: ev.entity_id,
    branchId: ev.branch_id,
    source: meta.source || 'sync_worker',
    destination: dest,
    idempotencyKey: ev.idempotency_key,
    status: 'failed',
    errorMessage: error,
  });

  if (destination) {
    console.warn(`[OUTBOX] ${destination} failed for ${id}:`, error);
  }
}

async function fetchDeadLetterEvents(limit = 50) {
  if (!(await tableExists('sync_events'))) return [];
  const r = await db.query(
    `SELECT id, event_type, entity_id, entity_type, branch_id, destination,
            idempotency_key, attempts, last_error, created_at
     FROM sync_events
     WHERE status = 'dead'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

async function replayDeadLetterEvent(id) {
  const r = await db.query(
    `UPDATE sync_events
     SET status = 'pending', attempts = 0, next_retry_at = CURRENT_TIMESTAMP, last_error = NULL
     WHERE id = $1 AND status = 'dead'
     RETURNING id`,
    [id]
  );
  return r.rows.length > 0;
}

async function resolveDeadLetterEvent(id, note = 'manually resolved') {
  const r = await db.query(
    `UPDATE sync_events
     SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = $2
     WHERE id = $1 AND status = 'dead'
     RETURNING id`,
    [id, String(note).slice(0, 500)]
  );
  return r.rows.length > 0;
}

module.exports = {
  enqueueSyncEvent,
  enqueueSaleCreated,
  enqueueCreditNoteCreated,
  enqueueDebitNoteCreated,
  buildCreditNoteSnapshot,
  buildDebitNoteSnapshot,
  enqueuePaymentCreated,
  enqueuePurchaseInvoiceCreated,
  enqueueStockMovementCreated,
  enqueueJournalPosted,
  buildSaleSnapshot,
  buildPurchaseInvoiceSnapshot,
  drainRedundantMainQueueOnHq,
  fetchPendingForDestination,
  fetchDeadLetterEvents,
  replayDeadLetterEvent,
  resolveDeadLetterEvent,
  markSyncEventSent,
  markSyncEventFailed,
  markDestinationDone,
};
