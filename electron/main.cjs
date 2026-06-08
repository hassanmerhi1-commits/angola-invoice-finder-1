/**
 * NEXOR ERP - Main Process (File DB Edition)
 * 
 * Architecture:
 * - IP file at C:\NEXOR ERP\IP determines mode
 * - Server mode: local .nexor file path → opens local DB file
 * - Client mode: server hostname/IP → connects via WebSocket
 * - Auto-updater via GitHub releases
 * - Multi-company support via companies.json registry
 * 
 * IP file format:
 *   Server: C:\nexor\erp.db
 *   Client: SERVIDOR or 10.0.0.5  (hostname/IP = client mode)
 */

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const backendManager = require('./backendManager.cjs');
const { scanForServers } = require('./discoveryClient.cjs');
const { httpJsonRequest } = require('./httpJson.cjs');
const { httpBinaryRequest } = require('./httpBinary.cjs');

/** Log line when localhost has no unified Express (often better-sqlite3 ABI mismatch). */
function embeddedExpressUnreachableLogLine() {
  let logDir = '';
  try {
    if (app?.isReady?.()) logDir = path.join(app.getPath('userData'), 'logs');
  } catch (_) {}
  const logPart = logDir ? ` Logs: ${logDir}` : '';
  return (
    'Express backend unreachable — embedded ERP HTTP is not answering on this PC.'
    + logPart
    + ' Dev: from repo run "npm run rebuild:backend" then restart. Installed .exe: rebuild installer (npm run electron:build) so backend/node_modules matches Electron; then reinstall.'
  );
}

/** Short text for IPC error payloads (toasts); full help goes to stderr. */
function embeddedExpressUnreachableMessage() {
  try {
    console.error('[DB→Express]', embeddedExpressUnreachableLogLine());
  } catch (_) {}
  let logDir = '';
  try {
    if (app?.isReady?.()) logDir = path.join(app.getPath('userData'), 'logs');
  } catch (_) {}
  return (
    'Cannot save: local ERP server is offline (embedded Express). '
    + (logDir ? `See logs in ${logDir}. ` : '')
    + 'Fix: npm run rebuild:backend in the project, restart; if you use the Windows installer, run npm run electron:build and reinstall.'
  );
}

/** Port for the auto-spawned Express process (SQLite lives there when main-process pool is null). */
function getEmbeddedExpressPort() {
  try {
    const p = backendManager.getPort();
    return typeof p === 'number' && p > 0 && p < 65536 ? p : null;
  } catch {
    return null;
  }
}

/** Same shape as backendManager health: unified ERP /api/health only (not random servers on the port). */
function probeUnifiedExpressHealth(port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let payload = null;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            payload = null;
          }
          const ok =
            res.statusCode === 200
            && payload
            && payload.ok === true
            && payload.unified === true
            && (payload.engine === 'sqlite' || payload.engine === 'postgres');
          resolve(ok);
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Remember a port found by scanning so we do not re-scan every IPC call. */
let cachedExpressProbePort = null;

/**
 * Port for HTTP calls from main → embedded Express when pool is null.
 * Uses backendManager port when set; otherwise probes 3000..3009 (matches renderer getApiUrlAsync).
 */
async function resolveExpressTargetPort(ignoreManagerPort = false) {
  if (!ignoreManagerPort) {
    const managed = getEmbeddedExpressPort();
    if (managed) return managed;
    if (cachedExpressProbePort != null) {
      const ok = await probeUnifiedExpressHealth(cachedExpressProbePort, 500);
      if (ok) return cachedExpressProbePort;
      cachedExpressProbePort = null;
    }
  }
  const probes = [];
  for (let p = 3000; p < 3010; p++) {
    probes.push(probeUnifiedExpressHealth(p, 1100).then((ok) => (ok ? p : null)));
  }
  const hits = await Promise.all(probes);
  const found = hits.find((x) => x != null);
  if (found) cachedExpressProbePort = found;
  return found || null;
}

function performExpressJsonRequest(port, method, pathname, bodyObj) {
  const payload = bodyObj != null ? JSON.stringify(bodyObj) : null;
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
        timeout: 20000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = { error: raw?.slice?.(0, 200) || 'Invalid JSON' };
          }
          resolve({ status: res.statusCode || 0, json });
        });
      }
    );
    req.on('error', (e) => {
      console.warn('[DB→Express]', method, pathname, port, e.message);
      resolve(null);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Brief pause — embedded Express can lag the UI right after spawn or wake-from-sleep. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * If this PC is the DB server (SQLite path in IP file) but Express never bound a port
 * (failed spawn at startup, child crash, etc.), try spawning it again before supplier IPC.
 */
async function ensureEmbeddedBackendRunningIfNeeded() {
  try {
    if (getEmbeddedExpressPort()) return;
    const ipConfig = parseIPFile();
    const { loadDatabaseEnv } = require('./databaseConfig.cjs');
    const dbEnv = loadDatabaseEnv();
    const postgresServer = dbEnv.engine === 'postgres' && !!dbEnv.databaseUrl;
    const sqlitePath = ipConfig.path ? String(ipConfig.path).trim() : null;
    const isLocalServer =
      ipConfig.valid
      && ipConfig.isServer
      && (ipConfig.usePostgres || postgresServer || !!sqlitePath);
    if (!isLocalServer) return;
    console.warn('[DB→Express] Embedded ERP HTTP not listening — starting backend process…');
    cachedExpressProbePort = null;
    const r = await backendManager.start({ mode: 'server', sqlitePath: sqlitePath || null });
    if (r?.started && r.port) {
      await delay(800);
    } else if (r?.error) {
      console.warn('[DB→Express] backendManager.start:', r.error);
    }
  } catch (e) {
    console.warn('[DB→Express] ensureEmbeddedBackendRunningIfNeeded:', e?.message || e);
  }
}

/**
 * Localhost-only JSON call to embedded Express (same DB file as desktop ERP).
 * Retries across transient ECONNREFUSED / race right after backend start.
 */
async function requestExpressJson(method, pathname, bodyObj) {
  await ensureEmbeddedBackendRunningIfNeeded();

  const maxAttempts = 6;
  const pauseMs = 400;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let port = await resolveExpressTargetPort(false);
    if (!port) {
      if (attempt === 1) await ensureEmbeddedBackendRunningIfNeeded();
      if (attempt < maxAttempts - 1) await delay(pauseMs);
      continue;
    }

    let result = await performExpressJsonRequest(port, method, pathname, bodyObj);
    if (result != null) return result;

    cachedExpressProbePort = null;
    port = await resolveExpressTargetPort(true);
    if (!port) {
      if (attempt < maxAttempts - 1) await delay(pauseMs);
      continue;
    }

    result = await performExpressJsonRequest(port, method, pathname, bodyObj);
    if (result != null) return result;

    if (attempt < maxAttempts - 1) await delay(pauseMs);
  }

  return null;
}

ipcMain.on('backend:getPortSync', (event) => {
  const p = backendManager.getPort();
  if (typeof p === 'number' && p > 0 && p < 65536) {
    event.returnValue = p;
    return;
  }
  event.returnValue = 0;
});

ipcMain.on('backend:getHttpOriginSync', (event) => {
  const p = backendManager.getPort();
  event.returnValue = p ? `http://127.0.0.1:${p}` : '';
});

// ============= SINGLE-INSTANCE LOCK (Phase 2) =============
// Prevent a second .exe launch from spawning a duplicate Express backend or
// stealing the same port. Second launch focuses the existing window instead.
// Dev (`npm run electron:dev`) skips the lock so it can run beside the installed app.
const isElectronDev =
  process.env.ELECTRON_DEV === 'true'
  || process.env.NODE_ENV === 'development';
const gotSingleInstanceLock = isElectronDev || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('[Startup] Another NEXOR ERP instance is already running — exiting.');
  app.quit();
  process.exit(0);
}
if (!isElectronDev) {
  app.on('second-instance', () => {
    if (typeof mainWindow !== 'undefined' && mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Backend port chosen by backendManager — exposed to renderer via preload.
let backendPort = null;

function requireRuntimeModule(moduleName) {
  const candidates = [
    () => require(moduleName),
    () => process.resourcesPath ? require(path.join(process.resourcesPath, 'runtime-deps', 'node_modules', moduleName)) : null,
    () => process.resourcesPath ? require(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', moduleName)) : null,
    () => process.resourcesPath ? require(path.join(process.resourcesPath, 'app', 'node_modules', moduleName)) : null,
    () => require(path.join(__dirname, '..', 'node_modules', moduleName)),
  ];

  let lastError = null;
  for (const load of candidates) {
    try {
      const mod = load();
      if (mod) return mod;
    } catch (error) {
      lastError = error;
    }
  }

  console.error(`[Startup] Failed to load runtime module "${moduleName}":`, lastError?.message || 'Unknown error');
  return null;
}

const wsModule = requireRuntimeModule('ws');

class MissingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;

  constructor() {
    throw new Error('Missing "ws" module in this desktop build. Rebuild and reinstall the app.');
  }
}

class MissingWebSocketServer {
  constructor() {
    throw new Error('Missing "ws" module in this desktop build. Rebuild and reinstall the app.');
  }
}

const WebSocket = wsModule?.WebSocket || wsModule || MissingWebSocket;
const WebSocketServer = wsModule?.WebSocketServer || MissingWebSocketServer;

const updaterModule = requireRuntimeModule('electron-updater');

function createNoopAutoUpdater() {
  const fail = () => Promise.reject(new Error('Missing "electron-updater" module in this desktop build.'));
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: console,
    checkForUpdates: fail,
    downloadUpdate: fail,
    quitAndInstall: () => {},
    on: () => {},
  };
}

const autoUpdater = updaterModule?.autoUpdater || createNoopAutoUpdater();

// ============= AUTO-UPDATER CONFIGURATION =============
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = console;

// ============= CONFIGURATION =============
const INSTALL_DIR = 'C:\\NEXOR ERP';
const IP_FILE_PATH = path.join(INSTALL_DIR, 'IP');
const COMPANIES_FILE_PATH = path.join(INSTALL_DIR, 'companies.json');
const WS_PORT = 4546;
const DATA_DIR = path.join(INSTALL_DIR, 'data');
/** Writable default for installed app (avoid C:\\nexor which often needs admin). */
const DEFAULT_NEXOR_PATH = path.join(DATA_DIR, 'erp.db');
const USE_LEGACY_WS = process.env.NEXOR_LEGACY_WS === 'true';
const syncOutbox = require('./syncOutbox.cjs');
const clientDb = require('./clientDb.cjs');
const agtSyncWorker = require('./agtSyncWorker.cjs');
const masterDataPull = require('./masterDataPull.cjs');
let syncOutboxTimer = null;

// Ensure install directory exists
if (!fs.existsSync(INSTALL_DIR)) {
  try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create install directory:', err);
  }
}
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create data directory:', err);
  }
}

function ensureSqliteFileReady(dbFilePath) {
  const p = String(dbFilePath || '').trim();
  if (!p || !/\.db$/i.test(p)) return p;
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[DB] Could not create SQLite directory:', e?.message || e);
  }
  return p;
}

/** Copy an existing SQLite file (and -wal/-shm) when the app moves to a new default path. */
function tryCopySqliteDatabase(fromPath, toPath) {
  const from = path.normalize(String(fromPath || '').trim());
  const to = path.normalize(String(toPath || '').trim());
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return false;
  if (!/\.db$/i.test(from) || !/\.db$/i.test(to)) return false;
  if (!fs.existsSync(from)) return false;

  let fromSize = 0;
  try {
    const st = fs.statSync(from);
    if (!st.isFile() || st.size < 512) return false;
    fromSize = st.size;
  } catch {
    return false;
  }

  let shouldCopy = !fs.existsSync(to);
  if (!shouldCopy) {
    try {
      const destSt = fs.statSync(to);
      // New empty DB after reinstall is usually tiny; keep real data from the old path.
      shouldCopy = destSt.size < Math.min(fromSize * 0.5, 200 * 1024) && fromSize > 50 * 1024;
    } catch {
      shouldCopy = true;
    }
  }
  if (!shouldCopy) return false;

  try {
    ensureSqliteFileReady(to);
    if (fs.existsSync(to)) {
      const bak = `${to}.pre-migrate-${Date.now()}.bak`;
      fs.copyFileSync(to, bak);
      console.log('[DB] Backed up small/empty target DB →', bak);
    }
    fs.copyFileSync(from, to);
    for (const sidecar of ['-wal', '-shm']) {
      const srcSide = from + sidecar;
      if (fs.existsSync(srcSide)) fs.copyFileSync(srcSide, to + sidecar);
    }
    console.log('[DB] Copied SQLite data:', from, '→', to, `(${(fromSize / 1024).toFixed(1)} KB)`);
    return true;
  } catch (e) {
    console.warn('[DB] Could not copy SQLite database:', e?.message || e);
    return false;
  }
}

/** Common locations where data lived before path defaults changed. */
function findLegacySqliteCandidates() {
  const candidates = [path.join('C:\\nexor', 'erp.db')];
  try {
    candidates.push(path.join(app.getPath('userData'), 'erp.db'));
  } catch (_) {}
  try {
    if (fs.existsSync(DATA_DIR)) {
      for (const name of fs.readdirSync(DATA_DIR)) {
        if (/\.db$/i.test(name)) candidates.push(path.join(DATA_DIR, name));
      }
    }
  } catch (_) {}
  const seen = new Set();
  return candidates.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function copyBestLegacySqliteInto(targetPath) {
  const target = path.normalize(String(targetPath || '').trim());
  if (!target) return false;
  let best = null;
  let bestSize = 0;
  for (const candidate of findLegacySqliteCandidates()) {
    if (candidate.toLowerCase() === target.toLowerCase()) continue;
    try {
      if (!fs.existsSync(candidate)) continue;
      const st = fs.statSync(candidate);
      if (!st.isFile() || st.size <= bestSize) continue;
      best = candidate;
      bestSize = st.size;
    } catch (_) {}
  }
  if (!best || bestSize < 50 * 1024) return false;
  return tryCopySqliteDatabase(best, target);
}

/**
 * When several erp.db copies exist (C:\\nexor, AppData, NEXOR ERP\\data), use the largest
 * file so transfers saved to a legacy path are not lost after restart.
 */
function pickCanonicalSqlitePath(preferredPath) {
  const preferred = path.normalize(String(preferredPath || DEFAULT_NEXOR_PATH).trim());
  const seen = new Set();
  const candidates = [];
  for (const p of [preferred, DEFAULT_NEXOR_PATH, ...findLegacySqliteCandidates()]) {
    const key = String(p || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (!st.isFile() || st.size < 512) continue;
      candidates.push({ path: p, size: st.size, mtime: st.mtimeMs });
    } catch (_) {}
  }
  if (candidates.length === 0) return ensureSqliteFileReady(preferred);

  const preferredEntry = candidates.find((c) => c.path.toLowerCase() === preferred.toLowerCase());
  if (preferredEntry && preferredEntry.size > 100 * 1024) {
    return ensureSqliteFileReady(preferred);
  }

  candidates.sort((a, b) => b.size - a.size || b.mtime - a.mtime);
  const picked = candidates[0].path;
  if (picked.toLowerCase() !== preferred.toLowerCase()) {
    console.warn(
      `[DB] Preferred DB missing or empty; using ${picked} (${(candidates[0].size / 1024).toFixed(1)} KB)`,
    );
    try {
      fs.writeFileSync(IP_FILE_PATH, picked, 'utf-8');
    } catch (e) {
      console.warn('[DB] Could not update IP file to canonical DB:', e.message);
    }
  }
  return ensureSqliteFileReady(picked);
}

/** Map legacy .nexor setup paths to a real .db under C:\\NEXOR ERP\\data. */
function migrateNexorPathToDb(nexorPath) {
  const base = path.basename(String(nexorPath || 'erp.nexor'), '.nexor');
  const safe = base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'erp';
  return path.join(DATA_DIR, `${safe}.db`);
}

// Create IP file with default .nexor path if it doesn't exist
if (!fs.existsSync(IP_FILE_PATH)) {
  try {
    fs.writeFileSync(IP_FILE_PATH, DEFAULT_NEXOR_PATH, 'utf-8');
    console.log('Created IP file with default .nexor path at:', IP_FILE_PATH);
  } catch (err) {
    console.error('Failed to create IP file:', err);
  }
}

// ============= GLOBALS =============
let mainWindow = null;
let splashWindow = null;
let purchaseInvoiceWindow = null;
let purchaseProductPickerWindow = null;
let resolveProductPickerSelection = null;
/** @type {any} In-process JSON store shim (not PostgreSQL). */
let pool = null;
let pgConnectionString = null;
let isServerMode = false;
let serverAddress = null;
let wss = null;
let wsClient = null;
let wsReconnectTimer = null;
let wsConnectingPromise = null;
const WS_RECONNECT_DELAY = 3000;
const wsClientCompanies = new WeakMap();

// ============= COMPANY REGISTRY =============
function loadCompaniesRegistry() {
  try {
    if (fs.existsSync(COMPANIES_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(COMPANIES_FILE_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[Companies] Error loading registry:', e);
  }
  return [];
}

function saveCompaniesRegistry(companies) {
  try {
    fs.writeFileSync(COMPANIES_FILE_PATH, JSON.stringify(companies, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('[Companies] Error saving registry:', e);
    return false;
  }
}

function ensureCompaniesRegistry() {
  const companies = loadCompaniesRegistry();
  if (!pgConnectionString) return companies;

  let changed = false;
  let defaultCompany = companies.find(c => c.id === 'company-default');

  if (!defaultCompany) {
    defaultCompany = { id: 'company-default', name: 'Empresa Principal', dbFile: pgConnectionString };
    companies.unshift(defaultCompany);
    changed = true;
  }

  if (changed) saveCompaniesRegistry(companies);
  return companies;
}

// ============= IP FILE PARSING =============
/** Accept `192.168.1.5`, `http://192.168.1.5:3000`, etc. */
function parseClientHostFromIpContent(content) {
  let s = String(content || '').trim().replace(/^\uFEFF/, '');
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '');
  s = s.split(/[/?#]/)[0].trim();
  const withPort = s.match(/^([A-Za-z0-9_\-\.]+):(\d{1,5})$/);
  if (withPort) {
    const port = Number(withPort[2]);
    if (port > 0 && port < 65536) {
      return { host: withPort[1], httpPort: port };
    }
  }
  if (/^[A-Za-z0-9_\-\.]+$/.test(s)) {
    return { host: s, httpPort: null };
  }
  return null;
}

function parseIPFile() {
  try {
    if (!fs.existsSync(IP_FILE_PATH)) {
      return { valid: false, error: 'IP file not found', path: null, isServer: false };
    }
    const content = fs.readFileSync(IP_FILE_PATH, 'utf-8').trim();
    if (!content) {
      return { valid: false, error: 'IP file is empty', path: null, isServer: false };
    }
    // Server mode - file path (.db preferred; legacy .nexor auto-migrates)
    if (/^[A-Za-z]:\\.+\.(nexor|db)$/i.test(content)) {
      if (/\.nexor$/i.test(content)) {
        const dbPath = ensureSqliteFileReady(migrateNexorPathToDb(content));
        console.log('[IP] Legacy .nexor path → SQLite:', dbPath);
        try { fs.writeFileSync(IP_FILE_PATH, dbPath, 'utf-8'); } catch (e) {}
        return { valid: true, path: dbPath, isServer: true };
      }
      let dbPath = ensureSqliteFileReady(content);
      if (/^C:\\nexor\\/i.test(dbPath)) {
        const legacyPath = dbPath;
        dbPath = ensureSqliteFileReady(DEFAULT_NEXOR_PATH);
        tryCopySqliteDatabase(legacyPath, dbPath);
        console.log('[IP] Migrating legacy C:\\nexor path →', dbPath);
        try { fs.writeFileSync(IP_FILE_PATH, dbPath, 'utf-8'); } catch (e) {}
      }
      return { valid: true, path: dbPath, isServer: true };
    }
    // PostgreSQL server — connection string lives in C:\NEXOR ERP\database.env (not IP file)
    if (content.startsWith('postgresql://') || content.startsWith('postgres://')) {
      console.log('[IP] PostgreSQL URL in IP file — use database.env; treating as server (API backend)');
      return { valid: true, path: null, isServer: true, usePostgres: true };
    }
    if (/^postgres$/i.test(content)) {
      return { valid: true, path: null, isServer: true, usePostgres: true };
    }
    // Hostname/IP — client unless it is this machine (common misconfig on server PCs)
    const clientHost = parseClientHostFromIpContent(content);
    if (clientHost?.host) {
      const host = clientHost.host;
      if (isLoopbackOrLocalHost(host)) {
        const dbPath = ensureSqliteFileReady(DEFAULT_NEXOR_PATH);
        copyBestLegacySqliteInto(dbPath);
        console.log('[IP] Local hostname/IP in IP file → server SQLite:', dbPath);
        try { fs.writeFileSync(IP_FILE_PATH, dbPath, 'utf-8'); } catch (_) {}
        return { valid: true, path: dbPath, isServer: true };
      }
      return {
        valid: true,
        path: null,
        isServer: false,
        serverAddress: host,
        httpPort: clientHost.httpPort || null,
      };
    }
    return { valid: false, error: 'Invalid IP file format', path: null, isServer: false };
  } catch (error) {
    return { valid: false, error: error.message, path: null, isServer: false };
  }
}

/** True when this path is the real SQLite file used by Express (better-sqlite3) — must not use JSON .nexor shim. */
function shouldUseSqliteOnly(connectionString) {
  if (!connectionString || typeof connectionString !== 'string') return false;
  const p = connectionString.trim();
  if (/\.db$/i.test(p)) return true;
  if (!fs.existsSync(p)) return false;
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return n >= 16 && buf[15] === 0 && buf.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch {
    return false;
  }
}

// ============= FILE DB OPERATIONS =============
const ERP_TABLES = [
  'users', 'user_permissions', 'user_sessions', 'branches', 'categories', 'products',
  'clients', 'suppliers',
  'chart_of_accounts', 'journal_entries', 'journal_entry_lines',
  'sales', 'sale_items', 'proformas', 'proforma_items',
  'purchase_orders', 'purchase_order_items',
  'purchase_invoices', 'erp_documents',
  'credit_notes', 'credit_note_items', 'debit_notes', 'debit_note_items',
  'receipts', 'payments',
  'stock_movements', 'stock_transfers', 'stock_transfer_items',
  'invoices', 'daily_reports', 'caixas', 'caixa_sessions', 'caixa_transactions',
  'bank_accounts', 'bank_transactions', 'expenses',
  'money_transfers', 'open_items', 'document_links',
  'supplier_returns',
  'settings', 'audit_logs'
];

async function connectPostgres(connectionString) {
  // Kept name for compatibility with existing call sites.
  if (shouldUseSqliteOnly(connectionString)) {
    console.log('[DB] SQLite file reserved for Express — skipping main-process JSON store:', connectionString);
    pool = null;
    return;
  }
  const dir = path.dirname(connectionString);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let state = { tables: {} };
  if (fs.existsSync(connectionString)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(connectionString, 'utf-8'));
      if (parsed && typeof parsed === 'object') state = parsed;
    } catch {}
  }
  if (!state.tables || typeof state.tables !== 'object') state.tables = {};
  const persist = () => fs.writeFileSync(connectionString, JSON.stringify(state, null, 2), 'utf-8');
  persist();

  pool = {
    _state: state,
    _persist: persist,
    async query(sql, params = []) {
      const lower = String(sql || '').trim().toLowerCase();
      if (lower === 'begin' || lower === 'begin transaction') {
        return { rows: [] };
      }
      if (lower === 'commit') {
        persist();
        return { rows: [] };
      }
      if (lower === 'rollback') {
        return { rows: [] };
      }
      if (lower.startsWith('select data from nexor_records where table_name = ? and id = ?')) {
        const [table, id] = params;
        const row = state.tables?.[table]?.[id];
        if (!row) return { rows: [] };
        return { rows: [{ data: JSON.stringify(row) }] };
      }
      if (lower.startsWith('select data from nexor_records where table_name = ?')) {
        const [table] = params;
        const rows = Object.values(state.tables?.[table] || {}).map((entry) => ({ data: JSON.stringify(entry) }));
        return { rows };
      }
      if (lower.startsWith('insert into nexor_records')) {
        const [table, id, data] = params;
        if (!state.tables[table]) state.tables[table] = {};
        let parsed = {};
        try { parsed = JSON.parse(data); } catch {}
        state.tables[table][id] = parsed;
        persist();
        return { rows: [], rowCount: 1 };
      }
      if (lower.startsWith('delete from nexor_records where table_name = ? and id = ?')) {
        const [table, id] = params;
        if (state.tables[table]) delete state.tables[table][id];
        persist();
        return { rows: [], rowCount: 1 };
      }
      if (lower.startsWith('insert into audit_logs')) {
        if (!state.tables.audit_logs) state.tables.audit_logs = {};
        const id = params[0] || ('audit-' + Date.now());
        state.tables.audit_logs[id] = {
          id,
          action: params[1] || null,
          entity_type: params[2] || null,
          entity_id: params[3] || null,
          previous_value: params[4] || null,
          new_value: params[5] || null,
          timestamp: new Date().toISOString(),
        };
        persist();
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
    async connect() {
      return {
        query: async (sql, params = []) => this.query(sql, params),
        release: () => {},
      };
    },
    async end() { try { persist(); } catch {} },
  };

  console.log('[DB] Connected to .nexor file:', connectionString);
  return pool;
}

/** Map IPC/SQLite product row → Express POST/PUT JSON body. */
function mapElectronProductRowToApiBody(data) {
  if (!data) return null;
  const branchRaw = data.branch_id ?? data.branchId;
  return {
    name: data.name || '',
    sku: data.sku || '',
    barcode: data.barcode || '',
    category: data.category_id ?? data.category ?? 'GERAL',
    price: Number(data.price) || 0,
    price2: Number(data.price_2 ?? data.price2) || 0,
    price3: Number(data.price_3 ?? data.price3) || 0,
    price4: Number(data.price_4 ?? data.price4) || 0,
    cost: Number(data.cost) || 0,
    stock: Number(data.stock) || 0,
    unit: data.unit || 'un',
    taxRate: Number(data.tax_rate ?? data.taxRate) || 5,
    branchId: branchRaw && branchRaw !== 'all' ? branchRaw : null,
    isActive: data.is_active !== 0 && data.is_active !== false && data.isActive !== false,
    supplierId: data.supplier_id ?? data.supplierId ?? null,
    supplierName: data.supplier_name ?? data.supplierName ?? null,
  };
}

async function dbGetAll(table) {
  if (!pool) {
    if (table === 'suppliers') {
      const r = await requestExpressJson('GET', '/api/suppliers', null);
      if (r && r.status === 200 && Array.isArray(r.json)) return r.json;
    }
    if (table === 'clients') {
      const r = await requestExpressJson('GET', '/api/clients', null);
      if (r && r.status === 200 && Array.isArray(r.json)) return r.json;
    }
    if (table === 'products') {
      const r = await requestExpressJson('GET', '/api/products', null);
      if (r && r.status === 200 && Array.isArray(r.json)) return r.json;
    }
    if (table === 'supplier_returns') {
      const r = await requestExpressJson('GET', '/api/supplier-returns', null);
      if (r && r.status === 200 && Array.isArray(r.json)) return r.json;
    }
    if (table === 'journal_entries') {
      const r = await requestExpressJson('GET', '/api/journal-entries', null);
      if (r && r.status === 200 && Array.isArray(r.json)) return r.json;
    }
    if (table === 'proformas') {
      const r = await requestExpressJson('GET', '/api/proformas', null);
      if (r && r.status === 200 && Array.isArray(r.json)) return r.json;
    }
    return [];
  }
  try {
    const result = await pool.query(
      'SELECT data FROM nexor_records WHERE table_name = ? ORDER BY updated_at DESC',
      [table]
    );
    return (result.rows || []).map(r => {
      try { return JSON.parse(r.data); } catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function dbGetById(table, id) {
  if (!pool) {
    if (table === 'suppliers') {
      const rows = await dbGetAll('suppliers');
      return rows.find((row) => String(row.id) === String(id)) || null;
    }
    if (table === 'clients') {
      const rows = await dbGetAll('clients');
      return rows.find((row) => String(row.id) === String(id)) || null;
    }
    if (table === 'products') {
      const rows = await dbGetAll('products');
      return rows.find((row) => String(row.id) === String(id)) || null;
    }
    return null;
  }
  try {
    const result = await pool.query(
      'SELECT data FROM nexor_records WHERE table_name = ? AND id = ? LIMIT 1',
      [table, id]
    );
    if (!result.rows.length) return null;
    try { return JSON.parse(result.rows[0].data); } catch { return null; }
  } catch (e) {
    return null;
  }
}

async function dbInsert(table, data, companyId = null) {
  if (!pool) {
    if (table === 'suppliers' && data) {
      const body = {
        name: data.name || '',
        nif: data.nif || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        country: data.country || 'Angola',
        contactPerson: data.contact_person ?? data.contactPerson ?? '',
        paymentTerms: data.payment_terms ?? data.paymentTerms ?? '30_days',
        notes: data.notes || '',
      };
      const r = await requestExpressJson('POST', '/api/suppliers', body);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'insert', r.json.id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'clients' && data) {
      const body = {
        name: data.name || '',
        nif: data.nif || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        country: data.country || data.province || 'Angola',
        creditLimit: Number(data.credit_limit ?? data.creditLimit ?? 0),
        currentBalance: Number(data.balance ?? data.current_balance ?? data.currentBalance ?? 0),
      };
      const r = await requestExpressJson('POST', '/api/clients', body);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'insert', r.json.id, companyId);
        } catch (_) {}
        return { success: true, data: r.json };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'products' && data) {
      if (data.id) {
        const existing = await dbGetById('products', data.id);
        if (existing) {
          return dbUpdate('products', data.id, data, companyId);
        }
      }
      const body = mapElectronProductRowToApiBody(data);
      const r = await requestExpressJson('POST', '/api/products', body);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'insert', r.json.id, companyId);
        } catch (_) {}
        return { success: true, data: r.json };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'supplier_returns' && data) {
      const r = await requestExpressJson('POST', '/api/supplier-returns', data);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'insert', r.json.id, companyId);
        } catch (_) {}
        return { success: true, data: r.json };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    return { success: false, error: 'Database not connected' };
  }
  try {
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO nexor_records (table_name, id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(table_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [table, data.id, JSON.stringify(data), now, now]
    );

    // Audit trail
    if (table !== 'audit_logs' && table !== 'user_sessions') {
      try {
        const auditId = 'audit-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, new_value, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [auditId, 'INSERT', table, data.id || '', JSON.stringify(data)]
        );
      } catch (e) { /* audit table might not exist yet */ }
    }
    broadcastUpdate(table, 'insert', data.id, companyId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function dbUpdate(table, id, data, companyId = null) {
  if (!pool) {
    if (table === 'suppliers' && id && data) {
      const body = {
        name: data.name || '',
        nif: data.nif || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        country: data.country || 'Angola',
        contactPerson: data.contact_person ?? data.contactPerson ?? '',
        paymentTerms: data.payment_terms ?? data.paymentTerms ?? '30_days',
        notes: data.notes || '',
        isActive: data.is_active ?? data.isActive ?? true,
      };
      const r = await requestExpressJson('PUT', `/api/suppliers/${encodeURIComponent(id)}`, body);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'update', id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'clients' && id && data) {
      const body = {
        name: data.name || '',
        nif: data.nif || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        country: data.country || data.province || 'Angola',
        creditLimit: Number(data.credit_limit ?? data.creditLimit ?? 0),
        currentBalance: Number(data.balance ?? data.current_balance ?? data.currentBalance ?? 0),
        isActive: data.is_active ?? data.isActive ?? true,
      };
      const r = await requestExpressJson('PUT', `/api/clients/${encodeURIComponent(id)}`, body);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'update', id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'products' && id && data) {
      const body = mapElectronProductRowToApiBody({ ...data, id });
      const r = await requestExpressJson('PUT', `/api/products/${encodeURIComponent(id)}`, body);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'update', id, companyId);
        } catch (_) {}
        return { success: true, data: r.json };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'supplier_returns' && id && data) {
      const r = await requestExpressJson('PUT', `/api/supplier-returns/${encodeURIComponent(id)}`, data);
      if (r && r.status >= 200 && r.status < 300 && r.json && !r.json.error) {
        try {
          broadcastUpdate(table, 'update', id, companyId);
        } catch (_) {}
        return { success: true, data: r.json };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    return { success: false, error: 'Database not connected' };
  }
  try {
    const existing = await dbGetById(table, id);
    const previousValue = existing;
    const merged = { ...(existing || {}), ...data, id };
    const now = new Date().toISOString();
    await pool.query(
      `INSERT INTO nexor_records (table_name, id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(table_name, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [table, id, JSON.stringify(merged), now, now]
    );

    // Audit trail
    if (table !== 'audit_logs' && table !== 'user_sessions') {
      try {
        const auditId = 'audit-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, previous_value, new_value, timestamp) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [auditId, 'UPDATE', table, id, previousValue ? JSON.stringify(previousValue) : null, JSON.stringify(data)]
        );
      } catch (e) {}
    }
    broadcastUpdate(table, 'update', id, companyId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function dbDelete(table, id, companyId = null) {
  if (!pool) {
    if (table === 'suppliers' && id) {
      const r = await requestExpressJson('DELETE', `/api/suppliers/${encodeURIComponent(id)}`, null);
      if (r && r.status >= 200 && r.status < 300) {
        try {
          broadcastUpdate(table, 'delete', id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'clients' && id) {
      const r = await requestExpressJson('DELETE', `/api/clients/${encodeURIComponent(id)}`, null);
      if (r && r.status >= 200 && r.status < 300) {
        try {
          broadcastUpdate(table, 'delete', id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'products' && id) {
      const r = await requestExpressJson('DELETE', `/api/products/${encodeURIComponent(id)}`, null);
      if (r && r.status >= 200 && r.status < 300) {
        try {
          broadcastUpdate(table, 'delete', id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    if (table === 'proformas' && id) {
      const r = await requestExpressJson('DELETE', `/api/proformas/${encodeURIComponent(id)}`, null);
      if (r && r.status >= 200 && r.status < 300) {
        try {
          broadcastUpdate(table, 'delete', id, companyId);
        } catch (_) {}
        return { success: true };
      }
      const errMsg = r?.json?.error || (r ? `HTTP ${r.status}` : embeddedExpressUnreachableMessage());
      return { success: false, error: errMsg };
    }
    return { success: false, error: 'Database not connected' };
  }
  try {
    const previousValue = await dbGetById(table, id);
    await pool.query(`DELETE FROM nexor_records WHERE table_name = ? AND id = ?`, [table, id]);

    if (table !== 'audit_logs' && table !== 'user_sessions') {
      try {
        const auditId = 'audit-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        await pool.query(
          `INSERT INTO audit_logs (id, action, entity_type, entity_id, previous_value, timestamp) VALUES ($1, $2, $3, $4, $5, NOW())`,
          [auditId, 'DELETE', table, id, previousValue ? JSON.stringify(previousValue) : null]
        );
      } catch (e) {}
    }
    broadcastUpdate(table, 'delete', id, companyId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function dbQuery(sql, params = []) {
  if (!pool) return { success: false, error: 'Database not connected' };
  try {
    const result = await pool.query(sql, params);
    return result.rows || [];
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function dbExportAll() {
  if (!pool) return null;
  const data = { exportedAt: new Date().toISOString() };
  for (const table of ERP_TABLES) {
    try { data[table] = await dbGetAll(table); } catch (e) { data[table] = []; }
  }
  return data;
}

async function dbImportAll(data, companyId = null) {
  if (!pool) return { success: false, error: 'Database not connected' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of ERP_TABLES) {
      if (data[table] && Array.isArray(data[table])) {
        await client.query(`DELETE FROM ${table}`);
        for (const row of data[table]) {
          const keys = Object.keys(row);
          const values = Object.values(row);
          const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`, values);
        }
      }
    }
    await client.query('COMMIT');
    broadcastUpdate('all', 'import', null, companyId);
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

// ============= DATABASE REQUEST HANDLER =============
async function handleDBRequest(request) {
  const { action, table, id, data, sql, params, companyId } = request;

  try {
    switch (action) {
      case 'ping': return { success: true, message: 'pong', isServer: true };
      case 'getAll': return { success: true, data: await dbGetAll(table) };
      case 'getById': return { success: true, data: await dbGetById(table, id) };
      case 'insert': return await dbInsert(table, data, companyId);
      case 'update': return await dbUpdate(table, id, data, companyId);
      case 'delete': return await dbDelete(table, id, companyId);
      case 'query':
        const result = await dbQuery(sql, params || []);
        return Array.isArray(result) ? { success: true, data: result } : result;
      case 'export': return { success: true, data: await dbExportAll() };
      case 'import': return await dbImportAll(data, companyId);
      default: return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============= WEBSOCKET SERVER (SERVER MODE) =============
function startWebSocketServer() {
  if (!USE_LEGACY_WS) {
    console.log('[WS] Legacy port 4546 disabled — use Express Socket.io on HTTP port');
    return { success: true, port: null, legacy: false };
  }
  if (wss) return { success: true, port: WS_PORT };

  try {
    wss = new WebSocketServer({ port: WS_PORT, host: '0.0.0.0' });
    console.log(`✅ WebSocket server running on port ${WS_PORT}`);

    wss.on('connection', (ws, req) => {
      const clientIP = req.socket.remoteAddress;
      console.log(`[WS] Client connected from ${clientIP}`);

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          console.log(`[WS] ← ${msg.action}(${msg.table || ''}) from ${clientIP}`);

          if (msg.action === 'listCompanies') {
            const companies = ensureCompaniesRegistry();
            ws.send(JSON.stringify({ success: true, data: companies, requestId: msg.requestId }));
            return;
          }
          if (msg.action === 'setCompany') {
            wsClientCompanies.set(ws, msg.companyId);
            // Send all table data to new client
            for (const table of ERP_TABLES) {
              try {
                const rows = await dbGetAll(table);
                ws.send(JSON.stringify({ type: 'db-sync', table, rows, companyId: msg.companyId }));
              } catch (e) { /* table might not exist yet */ }
            }
            ws.send(JSON.stringify({ success: true, requestId: msg.requestId }));
            return;
          }

          const response = await handleDBRequest(msg);
          ws.send(JSON.stringify({ ...response, requestId: msg.requestId }));
        } catch (err) {
          ws.send(JSON.stringify({ success: false, error: err.message }));
        }
      });

      ws.on('close', () => console.log(`[WS] Client disconnected: ${clientIP}`));
      ws.on('error', (err) => console.log(`[WS] Client error: ${err.message}`));
    });

    wss.on('error', (err) => { console.error('[WS] Server error:', err); wss = null; });
    return { success: true, port: WS_PORT };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function broadcastTableData(table, companyId = null) {
  let rows = [];
  try { rows = await dbGetAll(table); } catch (e) { return; }
  const message = JSON.stringify({ type: 'db-sync', table, rows, companyId });

  if (wss) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        const clientCompany = wsClientCompanies.get(client);
        if (!companyId || !clientCompany || clientCompany === companyId) {
          client.send(message);
        }
      }
    });
  }
  mainWindow?.webContents.send('erp:sync', { table, rows, companyId });
}

function broadcastUpdate(table, action, id, companyId = null) {
  if (table === 'all') {
    ERP_TABLES.forEach(t => broadcastTableData(t, companyId));
    return;
  }
  broadcastTableData(table, companyId);
}

// ============= WEBSOCKET CLIENT (CLIENT MODE) =============
function connectToServer() {
  if (wsClient && (wsClient.readyState === WebSocket.OPEN || wsClient.readyState === WebSocket.CONNECTING)) return;

  const url = `ws://${serverAddress}:${WS_PORT}`;
  console.log(`[WS] Connecting to server: ${url}`);

  try {
    wsClient = new WebSocket(url);

    wsClient.on('open', () => {
      console.log(`✅ Connected to ERP server: ${serverAddress}`);
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
      try { mainWindow?.webContents.send('erp:updated', { table: 'all', action: 'connected' }); } catch (e) {}
    });

    wsClient.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'db-sync') {
          mainWindow?.webContents.send('erp:sync', { table: msg.table, rows: msg.rows, companyId: msg.companyId });
          return;
        }
        if (msg.type === 'db-updated') {
          mainWindow?.webContents.send('erp:updated', msg);
        }
      } catch (err) {}
    });

    wsClient.on('close', () => { wsClient = null; scheduleReconnect(); });
    wsClient.on('error', (err) => console.error('[WS] Connection error:', err.message));
  } catch (error) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    if (!isServerMode && serverAddress) connectToServer();
  }, WS_RECONNECT_DELAY);
}

function ensureClientConnected(timeoutMs = 10000) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) return Promise.resolve();
  if (!serverAddress) return Promise.reject(new Error('Server address not configured'));
  if (wsConnectingPromise) return wsConnectingPromise;

  if (!wsClient || wsClient.readyState !== WebSocket.CONNECTING) connectToServer();
  const socket = wsClient;

  wsConnectingPromise = new Promise((resolve, reject) => {
    if (!socket) { wsConnectingPromise = null; reject(new Error('WebSocket not initialized')); return; }
    const timer = setTimeout(() => { cleanup(); reject(new Error('Connection timeout')); }, timeoutMs);

    const onOpen = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('Connection closed')); };
    const onError = (err) => { cleanup(); reject(new Error(err?.message || 'Connection error')); };

    const cleanup = () => {
      clearTimeout(timer);
      try { socket.off('open', onOpen); socket.off('close', onClose); socket.off('error', onError); } catch (e) {}
      wsConnectingPromise = null;
    };

    if (socket.readyState === WebSocket.OPEN) { cleanup(); resolve(); return; }
    socket.on('open', onOpen);
    socket.on('close', onClose);
    socket.on('error', onError);
  });

  return wsConnectingPromise;
}

async function sendToServer(request) {
  await ensureClientConnected();
  return new Promise((resolve, reject) => {
    if (!wsClient || wsClient.readyState !== WebSocket.OPEN) { reject(new Error('Not connected')); return; }
    const requestId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const timeout = setTimeout(() => reject(new Error('Request timeout')), 30000);
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.requestId === requestId) { clearTimeout(timeout); wsClient.off('message', handler); resolve(msg); }
      } catch (err) {}
    };
    wsClient.on('message', handler);
    wsClient.send(JSON.stringify({ ...request, requestId }));
  });
}

// ============= OFFLINE SYNC OUTBOX =============
function getCityApiBaseForClient() {
  try {
    const cfgPath = path.join(INSTALL_DIR, 'setup-config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const ip = cfg?.clientConfig?.serverIp;
      const port = cfg?.clientConfig?.httpPort || cfg?.clientConfig?.apiPort || 3000;
      const parsed = parseClientHostFromIpContent(String(ip || ''));
      if (parsed?.host) {
        return `http://${parsed.host}:${parsed.httpPort ?? port}`;
      }
    }
  } catch (_) {}
  if (serverAddress) {
    const parsed = parseClientHostFromIpContent(serverAddress);
    if (parsed?.host) {
      return `http://${parsed.host}:${parsed.httpPort ?? 3000}`;
    }
  }
  return 'http://127.0.0.1:3000';
}

function startSyncOutboxWorker() {
  if (syncOutboxTimer) return;
  const tick = async () => {
    if (isServerMode) return;
    try {
      const apiBase = getCityApiBaseForClient();
      const r = await syncOutbox.flushToServer(apiBase);
      if (r.flushed > 0) {
        console.log(`[SYNC OUTBOX] Flushed ${r.flushed} event(s)`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync:outbox-flushed', r);
        }
      }
    } catch (e) {
      console.warn('[SYNC OUTBOX]', e.message);
    }
  };
  syncOutboxTimer = setInterval(tick, 8000);
  tick();
}

ipcMain.handle('syncOutbox:enqueue', (_, event) => {
  try {
    return { success: true, ...syncOutbox.enqueueEvent(event) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('syncOutbox:pendingCount', () => ({
  count: syncOutbox.getPendingCount(),
}));

ipcMain.handle('syncOutbox:flush', async (_, apiBaseUrl) => {
  try {
    return { success: true, ...(await syncOutbox.flushToServer(apiBaseUrl || getCityApiBaseForClient())) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('clientLocal:isEnabled', () => ({
  enabled: !isServerMode && clientDb.isOfflineFirstEnabled(),
  path: clientDb.CLIENT_DB_PATH,
}));

ipcMain.handle('clientLocal:saveSale', (_, saleData) => {
  try {
    if (!clientDb.isOfflineFirstEnabled()) {
      return { ok: false, error: 'NEXOR_OFFLINE_FIRST is not enabled' };
    }
    clientDb.init();
    const result = clientDb.saveSale(saleData);
    agtSyncWorker.runAgtCycle().catch(() => {});
    syncOutbox.flushToServer(getCityApiBaseForClient()).catch(() => {});
    return { ok: true, ...result };
  } catch (e) {
    console.error('[CLIENT LOCAL] saveSale:', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('clientLocal:syncProducts', (_, products) => {
  try {
    if (!clientDb.isOfflineFirstEnabled()) return { ok: false, updated: 0 };
    clientDb.init();
    return { ok: true, ...clientDb.syncProductsCache(products) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('clientLocal:listPending', () => {
  try {
    clientDb.init();
    return { ok: true, items: clientDb.listPendingSummary() };
  } catch (e) {
    return { ok: false, items: [], error: e.message };
  }
});

ipcMain.handle('clientLocal:listSales', (_, branchId) => {
  try {
    clientDb.init();
    return { ok: true, sales: clientDb.listLocalSales(branchId) };
  } catch (e) {
    return { ok: false, sales: [], error: e.message };
  }
});

ipcMain.handle('clientLocal:agtPendingCount', () => ({
  count: clientDb.getPendingAgtCount(),
}));

ipcMain.handle('clientLocal:runAgtSync', async () => {
  try {
    return { ok: true, ...(await agtSyncWorker.runAgtCycle()) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('clientLocal:pullMasterData', async (_, branchId) => {
  try {
    return { ok: true, ...(await masterDataPull.pullMasterData(getCityApiBaseForClient(), branchId)) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('sync:getApiUrl', async () => getCityApiBaseForClient());

ipcMain.handle('app:setUiLanguage', (_, lang) => {
  persistUiLanguage(lang);
  return true;
});

// ============= SETUP WIZARD SUPPORT =============
ipcMain.handle('setup:getConfig', async () => {
  try {
    const configPath = path.join(INSTALL_DIR, 'setup-config.json');
    let savedConfig = null;
    if (fs.existsSync(configPath)) {
      try {
        savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      } catch (_) {
        savedConfig = null;
      }
    }

    repairIPFileForServerRole();
    const ipConfig = parseIPFile();
    const savedRole = savedConfig?.role;
    const role =
      ipConfig.valid && ipConfig.isServer
        ? 'server'
        : savedRole === 'server'
          ? 'server'
          : ipConfig.valid
            ? 'client'
            : savedRole || null;

    if (ipConfig.valid || savedConfig?.setupComplete) {
      const liveConfig = {
        setupComplete: true,
        role,
        serverConfig: role === 'server'
          ? {
              databasePath: ipConfig.path || savedConfig?.serverConfig?.databasePath || DEFAULT_NEXOR_PATH,
              serverIp: getLocalIP(),
              httpPort: 3000,
              serverPort: WS_PORT,
            }
          : null,
        clientConfig: role === 'client'
          ? { serverIp: ipConfig.serverAddress || savedConfig?.clientConfig?.serverIp, httpPort: 3000, serverPort: WS_PORT }
          : null,
      };

      // Preserve extra saved keys but always overwrite role + DB/server runtime fields.
      const merged = savedConfig
        ? {
            ...savedConfig,
            ...liveConfig,
            serverConfig: { ...(savedConfig.serverConfig || {}), ...(liveConfig.serverConfig || {}) },
            clientConfig: { ...(savedConfig.clientConfig || {}), ...(liveConfig.clientConfig || {}) },
          }
        : liveConfig;

      return {
        success: true,
        config: merged
      };
    }

    if (savedConfig) {
      return { success: true, config: savedConfig };
    }

    return { success: true, config: { setupComplete: false, role: null } };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('setup:saveConfig', async (_, config) => {
  try {
    const configPath = path.join(INSTALL_DIR, 'setup-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // Keep IP file aligned with setup selection (single runtime source of truth).
    if (config?.role === 'server') {
      const requested = String(config?.serverConfig?.databasePath || '').trim();
      const selectedDb = /\.db$/i.test(requested) ? requested : DEFAULT_NEXOR_PATH;
      fs.writeFileSync(IP_FILE_PATH, selectedDb, 'utf-8');
    } else if (config?.role === 'client' && config?.clientConfig?.serverIp) {
      fs.writeFileSync(IP_FILE_PATH, String(config.clientConfig.serverIp), 'utf-8');
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('setup:reset', async () => {
  try {
    const configPath = path.join(INSTALL_DIR, 'setup-config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    fs.writeFileSync(IP_FILE_PATH, '', 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function getLocalIP() {
  const ips = getLocalIPv4Addresses();
  return ips.find((ip) => !ip.startsWith('127.')) || '127.0.0.1';
}

function getLocalIPv4Addresses() {
  const set = new Set(['127.0.0.1', 'localhost']);
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4') set.add(iface.address);
      }
    }
  } catch (_) {}
  return [...set];
}

function isLoopbackOrLocalHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h || h === 'localhost') return true;
  if (h === '127.0.0.1' || h.startsWith('127.')) return true;
  return getLocalIPv4Addresses().some((ip) => ip.toLowerCase() === h);
}

function readSetupConfigFromDisk() {
  try {
    const configPath = path.join(INSTALL_DIR, 'setup-config.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Installed apps often have hostname/IP in the IP file (client format) on the server PC.
 * If setup-config says server, rewrite IP file to the .db path so we spawn embedded Express.
 */
function repairIPFileForServerRole() {
  const saved = readSetupConfigFromDisk();
  if (saved?.role !== 'server') return null;

  const ip = parseIPFile();
  if (ip.valid && ip.isServer && (ip.path || ip.usePostgres)) return ip.path || null;

  const { loadDatabaseEnv } = require('./databaseConfig.cjs');
  const dbEnv = loadDatabaseEnv();
  if (dbEnv.engine === 'postgres' && dbEnv.databaseUrl) {
    try {
      if (!ip.valid || !ip.usePostgres) {
        fs.writeFileSync(IP_FILE_PATH, 'postgres', 'utf-8');
        console.log('[IP] Repaired server IP file → postgres (database.env)');
      }
    } catch (e) {
      console.warn('[IP] Could not write postgres marker:', e.message);
    }
    return null;
  }

  let dbPath = saved?.serverConfig?.databasePath || DEFAULT_NEXOR_PATH;
  if (!/\.db$/i.test(dbPath)) dbPath = DEFAULT_NEXOR_PATH;
  dbPath = ensureSqliteFileReady(dbPath);
  copyBestLegacySqliteInto(dbPath);

  try {
    fs.writeFileSync(IP_FILE_PATH, dbPath, 'utf-8');
    console.log('[IP] Repaired server IP file →', dbPath);
  } catch (e) {
    console.warn('[IP] Could not repair IP file:', e.message);
  }
  return dbPath;
}

function resolveStartupBackendPlan(dbResult) {
  repairIPFileForServerRole();
  const ip = parseIPFile();
  const saved = readSetupConfigFromDisk();
  const { loadDatabaseEnv } = require('./databaseConfig.cjs');
  const dbEnv = loadDatabaseEnv();

  if (dbEnv.engine === 'postgres' && dbEnv.databaseUrl) {
    return { mode: 'server', sqlitePath: null, usePostgres: true };
  }
  if (ip.valid && ip.isServer && ip.usePostgres) {
    return { mode: 'server', sqlitePath: null, usePostgres: true, needsConfig: !!dbEnv.error || !dbEnv.databaseUrl };
  }
  if (dbResult?.mode === 'server' && dbResult?.usePostgres) {
    return { mode: 'server', sqlitePath: null, usePostgres: true, needsConfig: !!dbResult.needsConfig };
  }

  const finalizeSqlite = (rawPath) => {
    const canonical = pickCanonicalSqlitePath(rawPath || DEFAULT_NEXOR_PATH);
    copyBestLegacySqliteInto(canonical);
    try {
      fs.writeFileSync(IP_FILE_PATH, canonical, 'utf-8');
      console.log('[DB] Canonical database path →', canonical);
    } catch (e) {
      console.warn('[DB] Could not write IP file:', e.message);
    }
    return canonical;
  };

  if (ip.valid && ip.isServer && ip.usePostgres) {
    return { mode: 'server', sqlitePath: null, usePostgres: true };
  }
  if (ip.valid && ip.isServer && ip.path) {
    return { mode: 'server', sqlitePath: finalizeSqlite(ip.path) };
  }
  if (saved?.role === 'server') {
    const dbPath = finalizeSqlite(saved?.serverConfig?.databasePath || DEFAULT_NEXOR_PATH);
    try { fs.writeFileSync(IP_FILE_PATH, dbPath, 'utf-8'); } catch (_) {}
    return { mode: 'server', sqlitePath: dbPath };
  }
  if (dbResult?.mode === 'server' && dbResult?.path) {
    return { mode: 'server', sqlitePath: finalizeSqlite(dbResult.path) };
  }
  if (ip.valid && !ip.isServer && ip.serverAddress) {
    return { mode: 'client', sqlitePath: null };
  }
  if (dbResult?.mode === 'client') {
    return { mode: 'client', sqlitePath: null };
  }
  if (dbResult?.needsConfig && dbResult?.mode === 'server' && dbResult?.usePostgres) {
    return { mode: 'server', sqlitePath: null, usePostgres: true, needsConfig: true };
  }
  if (dbResult?.needsConfig || !ip.valid) {
    return { mode: 'standalone', sqlitePath: finalizeSqlite(DEFAULT_NEXOR_PATH) };
  }
  const fallbackDb = finalizeSqlite(ip.valid && ip.path ? ip.path : DEFAULT_NEXOR_PATH);
  return { mode: 'unknown', sqlitePath: fallbackDb };
}

// ============= DATABASE INITIALIZATION =============
async function initDatabase() {
  repairIPFileForServerRole();
  const ipConfig = parseIPFile();
  if (!ipConfig.valid) {
    console.log('IP file not configured:', ipConfig.error);
    return { success: false, error: ipConfig.error, needsConfig: true };
  }

  if (!ipConfig.isServer) {
    isServerMode = false;
    serverAddress = ipConfig.serverAddress;
    pgConnectionString = null;
    console.log('CLIENT MODE: Will connect to', serverAddress);
    if (USE_LEGACY_WS) connectToServer();
    if (clientDb.isOfflineFirstEnabled()) {
      const localInit = clientDb.init();
      if (localInit.ok) {
        console.log('[CLIENT DB] Offline-first enabled:', localInit.path);
      } else {
        console.warn('[CLIENT DB] Offline-first init failed:', localInit.error);
      }
    }
    startSyncOutboxWorker();
    if (clientDb.isOfflineFirstEnabled()) {
      agtSyncWorker.startAgtSyncWorker(5000);
      masterDataPull.startMasterDataPullWorker(
        () => getCityApiBaseForClient(),
        () => process.env.NEXOR_BRANCH_ID || null,
        900000
      );
    }
    return {
      success: true,
      mode: 'client',
      serverAddress,
      offlineFirst: clientDb.isOfflineFirstEnabled(),
      clientDbPath: clientDb.CLIENT_DB_PATH,
    };
  }

  isServerMode = true;
  serverAddress = null;

  const { loadDatabaseEnv } = require('./databaseConfig.cjs');
  const dbEnv = loadDatabaseEnv();
  if (ipConfig.usePostgres || (dbEnv.engine === 'postgres' && dbEnv.databaseUrl)) {
    if (dbEnv.error) {
      return { success: false, error: dbEnv.error, mode: 'server', needsConfig: true };
    }
    if (!dbEnv.databaseUrl) {
      return {
        success: false,
        error: 'Create C:\\NEXOR ERP\\database.env with DATABASE_URL (see database.env.example)',
        mode: 'server',
        needsConfig: true,
      };
    }
    pgConnectionString = null;
    console.log('SERVER MODE: PostgreSQL via database.env');
    try {
      ensureCompaniesRegistry();
      startWebSocketServer();
    } catch (error) {
      console.warn('[Init] WebSocket/registry:', error.message);
    }
    return { success: true, mode: 'server', usePostgres: true, wsPort: WS_PORT };
  }

  // Server mode — legacy Electron SQLite shim (.nexor / erp.db); API uses SQLITE_PATH from backendManager
  pgConnectionString = ipConfig.path || DEFAULT_NEXOR_PATH;

  try {
    if (pool) { await pool.end().catch(() => {}); pool = null; }
    await connectPostgres(pgConnectionString);
    ensureCompaniesRegistry();
    startWebSocketServer();
    console.log('SERVER MODE: Connected to SQLite file', pgConnectionString);
    return { success: true, mode: 'server', path: pgConnectionString, wsPort: WS_PORT };
  } catch (error) {
    console.error('Error initializing database:', error);
    return { success: false, error: error.message, mode: 'server', path: pgConnectionString };
  }
}

// ============= HOT UPDATE SYSTEM =============
function getHotUpdateConfigPath() {
  return path.join(INSTALL_DIR, 'hot-update-config.json');
}

function loadHotUpdateConfig() {
  try {
    const cfgPath = getHotUpdateConfigPath();
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch (e) {}
  return { enabled: false, serverUrl: '', autoConnect: false };
}

function saveHotUpdateConfig(config) {
  try {
    fs.writeFileSync(getHotUpdateConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
    return { success: true, config };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ============= WINDOW CREATION =============
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500, height: 350, frame: false, transparent: true,
    alwaysOnTop: true, resizable: false, skipTaskbar: true,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

function normalizeServerUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function getLocalRendererSource() {
  const possiblePaths = [
    path.join(__dirname, '../dist/index.html'),
    path.join(process.resourcesPath, 'app/dist/index.html'),
    path.join(app.getAppPath(), 'dist/index.html'),
  ];

  for (const possiblePath of possiblePaths) {
    try {
      if (fs.existsSync(possiblePath)) {
        return { type: 'local', path: possiblePath };
      }
    } catch (error) {}
  }

  return { type: 'local', path: possiblePaths[0] };
}

function getRendererSource() {
  const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';
  if (isDev) {
    return { type: 'dev', url: 'http://localhost:18080' };
  }

  const hotUpdate = loadHotUpdateConfig();
  const serverUrl = normalizeServerUrl(hotUpdate.serverUrl);
  if (hotUpdate.enabled && serverUrl) {
    return { type: 'server', url: `${serverUrl}/app`, baseUrl: serverUrl };
  }

  return getLocalRendererSource();
}

function showRendererRecoveryScreen(targetWindow, message) {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>NEXOR ERP</title>
      <style>
        body { font-family: Segoe UI, Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f7fb; color: #121826; }
        .card { width: min(560px, calc(100vw - 32px)); background: white; border: 1px solid #d9deea; border-radius: 16px; padding: 24px; box-shadow: 0 16px 40px rgba(16,24,40,.08); }
        h1 { margin: 0 0 8px; font-size: 24px; }
        p { margin: 0 0 12px; line-height: 1.5; color: #475467; }
        code { display: block; padding: 12px; border-radius: 10px; background: #f2f4f7; color: #101828; overflow-wrap: anywhere; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>NEXOR ERP could not load</h1>
        <p>The desktop app could not open the live update server or packaged app files.</p>
        <p>${String(message || 'Unknown startup error')}</p>
        <code>Tip: disable Hot Updates or start the local backend server on the configured URL.</code>
      </div>
    </body>
  </html>`;
  targetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function loadRendererRoute(targetWindow, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const source = getRendererSource();

  if (source.type === 'dev') {
    const devUrl = `${source.url}/#${normalizedRoute}`;
    const handleDevFail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      targetWindow.webContents.removeListener('did-fail-load', handleDevFail);
      console.error('[Dev] Vite UI failed to load:', errorDescription, validatedURL || devUrl);
      showRendererRecoveryScreen(
        targetWindow,
        `Dev UI not reachable (${errorDescription || errorCode}). `
          + 'Keep this terminal open, ensure "npm run dev" is running on port 18080, then reload (Ctrl+R).',
      );
    };
    targetWindow.webContents.once('did-fail-load', handleDevFail);
    targetWindow.loadURL(devUrl).catch((error) => {
      console.error('[Dev] loadURL failed:', error?.message || error);
      showRendererRecoveryScreen(targetWindow, error?.message || 'Dev UI load failed');
    });
    return;
  }

  if (source.type === 'server') {
    const fallbackSource = getLocalRendererSource();
    let recovered = false;
    // Must match HashRouter (same as dev): route + query live in the fragment, not in pathname.
    // Loading `${base}/purchase-invoices?mode=…` leaves hash empty → blank/wrong screen until reload.
    const baseUrl = String(source.url || '').replace(/\/$/, '');
    const serverLoadUrl = `${baseUrl}/#${normalizedRoute}`;

    const cleanup = () => {
      targetWindow.webContents.removeListener('did-fail-load', handleFail);
      targetWindow.webContents.removeListener('render-process-gone', handleGone);
    };

    const fallbackToLocal = (reason) => {
      if (recovered) return;
      recovered = true;
      cleanup();
      console.warn('[HotUpdate] Server renderer failed, falling back to local bundle:', reason);
      try {
        targetWindow.loadFile(fallbackSource.path, { hash: normalizedRoute });
      } catch (error) {
        console.error('[HotUpdate] Local fallback failed:', error);
        showRendererRecoveryScreen(targetWindow, error?.message || reason);
      }
    };

    const handleFail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      fallbackToLocal(`${errorDescription || 'Load failed'} (${validatedURL || serverLoadUrl})`);
    };

    const handleGone = (_event, details) => {
      fallbackToLocal(details?.reason || 'Renderer process crashed');
    };

    cleanup();
    targetWindow.webContents.once('did-fail-load', handleFail);
    targetWindow.webContents.once('render-process-gone', handleGone);
    targetWindow.loadURL(serverLoadUrl).catch((error) => fallbackToLocal(error?.message || 'loadURL failed'));
    return;
  }

  targetWindow.loadFile(source.path, { hash: normalizedRoute }).catch((error) => {
    console.error('[Renderer] Failed to load local renderer:', error);
    showRendererRecoveryScreen(targetWindow, error?.message || 'Local renderer load failed');
  });
}

function resolvePendingProductPicker(payload) {
  if (!resolveProductPickerSelection) return;
  resolveProductPickerSelection(payload);
  resolveProductPickerSelection = null;
}

function openPurchaseInvoiceWindow() {
  if (purchaseInvoiceWindow && !purchaseInvoiceWindow.isDestroyed()) {
    purchaseInvoiceWindow.show();
    purchaseInvoiceWindow.focus();
    return { success: true };
  }

  purchaseInvoiceWindow = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    skipTaskbar: true,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    autoHideMenuBar: false,
    show: false,
  });

  // Open editor route directly — hash URLs put ?query inside #...; a redirect from
  // /purchase-invoices-window often lost location.search so mode=create never applied.
  loadRendererRoute(purchaseInvoiceWindow, '/purchase-invoices/new');

  // Ensure intent is visible before React mounts (hash/query parsing can lag one frame).
  // Child windows have their own sessionStorage — mirror logged-in session so ProtectedRoute works (same key as useERP.ts).
  purchaseInvoiceWindow.webContents.once('dom-ready', () => {
    purchaseInvoiceWindow.webContents
      .executeJavaScript(
        `try{
          sessionStorage.setItem('kwanzaerp_session_authenticated','1');
          localStorage.setItem('nexor_pi_intent_create_v1',String(Date.now()));
        }catch(e){}`,
        true,
      )
      .catch(() => {});
  });

  purchaseInvoiceWindow.once('ready-to-show', () => {
    purchaseInvoiceWindow.show();
    purchaseInvoiceWindow.focus();
  });

  purchaseInvoiceWindow.on('closed', () => {
    purchaseInvoiceWindow = null;
  });

  return { success: true };
}

function openPurchaseProductPickerWindow(parentWindow) {
  if (purchaseProductPickerWindow && !purchaseProductPickerWindow.isDestroyed()) {
    purchaseProductPickerWindow.show();
    purchaseProductPickerWindow.focus();
    return Promise.resolve({ success: false, error: 'Janela de seleção já está aberta' });
  }

  return new Promise((resolve) => {
    resolveProductPickerSelection = resolve;

    purchaseProductPickerWindow = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 980,
      minHeight: 620,
      parent: parentWindow && !parentWindow.isDestroyed() ? parentWindow : (mainWindow || undefined),
      modal: true,
      icon: path.join(__dirname, '../public/icon.png'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.cjs')
      },
      autoHideMenuBar: false,
      show: false,
    });

    loadRendererRoute(purchaseProductPickerWindow, '/purchase-invoices?mode=product-picker&standalone=1');

    purchaseProductPickerWindow.webContents.once('dom-ready', () => {
      purchaseProductPickerWindow.webContents
        .executeJavaScript(`try{sessionStorage.setItem('kwanzaerp_session_authenticated','1');}catch(e){}`, true)
        .catch(() => {});
    });

    purchaseProductPickerWindow.once('ready-to-show', () => {
      purchaseProductPickerWindow.show();
      purchaseProductPickerWindow.focus();
    });

    purchaseProductPickerWindow.on('closed', () => {
      purchaseProductPickerWindow = null;
      resolvePendingProductPicker({ success: false, cancelled: true });
    });
  });
}

/** User confirmed exit — skip on second close / before-quit pass. */
let quitConfirmed = false;

/** Mirrors renderer `kwanza_language` (en | pt) for native Electron dialogs. */
let cachedUiLanguage = 'pt';

const APP_EXIT_DIALOG = {
  en: {
    title: 'NEXOR ERP',
    message: 'Close the application?',
    detail: 'Are you sure you want to quit NEXOR ERP? Unsaved changes may be lost.',
    cancel: 'Cancel',
    quit: 'Quit',
  },
  pt: {
    title: 'NEXOR ERP',
    message: 'Fechar a aplicação?',
    detail: 'Tem a certeza que deseja sair do NEXOR ERP? Alterações não guardadas podem ser perdidas.',
    cancel: 'Cancelar',
    quit: 'Sair',
  },
};

function uiLanguageFilePath() {
  return path.join(app.getPath('userData'), 'kwanza_language');
}

function persistUiLanguage(lang) {
  if (lang !== 'en' && lang !== 'pt') return;
  cachedUiLanguage = lang;
  try {
    fs.writeFileSync(uiLanguageFilePath(), lang, 'utf8');
  } catch (e) {
    console.warn('[App] could not persist UI language:', e.message);
  }
}

function loadUiLanguageFromDisk() {
  try {
    const file = uiLanguageFilePath();
    if (fs.existsSync(file)) {
      const lang = fs.readFileSync(file, 'utf8').trim();
      if (lang === 'en' || lang === 'pt') cachedUiLanguage = lang;
    }
  } catch (e) {
    console.warn('[App] could not read UI language:', e.message);
  }
}

function confirmAppExit(parentWindow) {
  const copy = APP_EXIT_DIALOG[cachedUiLanguage] || APP_EXIT_DIALOG.pt;
  const win =
    parentWindow && !parentWindow.isDestroyed()
      ? parentWindow
      : BrowserWindow.getFocusedWindow() ||
        (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
  const response = dialog.showMessageBoxSync(win, {
    type: 'warning',
    buttons: [copy.cancel, copy.quit],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: copy.title,
    message: copy.message,
    detail: copy.detail,
  });
  return response === 1;
}

function requestAppExit() {
  if (quitConfirmed) {
    app.quit();
    return;
  }
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (confirmAppExit(parent)) {
    quitConfirmed = true;
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 768,
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs')
    },
    autoHideMenuBar: false,
    show: false
  });

  const menuTemplate = [
    { label: 'NEXOR ERP', submenu: [
      { label: 'About', role: 'about' },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => requestAppExit() }
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ]},
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';
  loadRendererRoute(mainWindow, '/');
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Inject the auto-spawned backend port into the renderer BEFORE React mounts
  // so getApiUrl() in src/lib/api/config.ts picks it up on first call.
  // We re-inject on every load (handles hot-update reloads + navigation).
  const injectBackendPort = () => {
    const port = backendManager.getPort();
    if (port == null) return;
    mainWindow?.webContents
      .executeJavaScript(`window.__KWANZA_BACKEND_PORT__ = ${port};`, true)
      .catch(() => {});
  };
  mainWindow.webContents.on('dom-ready', injectBackendPort);
  mainWindow.webContents.on('did-finish-load', injectBackendPort);

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) { splashWindow.close(); splashWindow = null; }
      mainWindow.show();
      mainWindow.focus();
    }, 1500);
  });

  mainWindow.on('close', (event) => {
    if (quitConfirmed) return;
    event.preventDefault();
    requestAppExit();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ============= APP LIFECYCLE =============
app.whenReady().then(async () => {
  loadUiLanguageFromDisk();
  createSplashWindow();

  // Phase 6: initialize backend log directory under userData (cross-platform).
  // Windows: %APPDATA%\NEXOR ERP\logs
  // macOS:   ~/Library/Application Support/NEXOR ERP/logs
  // Linux:   ~/.config/NEXOR ERP/logs
  try {
    const userLogDir = path.join(app.getPath('userData'), 'logs');
    backendManager.setLogDir(userLogDir);
  } catch (e) {
    console.error('[Init] Could not set log dir:', e?.message || e);
  }

  repairIPFileForServerRole();

  // Initialize database based on IP file
  const dbResult = await initDatabase();
  console.log('[Init] Database result:', dbResult);

  const startupPlan = resolveStartupBackendPlan(dbResult);
  const backendMode = startupPlan.mode;
  const backendSqlitePath = startupPlan.sqlitePath;
  console.log('[Init] Backend plan:', startupPlan);

  // Phase 5: forward backend health events from backendManager → renderer.
  // Single status channel; payload shape: { state, detail?, port?, mode?, code?, fails?, attempts?, ts }
  backendManager.setStatusListener((status) => {
    backendPort = backendManager.getPort();
    try {
      mainWindow?.webContents.send('backend:status', status);
    } catch (_) { /* renderer may be reloading */ }
    const p = backendManager.getPort();
    if (mainWindow && !mainWindow.isDestroyed() && typeof p === 'number' && p > 0 && p < 65536) {
      mainWindow.webContents
        .executeJavaScript(
          `window.__KWANZA_BACKEND_PORT__ = ${p}; try { window.dispatchEvent(new Event('nexor:backend-port')); } catch (_) {}`,
          true
        )
        .catch(() => {});
    }
  });

  // Start Express before loading the UI so the first /api calls are not ECONNREFUSED.
  try {
    const spawnResult = await backendManager.start({ mode: backendMode, sqlitePath: backendSqlitePath });
    if (spawnResult.started) {
      backendPort = spawnResult.port;
      console.log(`[Init] Backend up on port ${backendPort} (mode=${backendMode})`);
      if (spawnResult.warning) {
        console.warn(`[Init] Backend warning: ${spawnResult.warning}`);
      }
      // Give SQLite a moment after /api/health before renderer polls db:getStatus.
      if (backendMode === 'server' || backendMode === 'standalone') {
        await delay(500);
      }
    } else if (spawnResult.skipped) {
      console.log(`[Init] Backend spawn skipped (${spawnResult.reason}) — using remote server`);
    } else if (spawnResult.error) {
      console.warn(`[Init] Backend spawn failed: ${spawnResult.error}`);
    }
  } catch (err) {
    console.error('[Init] Backend spawn threw:', err);
  }

  createWindow();

  // Check for updates (production only)
  const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => console.log('[AutoUpdater] Check failed:', err.message));
    }, 3000);
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// Renderer needs to know which port the backend bound (3000..3009).
ipcMain.handle('backend:getPort', () => backendManager.getPort());
ipcMain.handle('backend:getStatus', () => backendManager.getStatus());

// Phase 6: log folder access for the Settings UI.
ipcMain.handle('backend:getLogDir', () => backendManager.getLogDir() || null);
ipcMain.handle('backend:openLogDir', async () => {
  const dir = backendManager.getLogDir();
  if (!dir) return { success: false, error: 'Log directory not initialized' };
  try {
    // Ensure it exists (first launch may not have written anything yet).
    fs.mkdirSync(dir, { recursive: true });
    const result = await shell.openPath(dir);
    // openPath returns '' on success, or an error string.
    if (result) return { success: false, error: result };
    return { success: true, path: dir };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
});

// Cleanup on quit — stop backend gracefully BEFORE killing WS / pool.
let isQuittingCleanly = false;
app.on('before-quit', async (event) => {
  if (!quitConfirmed) {
    event.preventDefault();
    requestAppExit();
    return;
  }
  if (isQuittingCleanly) return; // second pass after we re-trigger app.quit()
  event.preventDefault();
  isQuittingCleanly = true;
  try {
    if (backendManager.getStatus().running) {
      try { await backendManager.stop(); } catch (e) { console.error('[Quit] backend stop failed:', e); }
    }
    if (wss) { wss.close(); wss = null; }
    if (wsClient) { wsClient.close(); wsClient = null; }
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); }
    if (purchaseProductPickerWindow && !purchaseProductPickerWindow.isDestroyed()) {
      purchaseProductPickerWindow.destroy();
      purchaseProductPickerWindow = null;
    }
    if (purchaseInvoiceWindow && !purchaseInvoiceWindow.isDestroyed()) {
      purchaseInvoiceWindow.destroy();
      purchaseInvoiceWindow = null;
    }
    resolvePendingProductPicker({ success: false, cancelled: true });
    if (pool) { try { await pool.end(); } catch (e) {} }
    try { backendManager.closeLogStream(); } catch (_) {} // Phase 6: flush log file
  } catch (e) {
    console.error('[Quit] cleanup error:', e);
  } finally {
    app.quit();
  }
});

// ============= IPC HANDLERS =============

// IP file operations
ipcMain.handle('ipfile:read', () => {
  try {
    return fs.existsSync(IP_FILE_PATH) ? fs.readFileSync(IP_FILE_PATH, 'utf-8') : '';
  } catch (e) { return ''; }
});

ipcMain.handle('ipfile:write', (_, content) => {
  try {
    fs.writeFileSync(IP_FILE_PATH, content, 'utf-8');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('ipfile:parse', () => parseIPFile());

/** Sync parse for hot paths (API base URL) — avoids trusting stale localStorage vs on-disk IP file. */
ipcMain.on('ipfile:parseSync', (event) => {
  try {
    event.returnValue = JSON.stringify(parseIPFile());
  } catch (e) {
    event.returnValue = JSON.stringify({ valid: false, error: e.message, path: null, isServer: false });
  }
});

// Company management
ipcMain.handle('company:list', () => {
  if (isServerMode) return ensureCompaniesRegistry();
  return sendToServer({ action: 'listCompanies' }).then(r => r.data || []).catch(() => []);
});

ipcMain.handle('company:create', (_, name) => {
  // Multi-company with PostgreSQL would need separate schemas - not supported yet
  return { success: false, error: 'Multi-company requires separate PostgreSQL databases. Contact support.' };
});

ipcMain.handle('company:setActive', async (_, companyId) => {
  if (isServerMode) {
    // Send all table data for this company to renderer
    for (const table of ERP_TABLES) {
      try {
        const rows = await dbGetAll(table);
        mainWindow?.webContents.send('erp:sync', { table, rows, companyId });
      } catch (e) {}
    }
    return { success: true };
  }
  return sendToServer({ action: 'setCompany', companyId });
});

// Database operations (transparently routed)
async function probeRemoteExpressHealth(host, port = 3000, timeoutMs = 2500) {
  const hostname = String(host || '').trim();
  if (!hostname) return false;
  return new Promise((resolve) => {
    const req = http.get(
      { host: hostname, port, path: '/api/health', timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let payload = null;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            payload = null;
          }
          resolve(
            res.statusCode === 200
            && payload?.ok === true
            && payload?.unified === true
          );
        });
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** Scan 3000..3009 on the server PC (matches backendManager port range). */
async function resolveRemoteExpressPort(hostOrEndpoint, preferredPort = 3000, timeoutMs = 2500) {
  const parsed = parseClientHostFromIpContent(String(hostOrEndpoint || '').trim());
  const hostname = parsed?.host || String(hostOrEndpoint || '').trim();
  if (!hostname) return null;
  const ports = [];
  const preferred = Number(parsed?.httpPort ?? preferredPort);
  if (Number.isFinite(preferred) && preferred >= 3000 && preferred < 3010) {
    ports.push(preferred);
  }
  for (let p = 3000; p < 3010; p++) {
    if (!ports.includes(p)) ports.push(p);
  }
  for (const p of ports) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeRemoteExpressHealth(hostname, p, timeoutMs)) return p;
  }
  return null;
}

ipcMain.handle('db:ensureBackend', async () => {
  try {
    await ensureEmbeddedBackendRunningIfNeeded();
    const ip = parseIPFile();
    if ((isServerMode || ip.isServer) && !getEmbeddedExpressPort()) {
      const plan = resolveStartupBackendPlan({ mode: 'server', path: ip.path });
      await backendManager.start({ mode: 'server', sqlitePath: plan.sqlitePath });
      await delay(600);
    }
    const port = await resolveExpressTargetPort(false);
    if (port) return { success: true, port };
    const bm = backendManager.getStatus();
    if (bm.nativeError) {
      return { success: false, error: bm.nativeError };
    }
    return {
      success: false,
      error: 'Database service did not start. Close all NEXOR ERP windows, run scripts/fix-nexor-server-start.ps1, then open the app once and wait 30 seconds.',
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('db:getStatus', async () => {
  if (isServerMode && !getEmbeddedExpressPort()) {
    await ensureEmbeddedBackendRunningIfNeeded();
  }

  let expressPort = await resolveExpressTargetPort(false);
  let expressUp = !!expressPort;

  // Packaged cold start: backend may still be binding — retry health before reporting offline.
  if (!expressUp && (isServerMode || !serverAddress)) {
    for (let i = 0; i < 15 && !expressUp; i++) {
      await delay(500);
      if (i === 3 || i === 8) await ensureEmbeddedBackendRunningIfNeeded();
      expressPort = await resolveExpressTargetPort(false);
      expressUp = !!expressPort;
    }
  }

  const clientHttpOk =
    !isServerMode && !!serverAddress && !!(await resolveRemoteExpressPort(serverAddress));

  const legacyWsOk =
    USE_LEGACY_WS
    && !isServerMode
    && !!serverAddress
    && wsClient?.readyState === WebSocket.OPEN;

  const bm = backendManager.getStatus();
  /** Server: SQLite is in embedded Express (pool is null for .db files). */
  const serverOk = isServerMode && (!!pool || expressUp || (!!bm.running && !!expressPort));

  const standaloneEmbeddedOk = !isServerMode && !serverAddress && expressUp;

  const connected = serverOk || clientHttpOk || legacyWsOk || standaloneEmbeddedOk;

  const mode = isServerMode
    ? 'server'
    : serverAddress
      ? 'client'
      : expressUp
        ? 'standalone'
        : 'unconfigured';

  return {
    success: true,
    mode,
    path: pgConnectionString,
    serverAddress,
    wsPort: WS_PORT,
    connected,
    expressBackend: expressUp,
    expressPort: expressPort || null,
    backendRunning: !!bm.running,
    backendNativeError: bm.nativeError || null,
  };
});

ipcMain.handle('db:init', () => initDatabase());

ipcMain.handle('db:getAll', async (_, table, companyId) => {
  if (isServerMode) {
    return { success: true, data: await dbGetAll(table) };
  }
  return sendToServer({ action: 'getAll', table, companyId });
});

ipcMain.handle('db:getById', async (_, table, id, companyId) => {
  if (isServerMode) {
    return { success: true, data: await dbGetById(table, id) };
  }
  return sendToServer({ action: 'getById', table, id, companyId });
});

ipcMain.handle('db:insert', async (_, table, data, companyId) => {
  if (isServerMode) {
    return await dbInsert(table, data, companyId);
  }
  return sendToServer({ action: 'insert', table, data, companyId });
});

ipcMain.handle('db:update', async (_, table, id, data, companyId) => {
  if (isServerMode) {
    return await dbUpdate(table, id, data, companyId);
  }
  return sendToServer({ action: 'update', table, id, data, companyId });
});

ipcMain.handle('db:delete', async (_, table, id, companyId) => {
  if (isServerMode) {
    return await dbDelete(table, id, companyId);
  }
  return sendToServer({ action: 'delete', table, id, companyId });
});

ipcMain.handle('db:query', async (_, sql, params, companyId) => {
  if (isServerMode) {
    const result = await dbQuery(sql, params || []);
    return Array.isArray(result) ? { success: true, data: result } : result;
  }
  return sendToServer({ action: 'query', sql, params, companyId });
});

ipcMain.handle('db:export', async (_, companyId) => {
  if (isServerMode) {
    return { success: true, data: await dbExportAll() };
  }
  return sendToServer({ action: 'export', companyId });
});

ipcMain.handle('db:import', async (_, data, companyId) => {
  if (isServerMode) {
    return await dbImportAll(data, companyId);
  }
  return sendToServer({ action: 'import', data, companyId });
});

ipcMain.handle('db:create', async () => {
  // PostgreSQL databases are created via Docker/init.sql, not at runtime
  return { success: true, message: 'PostgreSQL database managed by Docker' };
});

ipcMain.handle('db:testConnection', async () => {
  if (isServerMode) {
    try {
      if (pool) {
        await pool.query('SELECT 1');
        return { success: true, mode: 'server' };
      }
      const port = await resolveExpressTargetPort(false);
      if (port) {
        const r = await requestExpressJson('GET', '/api/health', null);
        if (r && r.status === 200 && r.json?.ok !== false) {
          return { success: true, mode: 'server', via: 'express', port };
        }
      }
      return { success: false, mode: 'server', error: 'No database pool and Express backend not reachable' };
    } catch (e) {
      return { success: false, mode: 'server', error: e.message };
    }
  }
  if (!serverAddress) {
    return { success: false, mode: 'client', error: 'Server address not configured' };
  }
  try {
    const httpPort = await resolveRemoteExpressPort(serverAddress, 3000, 5000);
    if (httpPort) {
      return { success: true, mode: 'client', via: 'http', serverAddress, port: httpPort };
    }
    if (USE_LEGACY_WS) {
      const result = await sendToServer({ action: 'ping' });
      return { success: result.success, mode: 'client', via: 'ws' };
    }
    return {
      success: false,
      mode: 'client',
      error: `Cannot reach http://${serverAddress}:3000-3009/api/health — check server IP, firewall, and that NEXOR ERP is running on the server PC`,
    };
  } catch (e) {
    return { success: false, mode: 'client', error: e.message };
  }
});

// Network info
ipcMain.handle('network:getLocalIPs', () => {
  const ips = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
});

ipcMain.handle('network:getInstallPath', () => INSTALL_DIR);
ipcMain.handle('network:getIPFilePath', () => IP_FILE_PATH);
ipcMain.handle('network:getComputerName', () => os.hostname());

ipcMain.handle('discovery:scan', async (_, timeoutMs = 5000) => {
  try {
    const servers = await scanForServers(Number(timeoutMs) || 5000);
    return { success: true, servers };
  } catch (e) {
    return { success: false, servers: [], error: e.message };
  }
});

/** Renderer → LAN server via Node (avoids file:// fetch / CORS issues on client PCs). */
ipcMain.handle('network:httpJson', async (_, opts) => {
  try {
    if (!opts?.url) return { ok: false, status: 0, error: 'url required' };
    return await httpJsonRequest(opts.url, opts);
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
});

/** Binary download/upload (backup .db restore) on LAN clients. */
ipcMain.handle('network:httpBinary', async (_, opts) => {
  try {
    if (!opts?.url) return { ok: false, status: 0, error: 'url required' };
    const result = await httpBinaryRequest(opts.url, opts);
    return {
      ok: result.ok,
      status: result.status,
      contentType: result.contentType,
      body: result.body,
      text: result.text,
      json: result.json,
      error: result.error,
    };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
});

// Purchase windows
ipcMain.handle('purchase:openCreateWindow', () => {
  return openPurchaseInvoiceWindow();
});

ipcMain.handle('purchase:openProductPicker', (event) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return openPurchaseProductPickerWindow(parentWindow);
});

ipcMain.handle('purchase:selectProduct', (_, product) => {
  if (!product || !product.id) {
    return { success: false, error: 'Produto inválido' };
  }

  resolvePendingProductPicker({ success: true, product });

  if (purchaseProductPickerWindow && !purchaseProductPickerWindow.isDestroyed()) {
    purchaseProductPickerWindow.close();
  }

  return { success: true };
});

ipcMain.handle('window:closeCurrent', (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (senderWindow && !senderWindow.isDestroyed()) {
    senderWindow.close();
  }
  return { success: true };
});

// Print support — load HTML via document.write (data: URLs break on large invoices)
ipcMain.handle('print:html', async (_, html, options = {}) => {
  let printWin;
  try {
    printWin = new BrowserWindow({
      show: false,
      width: 900,
      height: 1100,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      modal: !!(mainWindow && !mainWindow.isDestroyed()),
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    await printWin.loadURL('about:blank');
    await printWin.webContents.executeJavaScript(
      `(function () {
        document.open();
        document.write(${JSON.stringify(html)});
        document.close();
      })()`
    );
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Some Windows drivers only show the dialog when the print window exists (can stay behind main window)
    printWin.showInactive();

    await printWin.webContents.print({
      silent: !!options.silent,
      printBackground: true,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  } finally {
    if (printWin && !printWin.isDestroyed()) {
      printWin.close();
    }
  }
});

// Export PDF support — create PDF file without showing print dialog
ipcMain.handle('pdf:saveHtml', async (_, html, options = {}) => {
  let pdfWin;
  try {
    const {
      defaultPath,
      filename = 'report.pdf',
      pageSize = 'A4',
      landscape = false,
    } = options || {};

    const result = await dialog.showSaveDialog({
      title: 'Save PDF',
      defaultPath: defaultPath || filename,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, cancelled: true };
    }

    pdfWin = new BrowserWindow({
      show: false,
      width: 900,
      height: 1100,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      modal: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await pdfWin.loadURL('about:blank');
    await pdfWin.webContents.executeJavaScript(
      `(function () {
        document.open();
        document.write(${JSON.stringify(html)});
        document.close();
      })()`
    );

    // Give layout/fonts a moment to settle
    await new Promise((resolve) => setTimeout(resolve, 600));

    const data = await pdfWin.webContents.printToPDF({
      printBackground: true,
      pageSize,
      landscape: !!landscape,
      margins: { marginType: 'printableArea' },
    });

    await fs.promises.writeFile(result.filePath, data);
    return { success: true, filePath: result.filePath };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) {
      try { pdfWin.close(); } catch (_) { /* ignore */ }
    }
  }
});

// App controls
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
ipcMain.handle('app:version', () => app.getVersion());

// Auto-updater
ipcMain.handle('updater:check', async () => {
  try { await autoUpdater.checkForUpdates(); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('updater:download', async () => {
  try { await autoUpdater.downloadUpdate(); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(); return { success: true }; });
ipcMain.handle('updater:getVersion', () => app.getVersion());

// Auto-updater events → renderer
autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('updater:status', { status: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('updater:status', { status: 'available', version: info.version });
});
autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('updater:status', { status: 'not-available' });
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('updater:status', { status: 'downloading', progress: progress.percent });
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('updater:status', { status: 'downloaded', version: info.version });
});
autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('updater:status', { status: 'error', error: err.message });
});

// Hot update IPC
ipcMain.handle('hotUpdate:getConfig', () => {
  return { success: true, config: loadHotUpdateConfig() };
});
ipcMain.handle('hotUpdate:setConfig', (_, config) => {
  return saveHotUpdateConfig(config);
});
ipcMain.handle('hotUpdate:getSource', () => {
  const source = getRendererSource();
  return { success: true, source: source.type === 'server' ? 'server' : 'local' };
});
ipcMain.handle('hotUpdate:checkServer', async (_, url) => {
  try {
    const baseUrl = normalizeServerUrl(url);
    if (!baseUrl) return { success: false, available: false, error: 'Server URL is required' };

    // Use http/https module for compatibility with all Node.js versions
    const httpModule = baseUrl.startsWith('https') ? require('https') : require('http');
    
    const checkUrl = (endpoint) => new Promise((resolve, reject) => {
      const req = httpModule.get(`${baseUrl}${endpoint}`, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data)); } catch { resolve({ status: 'ok' }); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });

    // Try webapp-version first, then health as fallback
    try {
      const version = await checkUrl('/api/webapp-version');
      return { success: true, available: true, version };
    } catch {
      try {
        const health = await checkUrl('/api/health');
        return { success: true, available: true, version: { version: health.version || 'unknown' } };
      } catch (e2) {
        return { success: false, available: false, error: e2.message };
      }
    }
  } catch (e) {
    return { success: false, available: false, error: e.message };
  }
});
ipcMain.handle('hotUpdate:reload', async () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: 'Main window not available' };
    }
    loadRendererRoute(mainWindow, '/');
    return { success: true, source: getRendererSource().type === 'server' ? 'server' : 'local' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// AGT signing (simplified - crypto only, no external modules needed)
ipcMain.handle('agt:calculate-hash', (_, { data }) => ({
  success: true,
  hash: crypto.createHash('sha256').update(data).digest('hex')
}));

// ============= TRANSACTION ENGINE IPC HANDLERS =============
const txEngine = require('./transactionEngine.cjs');

// Generic transaction wrapper: acquires client, BEGIN/COMMIT/ROLLBACK
async function withTransaction(fn) {
  if (!pool) return { success: false, error: 'Database not connected' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return { success: true, data: result };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { success: false, error: error.message };
  } finally {
    client.release();
  }
}

// Process Sale (atomic: sale + items + stock + journal + open items + tax)
ipcMain.handle('tx:processSale', async (_, saleData) => {
  const result = await withTransaction(client => txEngine.processSale(client, pool, saleData));
  if (result.success) {
    broadcastUpdate('sales', 'insert', result.data?.id);
    broadcastUpdate('products', 'update', null);
  }
  return result;
});

ipcMain.handle('tx:processTransaction', async (_, txData) => {
  const result = await withTransaction(client => txEngine.processTransaction(client, pool, txData));
  if (result.success) {
    if (txData?.stockEntries?.length) {
      broadcastUpdate('products', 'update', null);
    }
    if (txData?.entityBalanceUpdate?.entityType === 'supplier') {
      broadcastUpdate('suppliers', 'update', txData.entityBalanceUpdate.entityId);
    }
    if (txData?.entityBalanceUpdate?.entityType === 'customer') {
      broadcastUpdate('clients', 'update', txData.entityBalanceUpdate.entityId);
    }
  }
  return result;
});

// Process Purchase Receive (atomic: stock IN + WAC + journal + open items)
ipcMain.handle('tx:processPurchaseReceive', async (_, orderId, receivedQuantities, receivedBy) => {
  const result = await withTransaction(client => txEngine.processPurchaseReceive(client, pool, orderId, receivedQuantities, receivedBy));
  if (result.success) {
    broadcastUpdate('purchase_orders', 'update', orderId);
    broadcastUpdate('products', 'update', null);
  }
  return result;
});

// Process Transfer Approve (stock OUT from source)
ipcMain.handle('tx:processTransferApprove', async (_, transferId, approvedBy) => {
  const result = await withTransaction(client => txEngine.processTransferApprove(client, pool, transferId, approvedBy));
  if (result.success) {
    broadcastUpdate('stock_transfers', 'update', transferId);
    broadcastUpdate('products', 'update', null);
  }
  return result;
});

// Process Transfer Receive (stock IN at destination + journal)
ipcMain.handle('tx:processTransferReceive', async (_, transferId, receivedQuantities, receivedBy) => {
  const result = await withTransaction(client => txEngine.processTransferReceive(client, pool, transferId, receivedQuantities, receivedBy));
  if (result.success) {
    broadcastUpdate('stock_transfers', 'update', transferId);
    broadcastUpdate('products', 'update', null);
  }
  return result;
});

// Process Payment (payment + journal + open item clearing)
ipcMain.handle('tx:processPayment', async (_, paymentData) => {
  const result = await withTransaction(client => txEngine.processPayment(client, paymentData));
  if (result.success) broadcastUpdate('payments', 'insert', result.data?.id);
  return result;
});

// Record Stock Movement (standalone)
ipcMain.handle('tx:recordStockMovement', async (_, movementData) => {
  const result = await withTransaction(client => txEngine.recordStockMovement(client, movementData));
  if (result.success) {
    broadcastUpdate('products', 'update', null);
  }
  return result;
});

// Generate invoice number
ipcMain.handle('tx:generateInvoiceNumber', async (_, branchCode) => {
  if (!pool) return { success: false, error: 'Database not connected' };
  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `FT${branchCode || ''}${today}`;
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM sales WHERE invoice_number LIKE $1`,
      [`${prefix}%`]
    );
    const seq = (parseInt(result.rows[0].count) + 1).toString().padStart(4, '0');
    return { success: true, data: { invoiceNumber: `${prefix}${seq}` } };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

console.log('🏢 NEXOR ERP - Main process loaded (Direct PostgreSQL mode)');
console.log(`📁 Install directory: ${INSTALL_DIR}`);
console.log(`📄 IP file: ${IP_FILE_PATH}`);
