/**
 * NEXOR ERP — unified Express server (SQLite or PostgreSQL via ./db.js, all /api routes).
 */
const path = require('path');
const fs = require('fs');

/** Load C:\NEXOR ERP\database.env before db.js reads DATABASE_URL / DB_ENGINE. */
function loadInstallDatabaseEnv() {
  const installDir = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';
  const envPath = path.join(installDir, 'database.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

loadInstallDatabaseEnv();
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');

require('./db');
const db = require('./db');
const { lanCors, securityHeaders, rateLimiter, apiAuthGate } = require('./middleware/security');
const { DiscoveryBroadcaster } = require('./discovery');

const { readAppVersion, EXPECTED_SCHEMA_VERSION, recordAppMetaForDb, readSchemaVersionFromDb } = require('./lib/deploymentStatus');
const { buildSchemaChecks } = require('./lib/schemaChecks');

const PORT = Number(process.env.PORT) || 3000;
const APP_VERSION = readAppVersion();

function readBackendPackageVersion() {
  try {
    const pkgPath = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null;
    }
  } catch (_) {}
  return null;
}
const BACKEND_PACKAGE_VERSION = readBackendPackageVersion();
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
});

function broadcastTable(table, entityId = null) {
  try {
    io.emit('table-update', { table, ts: Date.now(), entityId });
  } catch (_) {}
}

const discoveryBroadcaster = new DiscoveryBroadcaster(PORT, {
  name: process.env.SERVER_NAME || 'NEXOR ERP Server',
  version: APP_VERSION,
  branch: process.env.BRANCH_NAME || null,
});

app.use(lanCors);
app.use(securityHeaders);
app.use(rateLimiter(60000, 800, 8000));
app.use(express.json({ limit: '10mb' }));

const webappPath = path.join(__dirname, '../webapp');
if (!fs.existsSync(webappPath)) fs.mkdirSync(webappPath, { recursive: true });
app.use('/app', express.static(webappPath));
app.get(/^\/app(?:\/.*)?$/, (req, res) => {
  const indexPath = path.join(webappPath, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).json({ error: 'Webapp not deployed' });
});

/** Fast ping for Electron health monitor — avoid heavy queries while SQLite is busy. */
app.get('/api/health', async (req, res) => {
  const lite = req.query.lite === '1' || req.query.lite === 'true';
  const fs = require('fs');
  const path = require('path');
  const hasCertificationDemoProfile = fs.existsSync(
    path.join(__dirname, 'lib', 'certificationDemoProfile.js'),
  );
  try {
    const row = await db.query(db.engine === 'postgres' ? 'SELECT NOW() AS now' : "SELECT datetime('now') AS now");
    const schema = await readSchemaVersionFromDb(db);
    const schemaChecks = await buildSchemaChecks(db);
    const payload = {
      ok: true,
      engine: db.engine || 'sqlite',
      time: row.rows[0]?.now,
      unified: true,
      appVersion: APP_VERSION,
      backendPackageVersion: BACKEND_PACKAGE_VERSION,
      shellVersion: process.env.NEXOR_APP_VERSION || null,
      backendEntry: process.env.NEXOR_BACKEND_ENTRY || null,
      installDir: process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP',
      features: {
        certificationDemoProfile: hasCertificationDemoProfile,
      },
      schemaVersion: schema.stored,
      schemaVersionExpected: EXPECTED_SCHEMA_VERSION,
      schemaUpToDate: schema.stored == null ? null : schema.stored >= EXPECTED_SCHEMA_VERSION,
      databaseEnvConfigured: fs.existsSync(path.join(process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP', 'database.env')),
      postgresConfigured: db.engine === 'postgres',
      schemaChecks,
      dbPath: db.engine === 'sqlite' ? db.dbPath : undefined,
    };
    if (schema.stored != null && schema.stored < EXPECTED_SCHEMA_VERSION) {
      payload.schemaRepairHint = db.engine === 'postgres'
        ? 'PostgreSQL schema is behind. On the SERVER PC (not LAN clients): install the latest NEXOR-ERP-x64.exe, run fix-server-schema.cmd in C:\\NEXOR ERP, then restart NEXOR. Check health on the server IP (e.g. http://192.168.x.x:3000/api/health), not a client PC.'
        : 'Backend is using local SQLite (schema 42 is normal here). For production data, configure C:\\NEXOR ERP\\database.env and set C:\\NEXOR ERP\\IP to postgres, then restart.';
    } else if (
      BACKEND_PACKAGE_VERSION
      && APP_VERSION
      && String(BACKEND_PACKAGE_VERSION) !== String(APP_VERSION)
      && !lite
    ) {
      payload.versionMismatchHint =
        'Shell and backend package versions differ — restart NEXOR on the server PC after installing the latest build.';
    } else if (db.engine === 'sqlite' && fs.existsSync(path.join(process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP', 'database.env'))) {
      payload.schemaRepairHint = 'database.env exists but backend is on SQLite. Set C:\\NEXOR ERP\\IP to postgres (not a .db path) and restart NEXOR.';
    }
    if (schemaChecks && schemaChecks.salesCreditPayment === false) {
      payload.schemaRepairHint =
        'Credit (on-account) sales blocked by DB constraint. Rebuild/restart backend Docker, or run: docker compose exec backend node scripts/ensure-server-schema.js';
    }
    if (!lite) {
      try {
        const c = await db.query('SELECT COUNT(*) AS n FROM products');
        payload.products = Number(c.rows[0]?.n || 0);
      } catch (_) {
        payload.products = null;
      }
    }
    res.json(payload);
  } catch (e) {
    const msg = String(e?.message || e || 'health check failed');
    const pgDown = /ECONNREFUSED|connect timeout|ENOTFOUND|5432/i.test(msg)
      && (db.engine === 'postgres' || !!process.env.DATABASE_URL);
    res.status(pgDown ? 503 : 500).json({
      ok: false,
      unified: true,
      engine: db.engine || 'postgres',
      error: msg,
      dbUnreachable: pgDown,
      hint: pgDown
        ? 'PostgreSQL is not running. Start Docker Desktop, then run: docker compose up -d postgres'
        : undefined,
    });
  }
});

// ── Global API authentication gate ──────────────────────────────────────────
// Every /api route requires a valid user JWT, except the public allowlist in
// security.js (health, auth, sync, installations). NEXOR_OPEN_API=1 disables it
// (emergency escape hatch only).
if (process.env.NEXOR_OPEN_API === '1') {
  console.warn('[SECURITY] NEXOR_OPEN_API=1 — API authentication gate DISABLED. Do not use in production.');
}
app.use(apiAuthGate);

app.use('/api/auth', require('./routes/auth'));

app.use('/api/products', require('./routes/products')(broadcastTable));
app.use('/api/branches', require('./routes/branches')(broadcastTable));
app.use('/api/categories', require('./routes/categories')(broadcastTable));
app.use('/api/suppliers', require('./routes/suppliers')(broadcastTable));
app.use('/api/clients', require('./routes/clients')(broadcastTable));
app.use('/api/customers', require('./routes/clients')(broadcastTable));
app.use('/api/sales', require('./routes/sales')(broadcastTable));
app.use('/api/payments', require('./routes/payments')(broadcastTable));
app.use('/api/transactions', require('./routes/transactions')(broadcastTable));
app.use('/api/purchase-orders', require('./routes/purchaseOrders')(broadcastTable));
app.use('/api/purchase-invoices', require('./routes/purchaseInvoices')(broadcastTable));
app.use('/api/proformas', require('./routes/proformas')(broadcastTable));
app.use('/api/supplier-returns', require('./routes/supplierReturns')(broadcastTable));
app.use('/api/stock-transfers', require('./routes/stockTransfers')(broadcastTable));
app.use('/api/import-orders', require('./routes/importOrders')(broadcastTable));
app.use('/api/journal-entries', require('./routes/journalEntries')(broadcastTable));
app.use('/api/chart-of-accounts', require('./routes/chartOfAccounts')(broadcastTable));
app.use('/api/dashboard', require('./routes/dashboard')(broadcastTable));
app.use('/api/daily-briefing', require('./routes/dailyBriefing')(broadcastTable));
app.use('/api/deployment', require('./routes/deployment')(broadcastTable));
app.use('/api/tax', require('./routes/tax')(broadcastTable));
app.use('/api/exchange-rates', require('./routes/exchangeRates')(broadcastTable));
app.use('/api/approvals', require('./routes/approvals')(broadcastTable));
app.use('/api/audit', require('./routes/audit')(broadcastTable));
app.use('/api/backup', require('./routes/backup')(broadcastTable));
app.use('/api/security', require('./routes/security')());
app.use('/api/certification', require('./routes/certification')());
app.use('/api/consistency', require('./routes/consistency')(broadcastTable));
app.use('/api/budgets', require('./routes/budgets')(broadcastTable));
app.use('/api/daily-reports', require('./routes/dailyReports')(broadcastTable));
app.use('/api/caixa', require('./routes/caixa')(broadcastTable));
app.use('/api/bank-accounts', require('./routes/bankAccounts')(broadcastTable));
app.use('/api/expenses', require('./routes/expenses')(broadcastTable));
app.use('/api/agt', require('./routes/agt')(broadcastTable));
app.use('/api/signing', require('./routes/signing')());
app.use('/api/fiscal-documents', require('./routes/fiscalDocuments')(broadcastTable));
app.use('/api/company-settings', require('./routes/companySettings')(broadcastTable));
app.use('/api/sync', require('./routes/syncIngest')(broadcastTable));
app.use('/api/installations', require('./routes/installations')());

const { startReplicatorWorker } = require('./jobs/replicator');
const { startAgtWorker } = require('./jobs/agtWorker');
const { ensureDefaultInstallation } = require('./sync/installation');
const { upgradeLegacyPasswordHashesOnStartup } = require('./lib/upgradeLegacyPasswords');
const { ensurePhaseSchema } = require('./lib/ensurePhaseSchema');

const saftRouter = require('./routes/saft')();
app.use('/api/saft', saftRouter);
app.use('/api/saft-xml', require('./routes/saftXml')());

app.get(/^\/(?!api(?:\/|$)|app(?:\/|$)).*/, (req, res, next) => {
  if (req.accepts(['html', 'json']) !== 'html') return next();
  const target = `/app${req.originalUrl === '/' ? '' : req.originalUrl}`;
  return res.redirect(302, target);
});

(async () => {
  try {
    await ensurePhaseSchema(db);
    const checks = await buildSchemaChecks(db);
    if (!checks.ok) {
      console.warn('[SCHEMA] Post-migration checks failed:', JSON.stringify(checks));
      console.warn('[SCHEMA] Restart the server after updating — migrations run automatically on startup for PostgreSQL.');
    }
  } catch (e) {
    console.error('[SCHEMA] ensurePhaseSchema failed:', e.message);
  }

  try {
    await recordAppMetaForDb(db, readAppVersion());
    console.log(`[SCHEMA] app_meta schema_version=${EXPECTED_SCHEMA_VERSION}`);
  } catch (e) {
    console.warn('[SCHEMA] app_meta:', e.message);
  }

  server.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const k of Object.keys(nets)) {
      for (const iface of nets[k] || []) {
        if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
      }
    }
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  NEXOR ERP SERVER (SQLite unified)                             ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(`║  http://localhost:${PORT}                                       `.slice(0, 66).padEnd(66) + '║');
    for (const ip of ips.slice(0, 4)) {
      const line = `║  LAN: http://${ip}:${PORT}`;
      console.log(line.padEnd(66) + '║');
    }
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('[SERVER] SQLite unified backend — all /api routes active');
    discoveryBroadcaster.start().catch((e) => console.warn('[Discovery]', e.message));

    ensureDefaultInstallation().catch((e) => console.warn('[INSTALL]', e.message));
    upgradeLegacyPasswordHashesOnStartup().catch((e) => console.warn('[AUTH]', e.message));
    const { migrateInventoryVatTo5 } = require('./migrateInventoryVat5');
    migrateInventoryVatTo5(db).catch((e) => console.warn('[DB] Inventory VAT 5% patch:', e.message));
    startReplicatorWorker(4000);
    startAgtWorker(5000);
    const { drainRedundantMainQueueOnHq } = require('./sync/outbox');
    drainRedundantMainQueueOnHq().catch((e) => console.warn('[OUTBOX]', e.message));
  });
})();

io.on('connection', (socket) => {
  discoveryBroadcaster.setConnectedClients(io.engine.clientsCount);
  socket.on('disconnect', () => {
    discoveryBroadcaster.setConnectedClients(io.engine.clientsCount);
  });
});
