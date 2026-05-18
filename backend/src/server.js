/**
 * NEXOR ERP — unified Express server (SQLite or PostgreSQL via ./db.js, all /api routes).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');

require('./db');
const db = require('./db');
const { lanCors, securityHeaders, rateLimiter } = require('./middleware/security');
const { DiscoveryBroadcaster } = require('./discovery');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
});

function broadcastTable(table) {
  try {
    io.emit('table-update', { table, ts: Date.now() });
  } catch (_) {}
}

const discoveryBroadcaster = new DiscoveryBroadcaster(PORT, {
  name: process.env.SERVER_NAME || 'NEXOR ERP Server',
  version: '1.0.0',
  branch: process.env.BRANCH_NAME || null,
});

app.use(lanCors);
app.use(securityHeaders);
app.use(rateLimiter(60000, 300));
app.use(express.json({ limit: '10mb' }));

const webappPath = path.join(__dirname, '../webapp');
if (!fs.existsSync(webappPath)) fs.mkdirSync(webappPath, { recursive: true });
app.use('/app', express.static(webappPath));
app.get(/^\/app(?:\/.*)?$/, (req, res) => {
  const indexPath = path.join(webappPath, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).json({ error: 'Webapp not deployed' });
});

app.get('/api/health', async (_req, res) => {
  try {
    const row = await db.query(db.engine === 'postgres' ? "SELECT NOW() AS now" : "SELECT datetime('now') AS now");
    let products = 0;
    try {
      const c = await db.query('SELECT COUNT(*) AS n FROM products');
      products = Number(c.rows[0]?.n || 0);
    } catch (_) {}
    res.json({
      ok: true,
      engine: db.engine || 'sqlite',
      time: row.rows[0]?.now,
      products,
      unified: true,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
app.use('/api/supplier-returns', require('./routes/supplierReturns')(broadcastTable));
app.use('/api/stock-transfers', require('./routes/stockTransfers')(broadcastTable));
app.use('/api/journal-entries', require('./routes/journalEntries')(broadcastTable));
app.use('/api/chart-of-accounts', require('./routes/chartOfAccounts')(broadcastTable));
app.use('/api/dashboard', require('./routes/dashboard')(broadcastTable));
app.use('/api/tax', require('./routes/tax')(broadcastTable));
app.use('/api/exchange-rates', require('./routes/exchangeRates')(broadcastTable));
app.use('/api/approvals', require('./routes/approvals')(broadcastTable));
app.use('/api/audit', require('./routes/audit')(broadcastTable));
app.use('/api/backup', require('./routes/backup')(broadcastTable));
app.use('/api/consistency', require('./routes/consistency')(broadcastTable));
app.use('/api/budgets', require('./routes/budgets')(broadcastTable));
app.use('/api/daily-reports', require('./routes/dailyReports')(broadcastTable));
app.use('/api/agt', require('./routes/agt')(broadcastTable));

const saftRouter = require('./routes/saft')(broadcastTable);
app.use('/api/saft', saftRouter);
app.use('/api/saft-xml', require('./routes/saftXml')(saftRouter));

app.get(/^\/(?!api(?:\/|$)|app(?:\/|$)).*/, (req, res, next) => {
  if (req.accepts(['html', 'json']) !== 'html') return next();
  const target = `/app${req.originalUrl === '/' ? '' : req.originalUrl}`;
  return res.redirect(302, target);
});

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
});

io.on('connection', (socket) => {
  discoveryBroadcaster.setConnectedClients(io.engine.clientsCount);
  socket.on('disconnect', () => {
    discoveryBroadcaster.setConnectedClients(io.engine.clientsCount);
  });
});
