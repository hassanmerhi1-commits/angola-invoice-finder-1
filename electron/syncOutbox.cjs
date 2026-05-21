/**
 * Shop client offline outbox — JSON file queue flushed to city server /api/sync/client-ingest.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INSTALL_DIR = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
const OUTBOX_PATH = path.join(INSTALL_DIR, 'sync-pending.json');

function readOutbox() {
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

function writeOutbox(events) {
  if (!fs.existsSync(INSTALL_DIR)) {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
  }
  fs.writeFileSync(OUTBOX_PATH, JSON.stringify(events, null, 2), 'utf-8');
}

function enqueueEvent(event) {
  const events = readOutbox();
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
  writeOutbox(events);
  return { ok: true, idempotencyKey: key, pending: events.length };
}

function getPendingCount() {
  return readOutbox().filter((e) => e.status === 'pending' || e.status === 'failed').length;
}

function listPending() {
  return readOutbox().filter((e) => e.status === 'pending' || e.status === 'failed');
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

async function flushToServer(apiBaseUrl) {
  const apiBase = apiBaseUrl || process.env.NEXOR_CITY_API_URL || 'http://127.0.0.1:3000';
  const healthy = await checkServerHealth(apiBase);
  if (!healthy) return { flushed: 0, reason: 'server_unreachable' };

  const events = readOutbox();
  let flushed = 0;
  const remaining = [];

  for (const ev of events) {
    if (ev.status === 'sent') continue;
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/sync/client-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        remaining.push(ev);
      }
    } catch (e) {
      ev.attempts = (ev.attempts || 0) + 1;
      ev.status = 'failed';
      ev.lastError = e.message;
      remaining.push(ev);
    }
  }

  const kept = events.filter((e) => e.status !== 'sent');
  writeOutbox(kept);
  return { flushed, pending: kept.length };
}

module.exports = {
  enqueueEvent,
  getPendingCount,
  listPending,
  flushToServer,
  OUTBOX_PATH,
};
