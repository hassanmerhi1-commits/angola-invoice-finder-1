/**
 * Phase B3 — pull products/clients from city server into client.db cache.
 */
const clientDb = require('./clientDb.cjs');
const syncOutbox = require('./syncOutbox.cjs');

const META_KEY = 'master_data_last_pull';

function loadSyncApiKey() {
  const syncOutboxModule = syncOutbox;
  if (typeof syncOutboxModule.loadClientSyncApiKey === 'function') {
    return syncOutboxModule.loadClientSyncApiKey();
  }
  return '';
}

function syncAuthHeaders() {
  const path = require('path');
  const fs = require('fs');
  const INSTALL_DIR = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const key = (() => {
    for (const file of [path.join(INSTALL_DIR, 'sync.env'), path.join(INSTALL_DIR, 'database.env')]) {
      try {
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
          if (line.trim().startsWith('NEXOR_CLIENT_SYNC_API_KEY=')) {
            return line.split('=').slice(1).join('=').trim();
          }
        }
      } catch (_) {
        /* ignore */
      }
    }
    return '';
  })();
  if (!key) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Sync-Api-Key': key,
  };
}

async function pullMasterData(apiBaseUrl, branchId) {
  if (!clientDb.isOfflineFirstEnabled()) return { skipped: true };
  clientDb.init();
  const database = clientDb.getDb();
  if (!database || !branchId) return { error: 'no db or branchId' };

  const lastRow = database.prepare('SELECT value FROM client_meta WHERE key = ?').get(META_KEY);
  const since = lastRow?.value || '';
  const apiBase = (apiBaseUrl || '').replace(/\/$/, '');
  const q = new URLSearchParams({ branchId });
  if (since) q.set('since', since);

  const res = await fetch(`${apiBase}/api/sync/master-data?${q}`, {
    headers: syncAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { error: `HTTP ${res.status}: ${err.slice(0, 120)}` };
  }
  const body = await res.json();
  const products = (body.products || []).map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    price: p.price,
    cost: p.avg_cost ?? p.cost,
    taxRate: p.tax_rate,
    stock: p.stock,
    branchId: p.branch_id,
  }));
  const r = clientDb.syncProductsCache(products);
  const clients = (body.clients || []).map((c) => ({
    id: c.id,
    name: c.name,
    nif: c.nif,
    phone: c.phone,
    email: c.email,
    address: c.address,
    creditLimit: c.credit_limit ?? c.creditLimit,
    ...c,
  }));
  const clientsResult = clientDb.syncClientsCache(clients);
  clientDb.setWarmBranchId(branchId);
  database.prepare(
    `INSERT INTO client_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(META_KEY, body.generatedAt || new Date().toISOString());

  return {
    ok: true,
    products: r.updated,
    clients: clientsResult.updated,
    generatedAt: body.generatedAt,
  };
}

let timer = null;

function startMasterDataPullWorker(apiBaseResolver, branchIdResolver, intervalMs = 900000) {
  if (timer || !clientDb.isOfflineFirstEnabled()) return;
  const tick = () => {
    const apiBase = typeof apiBaseResolver === 'function' ? apiBaseResolver() : apiBaseResolver;
    const branchId = typeof branchIdResolver === 'function' ? branchIdResolver() : branchIdResolver;
    if (!apiBase || !branchId) return;
    pullMasterData(apiBase, branchId).then((r) => {
      if (r?.ok && r.products > 0) {
        console.log(`[MASTER DATA] Cached ${r.products} product(s)`);
      }
    }).catch(() => {});
  };
  timer = setInterval(tick, intervalMs);
  tick();
}

function stopMasterDataPullWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  pullMasterData,
  startMasterDataPullWorker,
  stopMasterDataPullWorker,
};
