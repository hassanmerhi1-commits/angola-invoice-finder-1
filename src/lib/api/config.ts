// API Configuration
// Change this to your server's local IP address

import {
  buildLanServerApiBase,
  parseLanServerEndpoint,
  repairLanClientConfigStorage,
} from '@/lib/lanServerAddress';
import { electronHttpJson, isElectronLanClient } from '@/lib/electronHttp';

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

type LanClientConfig = { serverIp?: string; httpPort?: number; apiPort?: number };

function readLanClientConfig(): LanClientConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('kwanza_client_config');
    if (!raw) return null;
    return JSON.parse(raw) as LanClientConfig;
  } catch {
    return null;
  }
}

/** Server hostname/IP from the on-disk IP file (client installs only). */
export function getClientServerHostFromIpFile(): { host: string; httpPort: number | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const ip = (window as any).electronAPI?.ipfile?.parseSync?.();
    if (ip?.valid && !ip.isServer && typeof ip.serverAddress === 'string') {
      const parsed = parseLanServerEndpoint(ip.serverAddress);
      if (!parsed.host) return null;
      const p = Number(ip.httpPort ?? parsed.port);
      const httpPort = Number.isFinite(p) && p > 0 && p < 65536 ? p : parsed.port;
      return { host: parsed.host, httpPort: httpPort ?? null };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Persist IP-file client address into localStorage when setup UI did not. */
export function syncLanClientConfigFromIpFile(): void {
  if (typeof window === 'undefined') return;
  repairLanClientConfigStorage();
  if (ipFileSaysServerMachine()) return;
  if (localStorage.getItem('kwanza_is_server') === 'true') return;
  const hostInfo = getClientServerHostFromIpFile();
  const host = hostInfo?.host;
  if (!host) return;
  try {
    const existing = readLanClientConfig();
    if (existing?.serverIp?.trim() === host) return;
    localStorage.setItem(
      'kwanza_client_config',
      JSON.stringify({
        serverIp: host,
        httpPort: Number(
          hostInfo?.httpPort
          ?? existing?.httpPort
          ?? existing?.apiPort
          ?? DEFAULT_ERP_HTTP_PORT,
        ),
        useSocketIo: true,
      }),
    );
    localStorage.setItem('kwanza_is_server', 'false');
    invalidateElectronApiBaseCache();
  } catch {
    /* ignore */
  }
}

function buildLanClientApiBase(hostOrEndpoint: string, port: number): string {
  return buildLanServerApiBase(hostOrEndpoint, port)!;
}

export function getLanClientApiBaseFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (ipFileSaysServerMachine()) return null;
    if (localStorage.getItem('kwanza_is_server') === 'true') return null;

    syncLanClientConfigFromIpFile();

    const cfg = readLanClientConfig();
    let endpoint = typeof cfg?.serverIp === 'string' ? cfg.serverIp.trim() : '';
    const fromIpFile = getClientServerHostFromIpFile();
    if (!endpoint) endpoint = fromIpFile?.host || '';
    if (!endpoint) return null;

    const parsed = parseLanServerEndpoint(endpoint);
    const host = parsed.host || endpoint;
    const port = Number(
      fromIpFile?.httpPort
      ?? parsed.port
      ?? cfg?.httpPort
      ?? cfg?.apiPort
      ?? DEFAULT_ERP_HTTP_PORT,
    );
    if (!Number.isFinite(port) || port <= 0 || port >= 65536) return null;
    return buildLanServerApiBase(host, port);
  } catch {
    return null;
  }
}

/** Thin-client: database lives on another PC; this install only has a server IP in config. */
export function isThinClientMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (ipFileSaysServerMachine()) return false;
  if (localStorage.getItem('kwanza_is_server') === 'true') return false;
  try {
    const ip = (window as any).electronAPI?.ipfile?.parseSync?.();
    if (ip?.valid && ip.isServer) return false;
    if (ip?.valid && !ip.isServer && ip.serverAddress) return true;
  } catch {
    /* ignore */
  }
  if (getLanClientApiBaseFromStorage()) return true;
  if (localStorage.getItem('kwanza_is_server') === 'false') return true;
  return false;
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
      if (ipFileSaysServerMachine()) {
        const p = (window as any).__KWANZA_BACKEND_PORT__;
        if (typeof p === 'number' && p > 0 && p < 65536) {
          return `http://127.0.0.1:${p}`;
        }
        return DEFAULT_API_URL;
      }

      const lanClient = getLanClientApiBaseFromStorage();
      if (lanClient) return lanClient;

      const manualRemote = parseSavedRemoteApiUrl();
      if (manualRemote) return manualRemote;

      const origin = (window as any).electronAPI?.backendHttpOrigin;
      if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) {
        return origin.replace(/\/$/, '');
      }
      const p = (window as any).__KWANZA_BACKEND_PORT__;
      if (typeof p === 'number' && p > 0 && p < 65536) {
        return `http://127.0.0.1:${p}`;
      }
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
let electronCacheVerifiedAt = 0;
const ELECTRON_CACHE_VERIFY_MS = 12_000;

function parseLoopbackPort(base: string): number | null {
  try {
    const u = new URL(base);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return null;
    const p = Number(u.port || 3000);
    return p > 0 && p < 65536 ? p : null;
  } catch {
    return null;
  }
}

async function verifyElectronCachedBase(): Promise<boolean> {
  if (!electronResolvedBase) return false;
  const port = parseLoopbackPort(electronResolvedBase);
  if (!port) return true;
  const ok = await tryHealthOnPort(port);
  return ok != null;
}

export function invalidateElectronApiBaseCache(): void {
  electronResolvedBase = null;
  electronCacheVerifiedAt = 0;
  invalidateIpFileRoleCache();
  import('@/lib/electronHttp').then(({ invalidateElectronLanClientCache }) => {
    invalidateElectronLanClientCache();
  }).catch(() => {});
}

/** Drop stale thin-client URL when this PC hosts the database (IP file = .db path). */
export function clearStaleClientConfigIfServerMachine(): void {
  if (typeof window === 'undefined') return;
  try {
    if (ipFileSaysServerMachine()) {
      localStorage.removeItem('kwanza_client_config');
      localStorage.setItem('kwanza_is_server', 'true');
      invalidateElectronApiBaseCache();
    }
  } catch {
    /* ignore */
  }
}

export type EmbeddedBackendWaitResult =
  | { ok: true; baseUrl: string }
  | { ok: false; error: string };

/**
 * Packaged app: login must wait for embedded Express — preload often runs before the port is bound.
 */
export async function waitForEmbeddedBackendHealth(
  opts?: { timeoutMs?: number },
): Promise<EmbeddedBackendWaitResult> {
  const timeoutMs = opts?.timeoutMs ?? (ipFileSaysServerMachine() ? 20000 : 15000);
  const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (!el?.isElectron) {
    return { ok: true, baseUrl: getApiUrl() };
  }

  clearStaleClientConfigIfServerMachine();
  invalidateElectronApiBaseCache();
  repairLanClientConfigStorage();

  if (el?.db?.ensureBackend) {
    try {
      await el.db.ensureBackend();
    } catch {
      /* retry loop will poll */
    }
  }

  const lanClient = await isElectronLanClient();
  if (lanClient && isThinClientMode()) {
    const baseUrl = await resolveLanClientApiBaseAsync();
    if (baseUrl) {
      const probe = async (): Promise<boolean> => {
        const r = await electronHttpJson(`${baseUrl}/api/health`, { timeoutMs: 5000 });
        return r.ok && isEmbeddedHealthPayload(r.json);
      };
      let ok = false;
      try {
        ok = await probe();
      } catch {
        ok = false;
      }
      if (!ok && typeof fetch !== 'undefined') {
        try {
          const res = await fetch(`${baseUrl}/api/health`);
          const payload = await res.json().catch(() => null);
          ok = res.ok && isEmbeddedHealthPayload(payload);
        } catch {
          ok = false;
        }
      }
      if (ok) {
        electronResolvedBase = baseUrl;
        electronCacheVerifiedAt = Date.now();
        return { ok: true, baseUrl };
      }
      return {
        ok: false,
        error: `Cannot reach the server at ${baseUrl}. Confirm NEXOR ERP is running on the server PC and C:\\NEXOR ERP\\IP contains the server IP only (e.g. 192.168.10.18).`,
      };
    }
    try {
      const status = await el.db?.getStatus?.();
      if (status?.mode === 'client' && status?.serverAddress) {
        const fallback = buildLanServerApiBase(String(status.serverAddress), 3000);
        if (fallback) {
          const r = await electronHttpJson(`${fallback}/api/health`, { timeoutMs: 5000 });
          if (r.ok && isEmbeddedHealthPayload(r.json)) {
            electronResolvedBase = fallback;
            electronCacheVerifiedAt = Date.now();
            return { ok: true, baseUrl: fallback };
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  const deadline = Date.now() + timeoutMs;
  let lastNativeError = '';
  let pollAttempt = 0;

  while (Date.now() < deadline) {
    if (pollAttempt > 0 && pollAttempt % 4 === 0 && el?.db?.ensureBackend) {
      try {
        await el.db.ensureBackend();
      } catch {
        /* ignore */
      }
    }
    pollAttempt += 1;
    try {
      const status = await el.db?.getStatus?.();
      if (status?.backendNativeError) {
        lastNativeError = String(status.backendNativeError);
        return { ok: false, error: lastNativeError };
      }

      const mode = String(status?.mode || '');
      if (mode === 'client') {
        const baseUrl = getLanClientApiBaseFromStorage()
          || buildLanServerApiBase(String(status?.serverAddress || ''), 3000);
        if (baseUrl) {
          const r = await electronHttpJson(`${baseUrl}/api/health`, { timeoutMs: 4000 });
          if (r.ok && isEmbeddedHealthPayload(r.json)) {
            electronResolvedBase = baseUrl;
            electronCacheVerifiedAt = Date.now();
            return { ok: true, baseUrl };
          }
        }
      }

      const baseUrl = await getApiUrlAsync({ waitForPortMs: 2500 });
      const healthOk = async (base: string): Promise<{ ok: true } | { ok: false; fatal?: string }> => {
        const parsePayload = (payload: unknown, statusOk: boolean) => {
          if (statusOk && isEmbeddedHealthPayload(payload)) return { ok: true as const };
          const p = payload as Record<string, unknown> | null;
          if (p?.dbUnreachable || (p?.ok === false && /ECONNREFUSED|5432/i.test(String(p?.error || '')))) {
            return {
              ok: false as const,
              fatal: String(p?.hint || p?.error || 'PostgreSQL is not running. Start Docker Desktop and PostgreSQL.'),
            };
          }
          return { ok: false as const };
        };
        try {
          const r = await electronHttpJson(`${base}/api/health?lite=1`, { timeoutMs: 4000 });
          const parsed = parsePayload(r.json, r.ok);
          if (parsed.ok || parsed.fatal) return parsed;
        } catch {
          /* try fetch */
        }
        if (typeof fetch === 'undefined') return { ok: false };
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 4000) : null;
        try {
          const res = await fetch(`${base}/api/health?lite=1`, ctrl ? { signal: ctrl.signal } : {});
          const payload = await res.json().catch(() => null);
          return parsePayload(payload, res.ok);
        } catch {
          return { ok: false };
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const health = await healthOk(baseUrl);
      if (health.fatal) {
        return { ok: false, error: health.fatal };
      }
      if (health.ok) {
        electronResolvedBase = baseUrl;
        electronCacheVerifiedAt = Date.now();
        return { ok: true, baseUrl };
      }
    } catch {
      /* retry until timeout */
    }
    await new Promise((r) => setTimeout(r, 450));
  }

  if (lastNativeError) {
    return { ok: false, error: lastNativeError };
  }
  try {
    const st = await el.db?.getStatus?.();
    if (st?.mode === 'server' && !st?.expressBackend) {
      return {
        ok: false,
        error: 'Database service failed to start (backend crashed on startup). Rebuild and reinstall NEXOR ERP, then check %APPDATA%\\NEXOR ERP\\logs\\backend-*.log',
      };
    }
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    error: 'Database service did not start. Close the app completely, reopen it, wait 30 seconds, then try admin / changeme. If it still fails, rebuild the installer (npm run electron:build).',
  };
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

const REMOTE_ERP_PORTS = [3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009];

async function tryRemoteHealthOnPort(host: string, port: number): Promise<number | null> {
  const url = `http://${host}:${port}/api/health`;
  if (typeof window !== 'undefined' && (window as any).electronAPI?.network?.httpJson) {
    try {
      const r = await electronHttpJson(url, { timeoutMs: 1500 });
      if (r.ok && isEmbeddedHealthPayload(r.json)) return port;
    } catch {
      /* fall through to fetch */
    }
  }
  if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1200);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    if (!isEmbeddedHealthPayload(j)) return null;
    return port;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Find which port the server PC bound (3000..3009) — same range as backendManager. */
export async function discoverRemoteServerPort(
  host: string,
  preferredPort?: number,
): Promise<number | null> {
  const h = String(host || '').trim();
  if (!h) return null;
  const preferred = Number(preferredPort);
  if (Number.isFinite(preferred) && preferred > 0 && preferred < 65536) {
    const hit = await tryRemoteHealthOnPort(h, preferred);
    if (hit) return hit;
  }
  const results = await Promise.all(REMOTE_ERP_PORTS.map((p) => tryRemoteHealthOnPort(h, p)));
  return results.find((x) => typeof x === 'number') ?? null;
}

/** Resolve LAN client API base, probing the server for the correct port when needed. */
export async function resolveLanClientApiBaseAsync(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (ipFileSaysServerMachine()) return null;
  if (localStorage.getItem('kwanza_is_server') === 'true') return null;

  syncLanClientConfigFromIpFile();

  const cfg = readLanClientConfig();
  let endpoint = typeof cfg?.serverIp === 'string' ? cfg.serverIp.trim() : '';
  const fromIpFile = getClientServerHostFromIpFile();
  if (!endpoint) endpoint = fromIpFile?.host || '';
  if (!endpoint) {
    try {
      const status = await (window as any).electronAPI?.db?.getStatus?.();
      if (status?.serverAddress) endpoint = String(status.serverAddress).trim();
    } catch {
      /* ignore */
    }
  }
  const parsed = parseLanServerEndpoint(endpoint);
  const host = parsed.host || endpoint;
  if (!host) return null;

  const preferred = Number(
    fromIpFile?.httpPort
    ?? parsed.port
    ?? cfg?.httpPort
    ?? cfg?.apiPort
    ?? DEFAULT_ERP_HTTP_PORT,
  );
  const port = await discoverRemoteServerPort(host, preferred) ?? preferred;
  if (!Number.isFinite(port) || port <= 0) return null;

  try {
    localStorage.setItem(
      'kwanza_client_config',
      JSON.stringify({
        serverIp: host,
        httpPort: port,
        useSocketIo: true,
      }),
    );
    localStorage.setItem('kwanza_is_server', 'false');
  } catch {
    /* ignore */
  }

  return buildLanServerApiBase(host, port);
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

  if (electronResolvedBase) {
    if (Date.now() - electronCacheVerifiedAt > ELECTRON_CACHE_VERIFY_MS) {
      const ok = await verifyElectronCachedBase();
      electronCacheVerifiedAt = Date.now();
      if (!ok) {
        invalidateElectronApiBaseCache();
      }
    }
    if (electronResolvedBase) return electronResolvedBase;
  }

  const waitMs = options?.waitForPortMs ?? 12000;
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;

  if (!api?.isElectron) {
    return getApiUrl();
  }

  if (ipFileSaysServerMachine()) {
    const embeddedLocal = await waitForEmbeddedExpressBase(api, waitMs);
    if (embeddedLocal) {
      electronResolvedBase = embeddedLocal;
      electronCacheVerifiedAt = Date.now();
      return embeddedLocal;
    }
    return DEFAULT_API_URL;
  }

  const manualRemote = parseSavedRemoteApiUrl();
  if (manualRemote) {
    electronResolvedBase = manualRemote;
    electronCacheVerifiedAt = Date.now();
    return manualRemote;
  }

  const lanEarly = getLanClientApiBaseFromStorage();
  if (lanEarly && !isThinClientMode()) {
    electronResolvedBase = lanEarly;
    electronCacheVerifiedAt = Date.now();
    return lanEarly;
  }

  if (isThinClientMode()) {
    const lanRemote = await resolveLanClientApiBaseAsync();
    if (lanRemote) {
      electronResolvedBase = lanRemote;
      electronCacheVerifiedAt = Date.now();
      return lanRemote;
    }
  }

  if (lanEarly) {
    electronResolvedBase = lanEarly;
    electronCacheVerifiedAt = Date.now();
    return lanEarly;
  }

  const embedded = await waitForEmbeddedExpressBase(api, waitMs);
  if (embedded) {
    electronResolvedBase = embedded;
    electronCacheVerifiedAt = Date.now();
    return embedded;
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
