// Shared Electron API type definitions - NEXOR ERP
// Matches preload.cjs API exactly

export interface HotUpdateConfig {
  enabled: boolean;
  serverUrl: string;
  autoConnect?: boolean;
}

export interface DiscoveredServer {
  id: string;
  name: string;
  ip: string;
  port: number;
  version?: string;
  lastSeen?: string;
  hostname?: string;
  connectedClients?: number;
}

export interface SetupConfig {
  setupComplete: boolean;
  role: 'server' | 'client' | null;
  serverConfig?: {
    databasePath?: string;
    serverIp?: string;
    serverPort?: number;
  } | null;
  clientConfig?: {
    serverIp?: string;
    serverPort?: number;
  } | null;
}

export interface AGTConfig {
  companyNIF: string;
  environment: 'production' | 'sandbox';
  certificatePath?: string;
  apiKey?: string;
}

export interface AGTTransmissionResult {
  success: boolean;
  agtCode?: string;
  agtStatus: 'validated' | 'pending' | 'error' | 'rejected';
  validatedAt?: string;
  errorMessage?: string;
  retryable?: boolean;
}

export interface AGTStatusResult {
  success: boolean;
  invoiceNumber: string;
  agtStatus: 'validated' | 'pending' | 'error' | 'rejected';
  agtCode?: string;
  validatedAt?: string;
  errorMessage?: string;
}

export interface ElectronAPI {
  platform: string;
  isElectron: boolean;
  /** Base URL for the auto-spawned Express API (e.g. http://localhost:3001) when the child is running. */
  backendHttpOrigin?: string | null;

  // IP file operations
  ipfile: {
    read: () => Promise<string>;
    write: (content: string) => Promise<{ success: boolean; error?: string }>;
    parse: () => Promise<IPFileConfig>;
    /** Same as parse() but synchronous — reads live IP file (authoritative role vs localStorage). */
    parseSync: () => IPFileConfig;
  };

  // Company management
  company: {
    list: () => Promise<CompanyInfo[]>;
    create: (name: string) => Promise<{ success: boolean; company?: CompanyInfo; error?: string }>;
    setActive: (companyId: string) => Promise<{ success: boolean; error?: string }>;
  };

  // Database operations
  db: {
    getStatus: () => Promise<DBStatus>;
    ensureBackend: () => Promise<{ success: boolean; port?: number | null; error?: string }>;
    create: () => Promise<{ success: boolean; error?: string }>;
    init: () => Promise<{ success: boolean; mode?: string; error?: string }>;
    getAll: (table: string, companyId?: string) => Promise<{ success: boolean; data: any[] }>;
    getById: (table: string, id: string, companyId?: string) => Promise<{ success: boolean; data: any }>;
    insert: (table: string, data: any, companyId?: string) => Promise<{ success: boolean; error?: string }>;
    update: (table: string, id: string, data: any, companyId?: string) => Promise<{ success: boolean; error?: string }>;
    delete: (table: string, id: string, companyId?: string) => Promise<{ success: boolean; error?: string }>;
    query: (sql: string, params?: any[], companyId?: string) => Promise<{ success: boolean; data?: any[]; error?: string }>;
    export: (companyId?: string) => Promise<{ success: boolean; data?: any }>;
    import: (data: any, companyId?: string) => Promise<{ success: boolean; error?: string }>;
    testConnection: () => Promise<{ success: boolean; mode?: string; error?: string }>;
  };

  // Setup wizard
  setup?: {
    getConfig: () => Promise<{ success: boolean; config?: SetupConfig }>;
    saveConfig: (config: SetupConfig) => Promise<{ success: boolean; error?: string }>;
    reset: () => Promise<{ success: boolean; error?: string }>;
  };

  // Database management (legacy)
  database?: {
    getPath: () => Promise<string>;
    query: (sql: string) => Promise<{ success: boolean; data?: any[] }>;
  };

  // Real-time sync
  onDatabaseUpdate: (callback: (data: { table: string; action: string }) => void) => void;
  onDatabaseSync: (callback: (data: { table: string; rows: any[]; companyId?: string }) => void) => void;

  // Network
  network: {
    getLocalIPs: () => Promise<string[]>;
    getInstallPath: () => Promise<string>;
    getIPFilePath: () => Promise<string>;
    getComputerName: () => Promise<string>;
    httpJson?: (opts: {
      url: string;
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }) => Promise<{ ok: boolean; status: number; json?: unknown; text?: string; error?: string }>;
    httpBinary?: (opts: {
      url: string;
      method?: string;
      body?: ArrayBuffer | Uint8Array;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }) => Promise<{
      ok: boolean;
      status: number;
      contentType?: string;
      body?: Uint8Array | ArrayBuffer;
      text?: string;
      json?: unknown;
      error?: string;
    }>;
  };

  // Purchase windows
  purchase?: {
    openCreateWindow: () => Promise<{ success: boolean; error?: string }>;
    openProductPicker: () => Promise<{ success: boolean; cancelled?: boolean; product?: any; error?: string }>;
    selectProduct: (product: any) => Promise<{ success: boolean; error?: string }>;
  };

  // Window controls
  window?: {
    closeCurrent: () => Promise<{ success: boolean }>;
  };

  // Server discovery
  discovery?: {
    start: () => Promise<{ success: boolean }>;
    stop: () => Promise<{ success: boolean }>;
    scan: (timeout?: number) => Promise<{ success: boolean; servers: DiscoveredServer[]; error?: string }>;
    getServers: () => Promise<DiscoveredServer[]>;
    onServerFound: (callback: (server: DiscoveredServer) => void) => void;
  };

  // Printing
  print: {
    html: (html: string, options?: { silent?: boolean }) => Promise<{ success: boolean; error?: string }>;
  };

  // Auto-spawned Express backend (Option A, phases 1–6)
  backend?: {
    getPort: () => Promise<number | null>;
    getStatus: () => Promise<{ running: boolean; port: number | null; mode: string; dockerOk: boolean }>;
    onStatus: (callback: (data: {
      state: 'healthy' | 'degraded' | 'down' | 'restarting' | 'restarted' | 'failed';
      detail?: string;
      port?: number | null;
      mode?: string;
      code?: string;
      fails?: number;
      attempts?: number;
      ts?: number;
    }) => void) => void;
    // Phase 6
    getLogDir: () => Promise<string | null>;
    openLogDir: () => Promise<{ success: boolean; path?: string; error?: string }>;
  };

  // App
  app: {
    relaunch: () => Promise<void>;
    getVersion: () => Promise<string>;
  };

  // Auto-updater
  updater: {
    check: () => Promise<{ success: boolean; error?: string; isUpdateAvailable?: boolean; version?: string }>;
    download: () => Promise<{ success: boolean; error?: string }>;
    install: () => Promise<{ success: boolean }>;
    getVersion: () => Promise<string>;
    getDiagnostics: () => Promise<{ loaded: boolean; currentVersion: string; feedUrl: string; packaged: boolean }>;
    onStatus: (callback: (data: UpdateStatus) => void) => (() => void) | void;
  };

  // Hot updates
  hotUpdate?: {
    getConfig: () => Promise<{ success: boolean; config?: HotUpdateConfig; error?: string }>;
    setConfig: (config: HotUpdateConfig) => Promise<{ success: boolean; config?: HotUpdateConfig; error?: string }>;
    checkServer: (url: string) => Promise<{ success: boolean; available?: boolean; version?: { version: string }; error?: string }>;
    reload: () => Promise<{ success: boolean; source?: string; error?: string }>;
    getSource: () => Promise<{ success: boolean; source: 'server' | 'local' | 'unknown' }>;
  };

  // AGT
  agt: {
    calculateHash: (data: string) => Promise<{ success: boolean; hash?: string }>;
    getConfig: () => Promise<{ success: boolean; config?: AGTConfig; error?: string }>;
    configure: (config: AGTConfig) => Promise<{ success: boolean; error?: string }>;
    signInvoice: (data: any, keyAlias: string, passphrase: string) => Promise<{
      success: boolean;
      hash?: string;
      shortHash?: string;
      signature?: string;
      algorithm?: string;
      error?: string;
    }>;
    transmitInvoice: (payload: any, signatureData: any) => Promise<AGTTransmissionResult>;
    transmitWithRetry: (payload: any, signatureData: any) => Promise<AGTTransmissionResult>;
    checkStatus: (invoiceNumber: string) => Promise<AGTStatusResult>;
    voidInvoice: (invoiceNumber: string, reason: string) => Promise<{ success: boolean; errorMessage?: string }>;
  };

  // Transaction Engine (direct PostgreSQL operations)
  tx?: {
    processSale: (saleData: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    processPurchaseReceive: (orderId: string, receivedQuantities: Record<string, number>, receivedBy: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    processTransferApprove: (transferId: string, approvedBy: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    processTransferReceive: (transferId: string, receivedQuantities: Record<string, number>, receivedBy: string) => Promise<{ success: boolean; data?: any; error?: string }>;
    processPayment: (paymentData: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    recordStockMovement: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>;
    generateInvoiceNumber: (branchCode: string) => Promise<{ success: boolean; data?: { invoiceNumber: string }; error?: string }>;
  };
}

export interface IPFileConfig {
  valid: boolean;
  error?: string;
  path: string | null;
  isServer: boolean;
  serverAddress?: string;
}

export interface DBStatus {
  success: boolean;
  mode: 'server' | 'client' | 'standalone' | 'unconfigured';
  path: string | null;
  serverAddress: string | null;
  wsPort: number;
  connected: boolean;
  expressBackend?: boolean;
  expressPort?: number | null;
  backendRunning?: boolean;
  backendNativeError?: string | null;
}

export interface CompanyInfo {
  id: string;
  name: string;
  dbFile: string;
}

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  progress?: number;
  error?: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
