/**
 * Shop client sync outbox — SQLite (Phase B1) or legacy JSON file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INSTALL_DIR = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
const OUTBOX_PATH = path.join(INSTALL_DIR, 'sync-pending.json');
const PREFERRED_API_PATH = path.join(INSTALL_DIR, 'city-api.base');

let preferredApiBaseMemo = null;
let flushInFlight = null;

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

function isLoopbackApiBase(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function normalizeApiBase(url) {
  const cleaned = String(url || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(cleaned)) return '';
  return cleaned;
}

function getPreferredApiBase() {
  if (preferredApiBaseMemo) return preferredApiBaseMemo;
  try {
    if (fs.existsSync(PREFERRED_API_PATH)) {
      const stored = normalizeApiBase(fs.readFileSync(PREFERRED_API_PATH, 'utf8'));
      if (stored) {
        preferredApiBaseMemo = stored;
        return stored;
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

/** Renderer-reported city API URL — tills often have a working UI URL while setup-config points at localhost. */
function setPreferredApiBase(url) {
  const cleaned = normalizeApiBase(url);
  if (!cleaned) return false;
  if (isLoopbackApiBase(cleaned)) {
    const existing = getPreferredApiBase();
    if (existing && !isLoopbackApiBase(existing)) return false;
  }
  preferredApiBaseMemo = cleaned;
  try {
    if (!fs.existsSync(INSTALL_DIR)) fs.mkdirSync(INSTALL_DIR, { recursive: true });
    fs.writeFileSync(PREFERRED_API_PATH, cleaned, 'utf8');
  } catch {
    /* in-memory is enough for this session */
  }
  return true;
}

function collectApiBases(primary) {
  const list = [];
  const add = (value) => {
    const cleaned = normalizeApiBase(value);
    if (!cleaned || list.includes(cleaned)) return;
    list.push(cleaned);
  };
  add(getPreferredApiBase());
  add(primary);
  add(process.env.NEXOR_CITY_API_URL);
  list.sort((a, b) => Number(isLoopbackApiBase(a)) - Number(isLoopbackApiBase(b)));
  return list.length > 0 ? list : ['http://127.0.0.1:3000'];
}

function syncAuthHeaders(userBearer) {
  const key = loadClientSyncApiKey();
  const bearer = String(userBearer || '').trim();
  if (key) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'X-Sync-Api-Key': key,
    };
  }
  if (bearer && bearer.split('.').length === 3 && !bearer.startsWith('local-')) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
    };
  }
  return { 'Content-Type': 'application/json' };
}

function userJwtHeaders(userBearer) {
  const bearer = String(userBearer || '').trim();
  if (!bearer || bearer.split('.').length !== 3 || bearer.startsWith('local-')) return null;
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearer}`,
  };
}

async function fetchJson(url, opts, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

function ingestRowAccepted(res, body) {
  if (res.status === 409) {
    return { ok: true, invoiceNumber: body.invoiceNumber || body.invoice_number || null };
  }
  const row = Array.isArray(body.results) ? body.results[0] : null;
  if (res.ok && row && row.ok === false) {
    return { ok: false, error: row.error || body.error || `HTTP ${res.status}` };
  }
  if (res.ok && (body.success === true || row?.ok === true || row?.duplicate)) {
    return {
      ok: true,
      invoiceNumber: row?.invoiceNumber || row?.invoice_number || body.invoiceNumber || null,
    };
  }
  if (res.ok && body.success !== false && !row) {
    return { ok: true, invoiceNumber: null };
  }
  return {
    ok: false,
    error: body.error || body.hint || row?.error || `HTTP ${res.status}`,
    status: res.status,
  };
}

async function postClientIngest(apiBase, event, userBearer) {
  const url = `${apiBase.replace(/\/$/, '')}/api/sync/client-ingest`;
  const payload = JSON.stringify({ events: [event] });
  let { res, body } = await fetchJson(url, {
    method: 'POST',
    headers: syncAuthHeaders(userBearer),
    body: payload,
  });
  if (res.status === 401) {
    const jwtHeaders = userJwtHeaders(userBearer);
    if (jwtHeaders && loadClientSyncApiKey()) {
      ({ res, body } = await fetchJson(url, {
        method: 'POST',
        headers: jwtHeaders,
        body: payload,
      }));
    }
  }
  return ingestRowAccepted(res, body);
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

function idempotencyKeyFromSqliteRow(ev, payload) {
  return payload?.saleData?.clientRequestId
    || payload?.clientRequestId
    || (payload?.invoiceData?.id ? `purchase:${payload.invoiceData.id}` : null)
    || (payload?.sessionData?.id ? `caixa:${payload.sessionData.id}` : null)
    || ev.entity_id
    || ev.id;
}

function normalizeOutboxEvent(ev) {
  if (ev && ev.payload_json != null) {
    let payload = {};
    try {
      payload = JSON.parse(ev.payload_json);
    } catch {
      payload = {};
    }
    return {
      type: ev.event_type || 'sale.created',
      idempotencyKey: String(idempotencyKeyFromSqliteRow(ev, payload)),
      payload,
      createdAt: ev.created_at || null,
    };
  }
  return {
    type: ev.type || 'sale.created',
    idempotencyKey: String(ev.idempotencyKey || ev.id || ''),
    payload: ev.payload || {},
    createdAt: ev.createdAt || ev.created_at || null,
  };
}

/** Full pending events for USB nexor-up export (not the UI summary). */
function exportPendingEvents(dateFrom, dateTo) {
  let raw = [];
  const cdb = getClientDb();
  if (useSqliteOutbox() && cdb) {
    cdb.init();
    raw = cdb.getPendingOutboxEvents('CITY_SERVER');
  } else {
    raw = readJsonOutbox().filter((e) => e.status === 'pending' || e.status === 'failed');
  }
  const events = raw.map(normalizeOutboxEvent).filter((e) => e.idempotencyKey);
  const from = String(dateFrom || '').slice(0, 10);
  const to = String(dateTo || '').slice(0, 10);
  const filtered = events.filter((e) => {
    const d = String(e.createdAt || '').slice(0, 10);
    if (!d) return true;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  return { events: filtered, totalPending: events.length };
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

function healCreditSalePayload(cdb, ev, payload) {
  if (
    String(ev.event_type || ev.type || '').includes('sale')
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
}

async function flushSqliteOutbox(apiBase, cdb, userBearer) {
  const events = cdb.getPendingOutboxEvents('CITY_SERVER');
  let flushed = 0;
  const errors = [];
  let networkFail = false;

  for (const ev of events) {
    let payload;
    try {
      payload = JSON.parse(ev.payload_json);
    } catch {
      const msg = 'invalid payload_json';
      cdb.markOutboxFailed(ev.id, msg, (ev.retry_count || 0) + 1);
      errors.push(msg);
      continue;
    }

    const idempotencyKey = payload?.saleData?.clientRequestId
      || payload?.clientRequestId
      || (payload?.invoiceData?.id ? `purchase:${payload.invoiceData.id}` : null)
      || (payload?.sessionData?.id ? `caixa:${payload.sessionData.id}` : null)
      || ev.entity_id
      || ev.id;

    healCreditSalePayload(cdb, ev, payload);

    try {
      const accepted = await postClientIngest(apiBase, {
        type: ev.event_type || 'sale.created',
        idempotencyKey,
        payload,
      }, userBearer);
      if (accepted.ok) {
        cdb.markOutboxSent(ev.id, accepted.invoiceNumber);
        flushed += 1;
      } else {
        const msg = accepted.error || 'ingest failed';
        cdb.markOutboxFailed(ev.id, msg, (ev.retry_count || 0) + 1);
        errors.push(msg);
      }
    } catch (e) {
      networkFail = true;
      const msg = e.name === 'AbortError' ? 'ingest timeout' : (e.message || 'fetch failed');
      cdb.markOutboxFailed(ev.id, msg, (ev.retry_count || 0) + 1);
      errors.push(msg);
    }
  }

  const pending = cdb.getPendingCount();
  return {
    flushed,
    pending,
    target: apiBase,
    reason: flushed > 0
      ? (pending > 0 ? 'partial' : 'ok')
      : (pending > 0 ? (networkFail ? 'server_unreachable' : 'ingest_failed') : 'ok'),
    error: errors[0] || null,
  };
}

async function flushJsonOutbox(apiBase, userBearer) {
  const events = readJsonOutbox();
  let flushed = 0;
  const errors = [];
  let networkFail = false;

  for (const ev of events) {
    if (ev.status === 'sent') continue;
    try {
      const accepted = await postClientIngest(apiBase, {
        type: ev.type,
        idempotencyKey: ev.idempotencyKey,
        payload: ev.payload,
      }, userBearer);
      if (accepted.ok) {
        ev.status = 'sent';
        ev.sentAt = new Date().toISOString();
        flushed += 1;
      } else {
        ev.attempts = (ev.attempts || 0) + 1;
        ev.status = 'failed';
        ev.lastError = accepted.error || 'ingest failed';
        errors.push(ev.lastError);
      }
    } catch (e) {
      networkFail = true;
      ev.attempts = (ev.attempts || 0) + 1;
      ev.status = 'failed';
      ev.lastError = e.name === 'AbortError' ? 'ingest timeout' : e.message;
      errors.push(ev.lastError);
    }
  }

  const kept = events.filter((e) => e.status !== 'sent');
  writeJsonOutbox(kept);
  return {
    flushed,
    pending: kept.length,
    target: apiBase,
    reason: flushed > 0
      ? (kept.length > 0 ? 'partial' : 'ok')
      : (kept.length > 0 ? (networkFail ? 'server_unreachable' : 'ingest_failed') : 'ok'),
    error: errors[0] || null,
  };
}

async function flushToServerInner(apiBaseUrl, options = {}) {
  const userBearer = options.userBearer || options.bearerToken || '';
  const bases = collectApiBases(apiBaseUrl || options.apiBaseUrl);
  let last = {
    flushed: 0,
    pending: getPendingCount(),
    target: bases[0],
    reason: 'server_unreachable',
    error: 'No city API URL',
  };

  const cdb = getClientDb();
  const sqlite = !!(useSqliteOutbox() && cdb);
  if (sqlite) cdb.init();

  for (const apiBase of bases) {
    const result = sqlite
      ? await flushSqliteOutbox(apiBase, cdb, userBearer)
      : await flushJsonOutbox(apiBase, userBearer);
    last = result;
    if (result.pending <= 0 || result.flushed > 0) return result;
    const err = String(result.error || '');
    // Validation / business errors will fail on every host — stop hopping.
    if (result.reason === 'ingest_failed' && /stock|obrigat|invalid|clientid|branch/i.test(err)) {
      return result;
    }
  }

  return last;
}

async function flushToServer(apiBaseUrl, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (typeof apiBaseUrl === 'object' && apiBaseUrl) {
    opts.apiBaseUrl = opts.apiBaseUrl || apiBaseUrl.apiBaseUrl;
    opts.userBearer = opts.userBearer || apiBaseUrl.userBearer || apiBaseUrl.bearerToken;
    apiBaseUrl = apiBaseUrl.apiBaseUrl;
  }
  const persist = opts.persist !== false;
  if (persist) {
    if (opts.apiBaseUrl) setPreferredApiBase(opts.apiBaseUrl);
    else if (apiBaseUrl) setPreferredApiBase(apiBaseUrl);
  }

  if (flushInFlight) return flushInFlight;
  flushInFlight = flushToServerInner(apiBaseUrl, opts).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

module.exports = {
  enqueueEvent,
  getPendingCount,
  listPending,
  listPendingForUi,
  exportPendingEvents,
  flushToServer,
  getPreferredApiBase,
  setPreferredApiBase,
  OUTBOX_PATH,
  useSqliteOutbox,
};
