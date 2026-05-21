/**
 * City → main replicator worker.
 */
const db = require('../db');
const {
  fetchPendingForDestination,
  markSyncEventSent,
  markSyncEventFailed,
} = require('../sync/outbox');
const { getInstallationConfig } = require('../sync/installation');

let intervalHandle = null;
let running = false;

function parseDestinations(row) {
  try {
    const d = typeof row.destinations === 'string' ? JSON.parse(row.destinations) : row.destinations;
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

async function pushEventToMain(mainUrl, apiKey, event) {
  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const res = await fetch(`${mainUrl.replace(/\/$/, '')}/api/sync/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      events: [{
        type: event.event_type,
        idempotencyKey: event.idempotency_key,
        payload,
      }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Main ingest HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

async function runReplicationCycle() {
  if (running) return;
  running = true;
  try {
    const cfg = await getInstallationConfig();
    if (cfg.isMainServer || !cfg.mainApiUrl || !cfg.apiKey) return;

    const events = await fetchPendingForDestination('main', 15);
    for (const event of events) {
      const dests = parseDestinations(event);
      if (!dests.includes('main')) continue;
      try {
        await pushEventToMain(cfg.mainApiUrl, cfg.apiKey, event);
        await markSyncEventSent(event.id, 'main');
      } catch (e) {
        const attempts = Number(event.attempts || 0) + 1;
        await markSyncEventFailed(event.id, e.message, attempts);
        console.warn('[REPLICATOR]', event.event_type, e.message);
      }
    }
  } finally {
    running = false;
  }
}

function startReplicatorWorker(intervalMs = 4000) {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runReplicationCycle().catch((e) => console.warn('[REPLICATOR]', e.message));
  }, intervalMs);
  runReplicationCycle().catch(() => {});
  console.log('[REPLICATOR] City→main worker started');
}

function stopReplicatorWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { startReplicatorWorker, stopReplicatorWorker, runReplicationCycle };
