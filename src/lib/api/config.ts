// API Configuration
// Change this to your server's local IP address

// Prefer IPv4 loopback — on Windows, "localhost" can resolve to ::1 while Express listens on IPv4 only.
const DEFAULT_API_URL = 'http://127.0.0.1:3000';

/** Embedded ERP Express default / start port (see `electron/backendManager.cjs`). LAN clients must call the server PC on this port unless overridden. */
const DEFAULT_ERP_HTTP_PORT = 3000;

/** Short TTL memo — parseSync reads the IP file from disk (cheap but avoid every microtask). */
let _ipServerMemo: { until: number; isServerDb: boolean } = { until: 0, isServerDb: false };

/** True when the on-disk IP file says this PC hosts the database (.db path) — overrides wrong localStorage. */
function ipFileSaysServerMachine(): boolean {
  if (typeof window === 'undefined') return false;
  const now = Date.now();
  if (now < _ipServerMemo.until) return _ipServerMemo.isServerDb;
  try {
    const ip = (window as any).electronAPI?.ipfile?.parseSync?.();
    const v = !!(ip?.valid && ip.isServer);
    _ipServerMemo = { until: now + 2500, isServerDb: v };
    return v;
  } catch {
    _ipServerMemo = { until: now + 2500, isServerDb: false };
    return false;
  }
}

export function invalidateIpFileRoleCache(): void {
  _ipServerMemo = { until: 0, isServerDb: false };
}

/**
 * Thin-client mode: API runs on the server machine, not localhost. Uses `kwanza_client_config`
 * written by setup sync (`App.tsx`) or immediately after client setup (`Setup.tsx`).
 */
export function getLanClientApiBaseFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (ipFileSaysServerMachine()) return null;
    if (localStorage.getItem('kwanza_is_server') === 'true') return null;
    const raw = localStorage.getItem('kwanza_client_config');
    if (!raw) return null;
    const cfg = JSON.parse(raw) as { serverIp?: string; httpPort?: number; apiPort?: number };
    const ip = typeof cfg?.serverIp === 'string' ? cfg.serverIp.trim() : '';
    if (!ip) return null;
    const port = Number(cfg.httpPort ?? cfg.apiPort ?? DEFAULT_ERP_HTTP_PORT);
    if (!Number.isFinite(port) || port <= 0 || port >= 65536) return null;
    return `http://${ip}:${port}`;
  } catch {
    return null;
  }
}

/** Non-loopback API URL from Settings (`kwanza_api_url`), if set. */
function parseSavedRemoteApiUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const savedUrl = localStorage.getItem('kwanza_api_url');
  if (!savedUrl) return null;
  const normalized = savedUrl.trim().toLowerCase();
  if (
    normalized.startsWith('postgres://')
    || normalized.startsWith('postgresql://')
    || normalized.includes('docker')
  ) {
    return null;
  }
  const u = savedUrl.trim().replace(/\/$/, '');
  const isLocal = u.includes('127.0.0.1') || u.includes('localhost');
  if (isLocal) return null;
  return u;
}

// Detect if running in a cloud preview (Lovable, Vercel, etc.)
// where localhost:3000 is unreachable — the backend runs on the user's local PC
let _isDemoMode: boolean | null = null;
export function isDemoMode(): boolean {
  if (_isDemoMode !== null) return _isDemoMode;
  if (typeof window === 'undefined') { _isDemoMode = true; return true; }
  const host = window.location.hostname;
  // Cloud preview hosts — backend is unreachable
  const isCloudPreview = host.includes('lovableproject.com')
    || host.includes('lovable.app')
    || host.includes('vercel.app')
    || host.includes('netlify.app');
  // User explicitly set a custom API URL → they have a backend
  const hasCustomUrl = !!localStorage.getItem('kwanza_api_url');
  _isDemoMode = isCloudPreview && !hasCustomUrl;
  return _isDemoMode;
}

// Get API URL from localStorage or use default.
// In Electron, prefer the dynamic port chosen by backendManager (3000..3009),
// injected as window.__KWANZA_BACKEND_PORT__ before the React app loads.
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const isElectron = !!(window as any).electronAPI?.isElectron;
    if (isElectron) {
      const origin = (window as any).electronAPI?.backendHttpOrigin;
      if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) {
        return origin.replace(/\/$/, '');
      }
      const p = (window as any).__KWANZA_BACKEND_PORT__;
      if (typeof p === 'number' && p > 0 && p < 65536) {
        return `http://127.0.0.1:${p}`;
      }
      const manualRemote = parseSavedRemoteApiUrl();
      if (manualRemote) return manualRemote;
      const lanClient = getLanClientApiBaseFromStorage();
      if (lanClient) return lanClient;
      return DEFAULT_API_URL;
    }

    const savedUrl = localStorage.getItem('kwanza_api_url');
    if (savedUrl) {
      const normalized = savedUrl.trim().toLowerCase();
      const isLegacyDbString = normalized.startsWith('postgres://')
        || normalized.startsWith('postgresql://')
        || normalized.includes('docker');
      if (!isLegacyDbString) return savedUrl;
      localStorage.removeItem('kwanza_api_url');
    }
  }
  return DEFAULT_API_URL;
}

/** Cached base URL for embedded Express (avoid polling on every API call). */
let electronResolvedBase: string | null = null;

export function invalidateElectronApiBaseCache(): void {
  electronResolvedBase = null;
  invalidateIpFileRoleCache();
}

/** Matches embedded `/api/health` from backendManager + SQLite unified server. */
function isEmbeddedHealthPayload(j: unknown): boolean {
  if (!j || typeof j !== 'object') return false;
  const o = j as Record<string, unknown>;
  return (
    o.ok === true
    && o.unified === true
    && (o.engine === 'sqlite' || o.engine === 'postgres')
  );
}

async function tryHealthOnPort(p: number): Promise<number | null> {
  if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 680);
  try {
    const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!isEmbeddedHealthPayload(j)) return null;
    return p;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * When IPC `getPort()` lags or is wrong, find the embedded Express by probing
 * the same port range the main process uses (3000..3009).
 */
async function discoverEmbeddedErpPort(): Promise<number | null> {
  const ports = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009];
  const results = await Promise.all(ports.map((p) => tryHealthOnPort(p)));
  const hit = results.find((x) => typeof x === 'number' && x > 0);
  return hit ?? null;
}

/**
 * Prefer loopback embedded Express (same machine) before falling back to LAN thin-client URL.
 * Previously LAN was resolved first and cached — stale `kwanza_client_config` on a server PC
 * pointed API calls at another host while supplier IPC still hit localhost Express.
 */
async function waitForEmbeddedExpressBase(api: NonNullable<typeof window.electronAPI>, waitMs: number): Promise<string | null> {
  const syncLocalPortHint = (): string | null => {
    const origin = (window as any).electronAPI?.backendHttpOrigin;
    if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) {
      return origin.replace(/\/$/, '');
    }
    const p = (window as any).__KWANZA_BACKEND_PORT__;
    if (typeof p === 'number' && p > 0 && p < 65536) {
      return `http://127.0.0.1:${p}`;
    }
    return null;
  };

  const quick = syncLocalPortHint();
  if (quick) return quick;

  const tryIpcPort = async (): Promise<number | null> => {
    try {
      const port = await api.backend?.getPort?.();
      return typeof port === 'number' && port > 0 && port < 65536 ? port : null;
    } catch {
      return null;
    }
  };

  const scanLocalEmbedded = async (): Promise<number | null> => discoverEmbeddedErpPort();

  if (!api.backend?.getPort) {
    const onlyDiscover = await scanLocalEmbedded();
    return onlyDiscover != null ? `http://127.0.0.1:${onlyDiscover}` : null;
  }

  const ipcFirst = await tryIpcPort();
  if (ipcFirst != null) return `http://127.0.0.1:${ipcFirst}`;

  const quickDiscover = await scanLocalEmbedded();
  if (quickDiscover != null) return `http://127.0.0.1:${quickDiscover}`;

  const start = Date.now();
  const nullPortSince = Date.now();

  while (Date.now() - start < waitMs) {
    const p = await tryIpcPort();
    if (p != null) return `http://127.0.0.1:${p}`;

    const discovered = await scanLocalEmbedded();
    if (discovered != null) return `http://127.0.0.1:${discovered}`;

    if (Date.now() - nullPortSince > 2800) break;

    await new Promise((r) => setTimeout(r, 180));
  }

  const last = await scanLocalEmbedded();
  return last != null ? `http://127.0.0.1:${last}` : null;
}

/**
 * Same as getApiUrl(), but in Electron asks the main process for the **live**
 * embedded Express port (3000..3009). Sync getApiUrl() often stays on :3000 until
 * late injection — that breaks API calls if another port was chosen.
 */
export async function getApiUrlAsync(options?: { waitForPortMs?: number }): Promise<string> {
  const apiPre = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  try {
    if (apiPre?.isElectron && apiPre?.ipfile?.parseSync && electronResolvedBase) {
      const ip = apiPre.ipfile.parseSync();
      if (ip?.valid && ip.isServer) {
        const c = electronResolvedBase.toLowerCase();
        if (!c.includes('127.0.0.1') && !c.includes('localhost')) {
          invalidateElectronApiBaseCache();
        }
      }
    }
  } catch {
    /* ignore */
  }

  if (electronResolvedBase) return electronResolvedBase;

  const waitMs = options?.waitForPortMs ?? 6000;
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;

  if (!api?.isElectron) {
    return getApiUrl();
  }

  const manualRemote = parseSavedRemoteApiUrl();
  if (manualRemote) {
    electronResolvedBase = manualRemote;
    return manualRemote;
  }

  const embedded = await waitForEmbeddedExpressBase(api, waitMs);
  if (embedded) {
    electronResolvedBase = embedded;
    return embedded;
  }

  const lanEarly = getLanClientApiBaseFromStorage();
  if (lanEarly) {
    electronResolvedBase = lanEarly;
    return lanEarly;
  }

  return getApiUrl();
}

// Set API URL (for settings page)
export function setApiUrl(url: string): void {
  localStorage.setItem('kwanza_api_url', url);
  // Reload to reconnect with new URL
  window.location.reload();
}

// Get WebSocket URL from API URL
export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
}

// Check if we're in local network mode (custom API) or demo mode (localStorage)
export function isLocalNetworkMode(): boolean {
  const apiUrl = getApiUrl();
  return apiUrl !== DEFAULT_API_URL || localStorage.getItem('kwanza_force_api') === 'true';
}

// Force API mode even on localhost (for testing)
export function setForceApiMode(enabled: boolean): void {
  localStorage.setItem('kwanza_force_api', enabled ? 'true' : 'false');
  window.location.reload();
}

// Detect if running in web preview (no Electron, no setup configured)
// Used to disable background polling that would spam ECONNREFUSED errors
export function isWebPreview(): boolean {
  if (isDemoMode()) return true;
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
  if (isElectron) return false;
  const setupComplete = typeof window !== 'undefined' && localStorage.getItem('kwanza_setup_complete') === 'true';
  return !setupComplete;
}
