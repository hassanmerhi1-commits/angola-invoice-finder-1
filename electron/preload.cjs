/**
 * NEXOR ERP - Preload Script
 * 
 * Clean IPC API matching PayrollAO architecture.
 * All database operations transparently routed through main process
 * which handles server/client mode.
 */

const { contextBridge, ipcRenderer } = require('electron');

let backendHttpOrigin = null;
let backendPortSync = 0;
try {
  const o = ipcRenderer.sendSync('backend:getHttpOriginSync');
  if (typeof o === 'string' && /^https?:\/\//i.test(o)) backendHttpOrigin = o;
} catch (_) {
  /* ipc not ready */
}
try {
  const p = ipcRenderer.sendSync('backend:getPortSync');
  if (typeof p === 'number' && p > 0 && p < 65536) backendPortSync = p;
} catch (_) {
  /* ipc not ready */
}

if (backendPortSync > 0) {
  try {
    contextBridge.exposeInMainWorld('__KWANZA_BACKEND_PORT__', backendPortSync);
  } catch (_) {
    /* hot-reload / second preload */
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  // IP file operations (the core of the architecture)
  ipfile: {
    read: () => ipcRenderer.invoke('ipfile:read'),
    write: (content) => ipcRenderer.invoke('ipfile:write', content),
    parse: () => ipcRenderer.invoke('ipfile:parse'),
    parseSync: () => {
      try {
        const raw = ipcRenderer.sendSync('ipfile:parseSync');
        return typeof raw === 'string' ? JSON.parse(raw) : { valid: false };
      } catch {
        return { valid: false };
      }
    },
  },

  // Company management
  company: {
    list: () => ipcRenderer.invoke('company:list'),
    create: (name) => ipcRenderer.invoke('company:create', name),
    setActive: (companyId) => ipcRenderer.invoke('company:setActive', companyId),
  },

  // Database operations (transparently routed to server if client mode)
  db: {
    getStatus: () => ipcRenderer.invoke('db:getStatus'),
    ensureBackend: () => ipcRenderer.invoke('db:ensureBackend'),
    create: () => ipcRenderer.invoke('db:create'),
    init: () => ipcRenderer.invoke('db:init'),
    getAll: (table, companyId) => ipcRenderer.invoke('db:getAll', table, companyId),
    getById: (table, id, companyId) => ipcRenderer.invoke('db:getById', table, id, companyId),
    insert: (table, data, companyId) => ipcRenderer.invoke('db:insert', table, data, companyId),
    update: (table, id, data, companyId) => ipcRenderer.invoke('db:update', table, id, data, companyId),
    delete: (table, id, companyId) => ipcRenderer.invoke('db:delete', table, id, companyId),
    query: (sql, params, companyId) => ipcRenderer.invoke('db:query', sql, params, companyId),
    export: (companyId) => ipcRenderer.invoke('db:export', companyId),
    import: (data, companyId) => ipcRenderer.invoke('db:import', data, companyId),
    testConnection: () => ipcRenderer.invoke('db:testConnection'),
  },

  // Real-time sync listeners
  onDatabaseUpdate: (callback) => {
    ipcRenderer.removeAllListeners('erp:updated');
    ipcRenderer.on('erp:updated', (_, data) => callback(data));
  },
  onDatabaseSync: (callback) => {
    ipcRenderer.removeAllListeners('erp:sync');
    ipcRenderer.on('erp:sync', (_, data) => callback(data));
  },

  // Network info
  network: {
    getLocalIPs: () => ipcRenderer.invoke('network:getLocalIPs'),
    getInstallPath: () => ipcRenderer.invoke('network:getInstallPath'),
    getIPFilePath: () => ipcRenderer.invoke('network:getIPFilePath'),
    getComputerName: () => ipcRenderer.invoke('network:getComputerName'),
    httpJson: (opts) => ipcRenderer.invoke('network:httpJson', opts),
    httpBinary: (opts) => ipcRenderer.invoke('network:httpBinary', opts),
  },

  // Purchase windows
  purchase: {
    openCreateWindow: () => ipcRenderer.invoke('purchase:openCreateWindow'),
    openProductPicker: () => ipcRenderer.invoke('purchase:openProductPicker'),
    selectProduct: (product) => ipcRenderer.invoke('purchase:selectProduct', product),
  },

  // Window controls
  window: {
    closeCurrent: () => ipcRenderer.invoke('window:closeCurrent'),
  },

  // Printing
  print: {
    html: (html, options) => ipcRenderer.invoke('print:html', html, options),
    listPrinters: () => ipcRenderer.invoke('print:listPrinters'),
  },

  // PDF export (Electron-only)
  pdf: {
    saveHtml: (html, options) => ipcRenderer.invoke('pdf:saveHtml', html, options),
  },

  // Backend (auto-spawned Express child process — Option A)
  backend: {
    getPort: () => ipcRenderer.invoke('backend:getPort'),
    getStatus: () => ipcRenderer.invoke('backend:getStatus'),
    onStatus: (callback) => {
      ipcRenderer.removeAllListeners('backend:status');
      ipcRenderer.on('backend:status', (_, data) => callback(data));
    },
    // Phase 6
    getLogDir: () => ipcRenderer.invoke('backend:getLogDir'),
    openLogDir: () => ipcRenderer.invoke('backend:openLogDir'),
  },

  // App controls
  app: {
    relaunch: () => ipcRenderer.invoke('app:relaunch'),
    getVersion: () => ipcRenderer.invoke('app:version'),
  },

  // Auto-updater
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    getState: () => ipcRenderer.invoke('updater:getState'),
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    onStatus: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
    getDiagnostics: () => ipcRenderer.invoke('updater:getDiagnostics'),
    openReleasePage: () => ipcRenderer.invoke('updater:openReleasePage'),
  },

  // Hot updates
  hotUpdate: {
    getConfig: () => ipcRenderer.invoke('hotUpdate:getConfig'),
    setConfig: (config) => ipcRenderer.invoke('hotUpdate:setConfig', config),
    checkServer: (url) => ipcRenderer.invoke('hotUpdate:checkServer', url),
    reload: () => ipcRenderer.invoke('hotUpdate:reload'),
    getSource: () => ipcRenderer.invoke('hotUpdate:getSource'),
  },

  // AGT (simplified)
  agt: {
    calculateHash: (data) => ipcRenderer.invoke('agt:calculate-hash', { data }),
  },

  // Transaction Engine (direct DB operations)
  tx: {
    processTransaction: (data) => ipcRenderer.invoke('tx:processTransaction', data),
    processSale: (saleData) => ipcRenderer.invoke('tx:processSale', saleData),
    processPurchaseReceive: (orderId, receivedQuantities, receivedBy) =>
      ipcRenderer.invoke('tx:processPurchaseReceive', orderId, receivedQuantities, receivedBy),
    processTransferApprove: (transferId, approvedBy) =>
      ipcRenderer.invoke('tx:processTransferApprove', transferId, approvedBy),
    processTransferReceive: (transferId, receivedQuantities, receivedBy) =>
      ipcRenderer.invoke('tx:processTransferReceive', transferId, receivedQuantities, receivedBy),
    processPayment: (paymentData) => ipcRenderer.invoke('tx:processPayment', paymentData),
    recordStockMovement: (data) => ipcRenderer.invoke('tx:recordStockMovement', data),
    generateInvoiceNumber: (branchCode) => ipcRenderer.invoke('tx:generateInvoiceNumber', branchCode),
  },

  // Offline sync outbox (shop client → city server)
  syncOutbox: {
    enqueue: (event) => ipcRenderer.invoke('syncOutbox:enqueue', event),
    getPendingCount: () => ipcRenderer.invoke('syncOutbox:pendingCount'),
    flush: (apiBaseUrl) => ipcRenderer.invoke('syncOutbox:flush', apiBaseUrl),
  },

  // Phase B1 — local SQLite save-first (shop client)
  clientLocal: {
    isEnabled: () => ipcRenderer.invoke('clientLocal:isEnabled'),
    saveSale: (saleData) => ipcRenderer.invoke('clientLocal:saveSale', saleData),
    listSales: (branchId) => ipcRenderer.invoke('clientLocal:listSales', branchId),
    syncProducts: (products) => ipcRenderer.invoke('clientLocal:syncProducts', products),
    listPending: () => ipcRenderer.invoke('clientLocal:listPending'),
    getAgtPendingCount: () => ipcRenderer.invoke('clientLocal:agtPendingCount'),
    runAgtSync: () => ipcRenderer.invoke('clientLocal:runAgtSync'),
    pullMasterData: (branchId) => ipcRenderer.invoke('clientLocal:pullMasterData', branchId),
  },

  // LAN server discovery (UDP broadcast)
  discovery: {
    scan: (timeoutMs) => ipcRenderer.invoke('discovery:scan', timeoutMs),
  },

  // First-run setup wizard (server vs client role)
  setup: {
    getConfig: () => ipcRenderer.invoke('setup:getConfig'),
    saveConfig: (config) => ipcRenderer.invoke('setup:saveConfig', config),
    reset: () => ipcRenderer.invoke('setup:reset'),
    configureStandalone: () => ipcRenderer.invoke('setup:configureStandalone'),
  },

  getApiUrl: () => ipcRenderer.invoke('sync:getApiUrl'),

  app: {
    setUiLanguage: (lang) => ipcRenderer.invoke('app:setUiLanguage', lang),
  },

  // Platform info
  platform: process.platform,
  isElectron: true,
  /** Set when the auto-spawned Express child is actually running (sync at preload time). */
  backendHttpOrigin: backendHttpOrigin,
});

console.log('🏢 NEXOR ERP running in Electron desktop mode');
