/**
 * Phase B1 — shop client local SQLite (save-first sales + sync outbox).
 */
const fs = require('fs');
const path = require('path');

const INSTALL_DIR = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
const CLIENT_DB_PATH = path.join(INSTALL_DIR, 'data', 'client.db');

let db = null;
let initError = null;

function resolveBackendSrc(rel) {
  const candidates = [
    path.join(__dirname, '..', 'backend', 'src', rel),
    path.join(process.resourcesPath || '', 'backend', 'src', rel),
    path.join(__dirname, '..', '..', 'backend', 'src', rel),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadBetterSqlite3() {
  const roots = [
    path.join(__dirname, '..', 'backend', 'node_modules', 'better-sqlite3'),
    path.join(process.resourcesPath || '', 'backend', 'node_modules', 'better-sqlite3'),
  ];
  for (const modPath of roots) {
    try {
      if (fs.existsSync(path.join(modPath, 'package.json'))) {
        return require(modPath);
      }
    } catch (_) {
      /* try next */
    }
  }
  return require('better-sqlite3');
}

function readSyncEnvFlag(key) {
  const syncEnv = path.join(INSTALL_DIR, 'sync.env');
  try {
    if (!fs.existsSync(syncEnv)) return null;
    for (const line of fs.readFileSync(syncEnv, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (t.startsWith(`${key}=`)) {
        return t.split('=').slice(1).join('=').trim().toLowerCase();
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function isLanClientInstall() {
  try {
    const ipPath = path.join(INSTALL_DIR, 'IP');
    if (!fs.existsSync(ipPath)) return false;
    const raw = fs.readFileSync(ipPath, 'utf8').trim();
    if (!raw || /\.db$/i.test(raw)) return false;
    // IP / host → client; path ending in .db → server/standalone
    return /^[\w.-]+(?::\d+)?$/.test(raw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(raw);
  } catch (_) {
    return false;
  }
}

function ensureOfflineFirstSyncEnv() {
  const syncEnv = path.join(INSTALL_DIR, 'sync.env');
  try {
    let body = '';
    if (fs.existsSync(syncEnv)) body = fs.readFileSync(syncEnv, 'utf8');
    if (/^NEXOR_OFFLINE_FIRST=/m.test(body)) {
      body = body.replace(/^NEXOR_OFFLINE_FIRST=.*$/m, 'NEXOR_OFFLINE_FIRST=true');
    } else {
      body = `${body.replace(/\s*$/, '')}\nNEXOR_OFFLINE_FIRST=true\n`;
    }
    fs.writeFileSync(syncEnv, body, 'utf8');
  } catch (e) {
    console.warn('[clientDb] ensureOfflineFirstSyncEnv:', e.message);
  }
}

function isOfflineFirstEnabled() {
  const env = String(process.env.NEXOR_OFFLINE_FIRST || '').toLowerCase();
  if (env === 'false' || env === '0' || env === 'no') return false;
  if (env === 'true' || env === '1' || env === 'yes') return true;
  const fileFlag = readSyncEnvFlag('NEXOR_OFFLINE_FIRST');
  if (fileFlag === 'false' || fileFlag === '0' || fileFlag === 'no') return false;
  if (fileFlag === 'true' || fileFlag === '1' || fileFlag === 'yes') return true;
  // Default ON for LAN shop clients (IP file points at server host).
  if (isLanClientInstall()) {
    ensureOfflineFirstSyncEnv();
    return true;
  }
  return false;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS client_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  discount REAL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash',
  amount_paid REAL DEFAULT 0,
  change_amount REAL DEFAULT 0,
  customer_nif TEXT,
  customer_name TEXT,
  client_id TEXT,
  status TEXT DEFAULT 'completed',
  client_request_id TEXT UNIQUE,
  saft_hash TEXT,
  agt_status TEXT DEFAULT 'pending',
  agt_code TEXT,
  pending_sync INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT,
  product_name TEXT,
  sku TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_status ON sync_outbox(status, destination, created_at);

CREATE TABLE IF NOT EXISTS agt_submissions (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  agt_reference TEXT,
  request_json TEXT,
  response_json TEXT,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  submitted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products_cache (
  id TEXT PRIMARY KEY,
  sku TEXT,
  name TEXT,
  price REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  stock REAL DEFAULT 0,
  branch_id TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS clients_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  nif TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  credit_limit REAL DEFAULT 0,
  payload_json TEXT,
  updated_at TEXT
);
`;

function tryAlter(database, sql) {
  try {
    database.exec(sql);
  } catch (_) {
    /* column may exist */
  }
}

function migrateClientSchema(database) {
  tryAlter(database, 'ALTER TABLE agt_submissions ADD COLUMN next_retry_at TEXT');
  tryAlter(database, 'ALTER TABLE sales ADD COLUMN agt_validated_at TEXT');
  tryAlter(database, 'ALTER TABLE sales ADD COLUMN client_id TEXT');
}

function migrateJsonOutboxToDb(database) {
  const jsonPath = path.join(INSTALL_DIR, 'sync-pending.json');
  if (!fs.existsSync(jsonPath)) return 0;
  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!Array.isArray(events)) return 0;
  } catch {
    return 0;
  }

  let migrated = 0;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO sync_outbox (
      id, event_type, entity_type, entity_id, payload_json, destination, status, retry_count, last_error, created_at
    ) VALUES (?, ?, 'sale', ?, ?, 'CITY_SERVER', ?, ?, ?, ?)`
  );

  for (const ev of events) {
    if (ev.status === 'sent') continue;
    const key = ev.idempotencyKey || ev.id;
    if (!key) continue;
    const exists = database.prepare(
      `SELECT 1 FROM sync_outbox WHERE payload_json LIKE ? LIMIT 1`
    ).get(`%${key}%`);
    if (exists) continue;
    insert.run(
      key,
      ev.type || 'sale.created',
      key,
      JSON.stringify(ev.payload || {}),
      ev.status === 'failed' ? 'failed' : 'pending',
      ev.attempts || 0,
      ev.lastError || null,
      ev.createdAt || new Date().toISOString()
    );
    migrated += 1;
  }

  if (migrated > 0) {
    const backup = `${jsonPath}.migrated-${Date.now()}`;
    try {
      fs.renameSync(jsonPath, backup);
      console.log(`[CLIENT DB] Migrated ${migrated} JSON outbox event(s) → client.db; backup: ${backup}`);
    } catch (e) {
      console.warn('[CLIENT DB] JSON outbox migrate backup failed:', e.message);
    }
  }
  return migrated;
}

function init() {
  if (db) return { ok: true, path: CLIENT_DB_PATH };
  if (initError) return { ok: false, error: initError };

  try {
    const dataDir = path.dirname(CLIENT_DB_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const Database = loadBetterSqlite3();
    db = new Database(CLIENT_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA_SQL);
    migrateClientSchema(db);
    migrateJsonOutboxToDb(db);
    console.log('[CLIENT DB] Ready:', CLIENT_DB_PATH);
    return { ok: true, path: CLIENT_DB_PATH };
  } catch (e) {
    initError = e.message;
    console.warn('[CLIENT DB] Init failed:', e.message);
    return { ok: false, error: initError };
  }
}

function getDb() {
  if (!db) init();
  return db;
}

function saveSale(saleData) {
  const database = getDb();
  if (!database) throw new Error(initError || 'Client database unavailable');
  const enginePath = resolveBackendSrc('clientLocal/localSaleEngine.js');
  if (!enginePath) throw new Error('localSaleEngine.js not found');
  const { saveLocalSale } = require(enginePath);
  return saveLocalSale(database, saleData);
}

function syncProductsCache(products) {
  const database = getDb();
  if (!database || !Array.isArray(products)) return { updated: 0 };
  const enginePath = resolveBackendSrc('clientLocal/localSaleEngine.js');
  if (!enginePath) return { updated: 0 };
  const { upsertProductCache } = require(enginePath);
  let updated = 0;
  const tx = database.transaction((list) => {
    for (const p of list) {
      upsertProductCache(database, p);
      updated += 1;
    }
  });
  tx(products);
  return { updated };
}

function listProductsCache(branchId) {
  const database = getDb();
  if (!database) return [];
  try {
    const bid = String(branchId || '').trim();
    if (bid) {
      return database.prepare(
        `SELECT id, sku, name, price, cost, tax_rate AS taxRate, stock, branch_id AS branchId, updated_at AS updatedAt
         FROM products_cache
         WHERE branch_id = ? OR branch_id IS NULL OR TRIM(COALESCE(branch_id, '')) = ''
         ORDER BY name`,
      ).all(bid);
    }
    return database.prepare(
      `SELECT id, sku, name, price, cost, tax_rate AS taxRate, stock, branch_id AS branchId, updated_at AS updatedAt
       FROM products_cache ORDER BY name`,
    ).all();
  } catch (e) {
    console.warn('[CLIENT DB] listProductsCache:', e.message);
    return [];
  }
}

function syncClientsCache(clients) {
  const database = getDb();
  if (!database || !Array.isArray(clients)) return { updated: 0 };
  const upsert = database.prepare(
    `INSERT INTO clients_cache (id, name, nif, phone, email, address, credit_limit, payload_json, updated_at)
     VALUES (@id, @name, @nif, @phone, @email, @address, @credit_limit, @payload_json, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       nif = excluded.nif,
       phone = excluded.phone,
       email = excluded.email,
       address = excluded.address,
       credit_limit = excluded.credit_limit,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
  );
  let updated = 0;
  const now = new Date().toISOString();
  const tx = database.transaction((list) => {
    for (const c of list) {
      const id = String(c.id || '').trim();
      if (!id) continue;
      upsert.run({
        id,
        name: String(c.name || ''),
        nif: String(c.nif || ''),
        phone: String(c.phone || ''),
        email: String(c.email || ''),
        address: String(c.address || ''),
        credit_limit: Number(c.creditLimit ?? c.credit_limit) || 0,
        payload_json: JSON.stringify(c),
        updated_at: now,
      });
      updated += 1;
    }
  });
  tx(clients);
  return { updated };
}

function listClientsCache() {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = database.prepare(
      `SELECT id, name, nif, phone, email, address, credit_limit AS creditLimit, payload_json, updated_at AS updatedAt
       FROM clients_cache ORDER BY name`,
    ).all();
    return rows.map((r) => {
      try {
        if (r.payload_json) return { ...JSON.parse(r.payload_json), id: r.id };
      } catch {
        /* use columns */
      }
      return {
        id: r.id,
        name: r.name,
        nif: r.nif,
        phone: r.phone,
        email: r.email,
        address: r.address,
        creditLimit: r.creditLimit,
      };
    });
  } catch (e) {
    console.warn('[CLIENT DB] listClientsCache:', e.message);
    return [];
  }
}

function setWarmBranchId(branchId) {
  const database = getDb();
  if (!database) return false;
  const id = String(branchId || '').trim();
  if (!id) return false;
  database.prepare(
    `INSERT INTO client_meta (key, value) VALUES ('warm_branch_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(id);
  return true;
}

function getWarmBranchId() {
  const database = getDb();
  if (!database) return null;
  try {
    const row = database.prepare(`SELECT value FROM client_meta WHERE key = 'warm_branch_id'`).get();
    return row?.value ? String(row.value) : null;
  } catch {
    return null;
  }
}

function getPendingOutboxEvents(destination = 'CITY_SERVER') {
  const database = getDb();
  if (!database) return [];
  return database.prepare(
    `SELECT * FROM sync_outbox
     WHERE destination = ? AND status IN ('pending', 'failed')
     ORDER BY created_at ASC`
  ).all(destination);
}

function markOutboxSent(id) {
  const database = getDb();
  if (!database) return;
  const ts = new Date().toISOString();
  database.prepare(
    `UPDATE sync_outbox SET status = 'completed', processed_at = ?, last_error = NULL WHERE id = ?`
  ).run(ts, id);
  const row = database.prepare('SELECT entity_id FROM sync_outbox WHERE id = ?').get(id);
  if (row?.entity_id) {
    database.prepare(
      `UPDATE sales SET pending_sync = 0, synced_at = ? WHERE id = ?`
    ).run(ts, row.entity_id);
  }
}

function markOutboxFailed(id, error, retryCount) {
  const database = getDb();
  if (!database) return;
  database.prepare(
    `UPDATE sync_outbox SET status = 'failed', retry_count = ?, last_error = ? WHERE id = ?`
  ).run(retryCount, String(error).slice(0, 500), id);
}

function getPendingCount() {
  const database = getDb();
  if (!database) return 0;
  const row = database.prepare(
    `SELECT COUNT(*) AS n FROM sync_outbox WHERE status IN ('pending', 'failed')`
  ).get();
  return Number(row?.n || 0);
}

function listPendingSummary() {
  const database = getDb();
  if (!database) return [];
  return database.prepare(
    `SELECT id, event_type, entity_id, destination, status, retry_count, last_error, created_at
     FROM sync_outbox WHERE status IN ('pending', 'failed')
     ORDER BY created_at ASC LIMIT 50`
  ).all();
}

function listLocalSales(branchId) {
  const database = getDb();
  if (!database) return [];
  const enginePath = resolveBackendSrc('clientLocal/localSaleEngine.js');
  if (!enginePath) return [];
  const { listLocalSales: listFn } = require(enginePath);
  return listFn(database, branchId);
}

function getPendingAgtCount() {
  const database = getDb();
  if (!database) return 0;
  try {
    const submitPath = resolveBackendSrc('clientLocal/clientAgtSubmit.js');
    if (submitPath) {
      const { getPendingAgtCount: countFn } = require(submitPath);
      return countFn(database);
    }
  } catch (_) {
    /* ignore */
  }
  const row = database.prepare(
    `SELECT COUNT(*) AS n FROM agt_submissions WHERE status IN ('pending', 'failed', 'retrying')`
  ).get();
  return Number(row?.n || 0);
}

module.exports = {
  CLIENT_DB_PATH,
  init,
  getDb,
  isOfflineFirstEnabled,
  ensureOfflineFirstSyncEnv,
  saveSale,
  syncProductsCache,
  listProductsCache,
  syncClientsCache,
  listClientsCache,
  setWarmBranchId,
  getWarmBranchId,
  getPendingOutboxEvents,
  markOutboxSent,
  markOutboxFailed,
  getPendingCount,
  getPendingAgtCount,
  listPendingSummary,
  listLocalSales,
};
