/**
 * Phase B2 — shop client AGT background worker.
 */
const clientDb = require('./clientDb.cjs');

let timer = null;
let running = false;

function resolveAgtSubmit() {
  const path = require('path');
  const fs = require('fs');
  const candidates = [
    path.join(__dirname, '..', 'backend', 'src', 'clientLocal', 'clientAgtSubmit.js'),
    path.join(process.resourcesPath || '', 'backend', 'src', 'clientLocal', 'clientAgtSubmit.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error('clientAgtSubmit.js not found');
}

async function runAgtCycle() {
  if (running) return { skipped: true };
  if (!clientDb.isOfflineFirstEnabled()) return { skipped: true };

  running = true;
  try {
    clientDb.init();
    const database = clientDb.getDb();
    if (!database) return { error: 'no client db' };

    const { processPendingAgtSubmissions } = resolveAgtSubmit();
    return await processPendingAgtSubmissions(database, 8);
  } catch (e) {
    console.warn('[AGT CLIENT]', e.message);
    return { error: e.message };
  } finally {
    running = false;
  }
}

function startAgtSyncWorker(intervalMs = 5000) {
  if (timer) return;
  if (!clientDb.isOfflineFirstEnabled()) return;

  const tick = () => {
    runAgtCycle().then((r) => {
      if (r?.submitted > 0) {
        console.log(`[AGT CLIENT] Submitted ${r.submitted} invoice(s)${r.simulated ? ' (simulated)' : ''}`);
      }
    }).catch(() => {});
  };

  timer = setInterval(tick, intervalMs);
  tick();
  console.log('[AGT CLIENT] Worker started');
}

function stopAgtSyncWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startAgtSyncWorker,
  stopAgtSyncWorker,
  runAgtCycle,
};
