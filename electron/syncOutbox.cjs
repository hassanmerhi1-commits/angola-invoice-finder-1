/**
 * Shop client sync outbox — SQLite (Phase B1) or legacy JSON file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INSTALL_DIR = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
const OUTBOX_PATH = path.join(INSTALL_DIR, 'sync-pending.json');

let clientDb = null;
function getClientDb() {
  if (!clientDb) {
    try {
      clientDb = require('./clientDb.cjs');
    } catch (_) {
      clientDb = null;
    }
  }
  return clientDb;
}

function useSqliteOutbox() {
  const cdb = getClientDb();
  return cdb?.isOfflineFirstEnabled?.() && cdb?.getDb?.();
}

function loadClientSyncApiKey() {
  const fromEnv = (process.env.NEXOR_CLIENT_SYNC_API_KEY || '').trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.join(INSTALL_DIR, 'sync.env'),
    path.join(INSTALL_DIR, 'database.env'),
  ];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"'))
          || (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (key === 'NEXOR_CLIENT_SYNC_API_KEY' && val) return val;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return '';
}

function syncAuthHeaders() {
  const key = loadClientSyncApiKey();
  if (!key) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Sync-Api-Key': key,
  };
}

function readJsonOutbox() {
  try {
    if (fs.existsSync(OUTBOX_PATH)) {
      const data = JSON.parse(fs.readFileSync(OUTBOX_PATH, 'utf-8'));
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {
    console.warn('[SYNC OUTBOX] read error:', e.message);
  }
  return [];
}

function writeJsonOutbox(events) {
  if (!fs.existsSync(INSTALL_DIR)) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTBOX_PATH, JSON.stringify(events, null, 2), 'utf-8');
}

function enqueueEvent(event) {
  const cdb = getClientDb();
  if (useSqliteOutbox() && cdb) {
    cdb.init();
    const database = cdb.getDb();
    const key = event.idempotencyKey || crypto.randomUUID();
    const exists = database.prepare('SELECT id FROM sync_outbox WHERE id = ?').get(key);
    if (exists) return { ok: true, duplicate: true, idempotencyKey: key };
    const eventType = event.type || 'sale.created';
    const entityType = event.entityType || eventType.split('.')[0] || 'sync';
    const entityId =
      event.entityId
      || event.payload?.invoiceData?.id
      || event.payload?.sessionData?.id
      || key;
    database.prepare(
      `INSERT INTO sync_outbox (
        id, event_type, entity_type, entity_id, payload_json, destination, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'CITY_SERVER', 'pending', ?)`
    ).run(
      key,
      eventType,
      entityType,
      String(entityId),
      JSON.stringify(event.payload || {}),
      new Date().toISOString()
    );
    return { ok: true, idempotencyKey: key, pending: cdb.getPendingCount() };
  }

  const events = readJsonOutbox();
  const key = event.idempotencyKey || crypto.randomUUID();
  if (events.some((e) => e.idempotencyKey === key)) {
    return { ok: true, duplicate: true, idempotencyKey: key };
  }
  events.push({
    idempotencyKey: key,
    type: event.type || 'sale.created',
    payload: event.payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
    attempts: 0,
  });
  writeJsonOutbox(events);
  return { ok: true, idempotencyKey: key, pending: events.length };
}

function getPendingCount() {
  const cdb = getClientDb();
  if (useSqliteOutbox() && cdb) {
    cdb.init();
    return cdb.getPendingCount();
  }
  return readJsonOutbox().filter((e) => e.status === 'pending' || e.status === 'failed').length;
}

function listPending() {
  const cdb = getClientDb();
  if (useSqliteOutbox() && cdb) {
    cdb.init();
    return cdb.listPendingSummary();
  }
  return readJsonOutbox().filter((e) => e.status === 'pending' || e.status === 'failed');
}

/** Normalized rows for renderer tooltips / settings UI. */
function listPendingForUi() {
  return listPending().map((row) => {
    if (row && typeof row === 'object' && 'event_type' in row) {
      return {
        id: String(row.id || ''),
        eventType: String(row.event_type || 'sale.created'),
        status: String(row.status || 'pending'),
        lastError: row.last_error ? String(row.last_error) : null,
        createdAt: row.created_at ? String(row.created_at) : null,
        retryCount: Number(row.retry_count || 0),
      };
    }
    return {
      id: String(row.idempotencyKey || row.id || ''),
      eventType: String(row.type || 'sale.created'),
      status: String(row.status || 'pending'),
      lastError: row.lastError || row.last_error ? String(row.lastError || row.last_error) : null,
      createdAt: row.createdAt || row.created_at ? String(row.createdAt || row.created_at) : null,
      retryCount: Number(row.attempts || 0),
    };
  });
}

async function checkServerHealth(apiBase) {
  const url = `${apiBase.replace(/\/$/, '')}/api/health`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    const j = await res.json().catch(() => ({}));
    return j.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function flushSqliteOutbox(apiBase, cdb) {
  const events = cdb.getPendingOutboxEvents('CITY_SERVER');
  let flushed = 0;

  for (const ev of events) {
    let payload;
    try {
      payload = JSON.parse(ev.payload_json);
    } catch {
      cdb.markOutboxFailed(ev.id, 'invalid payload_json', (ev.retry_count || 0) + 1);
      continue;
    }

    const idempotencyKey = payload?.saleData?.clientRequestId
      || payload?.clientRequestId
      || (payload?.invoiceData?.id ? `purchase:${payload.invoiceData.id}` : null)
      || (payload?.sessionData?.id ? `caixa:${payload.sessionData.id}` : null)
      || ev.entity_id
      || ev.id;

    // Heal credit sales queued before clientId was included in the outbox payload.
    if (
      String(ev.event_type || '').includes('sale')
      && payload?.saleData
      && String(payload.saleData.paymentMethod || '').toLowerCase() === 'credit'
      && !payload.saleData.clientId
      && !payload.saleData.client_id
      && ev.entity_id
    ) {
      try {
        const database = cdb.getDb?.();
        const row = database?.prepare?.('SELECT client_id FROM sales WHERE id = ?').get(ev.entity_id);
        const healed = String(row?.client_id || '').trim();
        if (healed) payload.saleData.clientId = healed;
      } catch (_) {
        /* best-effort */
      }
    }

    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/sync/client-ingest`, {
        method: 'POST',
        headers: syncAuthHeaders(),
        body: JSON.stringify({
          events: [{
            type: ev.event_type || 'sale.created',
            idempotencyKey,
            payload,
          }],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        cdb.markOutboxSent(ev.id);
        flushed += 1;
      } else if (res.status === 409) {
        cdb.markOutboxSent(ev.id);
        flushed += 1;
      } else {
        cdb.markOutboxFailed(ev.id, body.error || `HTTP ${res.status}`, (ev.retry_count || 0) + 1);
      }
    } catch (e) {
      cdb.markOutboxFailed(ev.id, e.message, (ev.retry_count || 0) + 1);
    }
  }

  return { flushed, pending: cdb.getPendingCount() };
}

async function flushToServer(apiBaseUrl) {
  const apiBase = apiBaseUrl || process.env.NEXOR_CITY_API_URL || 'http://127.0.0.1:3000';
  const healthy = await checkServerHealth(apiBase);
  if (!healthy) {
    return {
      flushed: 0,
      reason: 'server_unreachable',
      target: apiBase,
      pending: getPendingCount(),
    };
  }

  const cdb = getClientDb();
  if (useSqliteOutbox() && cdb) {
    cdb.init();
    return flushSqliteOutbox(apiBase, cdb);
  }

  const events = readJsonOutbox();
  let flushed = 0;

  for (const ev of events) {
    if (ev.status === 'sent') continue;
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/sync/client-ingest`, {
        method: 'POST',
        headers: syncAuthHeaders(),
        body: JSON.stringify({
          events: [{
            type: ev.type,
            idempotencyKey: ev.idempotencyKey,
            payload: ev.payload,
          }],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        ev.status = 'sent';
        ev.sentAt = new Date().toISOString();
        flushed += 1;
      } else if (res.status === 409) {
        ev.status = 'sent';
        flushed += 1;
      } else {
        ev.attempts = (ev.attempts || 0) + 1;
        ev.status = 'failed';
        ev.lastError = body.error || `HTTP ${res.status}`;
      }
    } catch (e) {
      ev.attempts = (ev.attempts || 0) + 1;
      ev.status = 'failed';
      ev.lastError = e.message;
    }
  }

  const kept = events.filter((e) => e.status !== 'sent');
  writeJsonOutbox(kept);
  return { flushed, pending: kept.length };
}

module.exports = {
  enqueueEvent,
  getPendingCount,
  listPending,
  listPendingForUi,
  flushToServer,
  OUTBOX_PATH,
  useSqliteOutbox,
};
