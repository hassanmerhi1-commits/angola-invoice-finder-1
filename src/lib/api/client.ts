import { generateId } from '@/lib/utils';
import { DEFAULT_VAT_RATE } from '@/lib/taxUtils';
// NEXOR ERP API Client — API-first transaction routing
// Transactional writes always use the backend HTTP API so browser and desktop share the same execution path
// Electron IPC stays available only for desktop-only utilities and non-transactional reads

import {
  getApiUrl,
  getApiUrlAsync,
  invalidateElectronApiBaseCache,
  isDemoMode,
  isThinClientMode,
  waitForEmbeddedBackendHealth,
  clearStaleClientConfigIfServerMachine,
} from './config';
import {
  cacheOfflineLoginCredential,
  tryOfflineLogin,
  setOfflineModeActive,
} from '@/lib/offlineAuth';
import { electronHttpJson, isElectronLanClient } from '@/lib/electronHttp';
import { isNetworkErrorMessage } from '@/lib/networkErrors';

export type LoginErrorKind = 'credentials' | 'connection';

function classifyLoginError(message: string): LoginErrorKind {
  const m = String(message || '').toLowerCase();
  if (
    m.includes('network error')
    || m.includes('failed to fetch')
    || m.includes('fetch failed')
    || m.includes('econnrefused')
    || m.includes('backend did not start')
    || m.includes('backend unavailable')
    || m.includes('database service')
    || m.includes('database server')
    || m.includes('native module')
    || m.includes('better-sqlite3')
    || m.includes('http 500')
    || m.includes('login failed')
    || m.includes('too many login attempts')
  ) {
    return 'connection';
  }
  return 'credentials';
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  /** HTTP status of the backend response. Undefined means the backend was never reached
   *  (network/connection failure) — only then is a direct-IPC fallback appropriate. */
  status?: number;
}

// ==================== MODE DETECTION ====================
export function isElectronMode(): boolean {
  return !!window.electronAPI?.isElectron && !!window.electronAPI?.db;
}

// ==================== AUTH (localStorage-based for both modes) ====================
function getAuthToken(): string | null {
  return localStorage.getItem('kwanza_auth_token');
}

let lastJwtCheck: { at: number; result: 'valid' | 'invalid' | 'unreachable' } | null = null;
let ensureTokenInFlight: Promise<string | null> | null = null;

export function clearAuthSessionCache(): void {
  lastJwtCheck = null;
  ensureTokenInFlight = null;
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem('kwanza_auth_token', token);
  } else {
    localStorage.removeItem('kwanza_auth_token');
  }
  lastJwtCheck = null;
}

/** True for JWT from POST /api/auth/login (not Electron IPC `local-…` placeholders). */
export function isJwtAuthToken(token: string | null | undefined): boolean {
  if (!token || token.startsWith('local-')) return false;
  return token.split('.').length === 3;
}

function readStoredUserId(): string | null {
  try {
    const raw = localStorage.getItem('kwanzaerp_current_user');
    if (!raw) return null;
    const u = JSON.parse(raw) as { id?: string };
    return u.id ? String(u.id) : null;
  } catch {
    return null;
  }
}

type JwtCheckResult = 'valid' | 'invalid' | 'unreachable';

const JWT_CHECK_TTL_MS = 45_000;

/** Validate JWT vs local user; unreachable = backend down (do not clear token). */
async function checkJwtAgainstStoredUser(): Promise<JwtCheckResult> {
  if (lastJwtCheck && Date.now() - lastJwtCheck.at < JWT_CHECK_TTL_MS) {
    return lastJwtCheck.result;
  }

  const token = getAuthToken();
  const storedId = readStoredUserId();
  if (!isJwtAuthToken(token) || !storedId) {
    lastJwtCheck = { at: Date.now(), result: 'invalid' };
    return 'invalid';
  }

  const me = await apiFetch<{ id?: string }>('/auth/me');
  let result: JwtCheckResult;
  if (me.data?.id) {
    result = String(me.data.id) === storedId ? 'valid' : 'invalid';
  } else {
    const err = String(me.error || '').toLowerCase();
    if (
      err.includes('401')
      || err.includes('invalid token')
      || err.includes('not authenticated')
      || err.includes('user not found')
    ) {
      result = 'invalid';
    } else {
      result = 'unreachable';
    }
  }

  lastJwtCheck = { at: Date.now(), result };
  return result;
}

async function ensureBackendAuthTokenInner(): Promise<string | null> {
  const existing = getAuthToken();
  if (existing && !isJwtAuthToken(existing)) {
    setAuthToken(null);
    clearAuthSessionCache();
  }

  if (isDemoMode()) return null;

  const check = await checkJwtAgainstStoredUser();

  if (check === 'valid') {
    return getAuthToken();
  }

  if (check === 'unreachable' && isJwtAuthToken(getAuthToken())) {
    return getAuthToken();
  }

  if (check === 'invalid') {
    setAuthToken(null);
    clearAuthSessionCache();
  }

  return null;
}

/** Returns the current JWT if still valid for the logged-in user (never re-logs in without a password). */
export async function ensureBackendAuthToken(): Promise<string | null> {
  if (!ensureTokenInFlight) {
    ensureTokenInFlight = ensureBackendAuthTokenInner().finally(() => {
      ensureTokenInFlight = null;
    });
  }
  return ensureTokenInFlight;
}

// ==================== IPC DATABASE HELPERS ====================
async function ipcGetAll<T>(table: string): Promise<ApiResponse<T[]>> {
  try {
    const result = await window.electronAPI!.db.getAll(table);
    return { data: (result.data || []) as T[] };
  } catch (e: any) {
    return { error: e.message || 'IPC error' };
  }
}

async function ipcQuery<T>(sql: string, params: any[] = []): Promise<ApiResponse<T[]>> {
  try {
    const result = await window.electronAPI!.db.query(sql, params);
    return { data: (result.data || []) as T[] };
  } catch (e: any) {
    return { error: e.message || 'IPC query error' };
  }
}

async function ipcInsert(table: string, data: any): Promise<ApiResponse<any>> {
  try {
    // Ensure ID
    if (!data.id) {
      data.id = generateId();
    }
    const result = await window.electronAPI!.db.insert(table, data);
    if (result.success) {
      const payload = result.data !== undefined && result.data !== null ? result.data : data;
      return { data: payload };
    }
    return { error: result.error || 'Insert failed' };
  } catch (e: any) {
    return { error: e.message || 'IPC insert error' };
  }
}

async function ipcUpdate(table: string, id: string, data: any): Promise<ApiResponse<any>> {
  try {
    const result = await window.electronAPI!.db.update(table, id, data);
    if (result.success) return { data: { ...data, id } };
    return { error: result.error || 'Update failed' };
  } catch (e: any) {
    return { error: e.message || 'IPC update error' };
  }
}

async function ipcDelete(table: string, id: string): Promise<ApiResponse<any>> {
  try {
    const result = await window.electronAPI!.db.delete(table, id);
    if (result.success) return { data: { success: true } };
    return { error: result.error || 'Delete failed' };
  } catch (e: any) {
    return { error: e.message || 'IPC delete error' };
  }
}

/** If HTTP reached the API but returned 4xx/5xx, do not fall back to IPC (masks real errors and often hits “Express unreachable”). */
function shouldTryIpcAfterApiFailure(apiResult: ApiResponse<any>): boolean {
  if (apiResult.data != null) return false;
  // The backend actually responded (any HTTP status) → trust its error instead of masking
  // it with a direct-IPC "Database not connected" fallback.
  if (typeof apiResult.status === 'number') return false;
  const err = (apiResult.error || '').trim();
  if (!err) return true;
  if (/^HTTP \d{3}/.test(err)) return false;
  if (err.toLowerCase().includes('demo mode')) return false;
  if (err.toLowerCase().includes('authentication')) return false;
  if (err.toLowerCase().includes('administrator')) return false;
  if (err.toLowerCase().includes('invalid token')) return false;
  if (err.toLowerCase().includes('password')) return false;
  return true;
}

/** @deprecated alias */
const shouldTrySupplierIpcAfterApiFailure = shouldTryIpcAfterApiFailure;

function normalizeApiErrorMessage(payload: unknown, status?: number): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error.trim();
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message.trim();
    if (Array.isArray(obj.errors) && obj.errors.length) {
      return obj.errors.map((e) => String(e)).join('; ');
    }
  }
  if (typeof payload !== 'string') {
    return status ? `HTTP ${status}` : 'Network error';
  }
  const text = payload.trim();
  const expressMatch = text.match(/Cannot (?:POST|GET|PUT|PATCH|DELETE) (\/api\/[^\s<]+)/i);
  if (expressMatch) {
    return `Backend outdated — missing ${expressMatch[1]}. Update NEXOR to v1.0.74+ on the server PC, then fully restart the app.`;
  }
  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
    if (status === 404) {
      return 'API endpoint not found (HTTP 404). Update NEXOR to v1.0.74+ on the server PC and restart the app.';
    }
    return status ? `Server error (HTTP ${status}). Restart NEXOR ERP on the server PC.` : 'Server error. Restart NEXOR ERP on the server PC.';
  }
  return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}

// ==================== HTTP FALLBACK (web preview/demo) ====================
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
  fetchOpts?: { timeoutMs?: number },
): Promise<ApiResponse<T>> {
  // In demo mode (cloud preview), skip network calls entirely — fall back to localStorage
  if (isDemoMode()) {
    return { error: 'Demo mode — backend not available' };
  }

  const buildUrl = (base: string) => `${base}/api${endpoint}`;
  const el = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  let baseUrl =
    el?.isElectron
      ? await getApiUrlAsync()
      : getApiUrl();
  let url = buildUrl(baseUrl);
  const token = getAuthToken();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const lanClient = el?.isElectron && await isElectronLanClient();
  if (lanClient && el?.network?.httpJson) {
    const body =
      options.body != null && typeof options.body === 'string'
        ? (() => { try { return JSON.parse(options.body as string); } catch { return options.body; } })()
        : options.body;
    const r = await electronHttpJson(url, {
      method: options.method || 'GET',
      body,
      headers: headers as Record<string, string>,
      timeoutMs: fetchOpts?.timeoutMs ?? 25000,
    });
    if (r.ok) {
      return { data: r.json as T, status: r.status };
    }
    const errPayload = r.json as Record<string, unknown> | null;
    const errorMessage =
      r.error
      || (typeof errPayload?.error === 'string' ? errPayload.error : null)
      || normalizeApiErrorMessage(
        typeof r.text === 'string' && r.text ? r.text : errPayload,
        r.status,
      );
    return { error: errorMessage, status: r.status };
  }

  try {
    const response = await fetch(url, { ...options, headers });
    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const payload = isJson
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');

    if (!response.ok) {
      return { error: normalizeApiErrorMessage(payload, response.status), status: response.status };
    }

    return { data: payload as T, status: response.status };
  } catch (error) {
    // Electron: drop stale cached base, re-resolve via IPC + port scan, retry once.
    const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.isElectron;
    if (isElectron) {
      lastJwtCheck = null;
      try {
        invalidateElectronApiBaseCache();
        const resolved = await getApiUrlAsync({ waitForPortMs: 8000 });
        const retryUrl = buildUrl(resolved);
        const retryResponse = await fetch(retryUrl, { ...options, headers });
        const retryContentType = retryResponse.headers.get('content-type') || '';
        const retryIsJson = retryContentType.includes('application/json');
        const retryPayload = retryIsJson
          ? await retryResponse.json().catch(() => null)
          : await retryResponse.text().catch(() => '');
        if (!retryResponse.ok) {
          return { error: normalizeApiErrorMessage(retryPayload, retryResponse.status), status: retryResponse.status };
        }
        return { data: retryPayload as T, status: retryResponse.status };
      } catch {
        /* fall through */
      }
      try {
        if (!(await isElectronLanClient())) {
          const freshPort = await window.electronAPI.backend.getPort();
          if (typeof freshPort === 'number' && freshPort > 0) {
            const freshBase = `http://127.0.0.1:${freshPort}`;
            if (freshBase !== baseUrl) {
              baseUrl = freshBase;
              url = buildUrl(baseUrl);
              const retryResponse = await fetch(url, { ...options, headers });
              const retryContentType = retryResponse.headers.get('content-type') || '';
              const retryIsJson = retryContentType.includes('application/json');
              const retryPayload = retryIsJson
                ? await retryResponse.json().catch(() => null)
                : await retryResponse.text().catch(() => '');
              if (!retryResponse.ok) {
                return { error: normalizeApiErrorMessage(retryPayload, retryResponse.status), status: retryResponse.status };
              }
              return { data: retryPayload as T, status: retryResponse.status };
            }
          }
        }
      } catch {
        // Ignore retry failure and return original error below.
      }
    }

    console.error(`[API ERROR] ${endpoint} url=${url}:`, error);
    const msg = error instanceof Error ? error.message : 'Network error';
    return { error: msg };
  }
}

function mapSupplierPayloadForElectron(data: any) {
  const now = new Date().toISOString();

  return {
    id: data.id || generateId(),
    name: data.name || '',
    nif: (data.nif && String(data.nif).trim()) || null,
    email: data.email || '',
    phone: data.phone || '',
    address: data.address || '',
    city: data.city || '',
    country: data.country || 'Angola',
    contact_person: data.contactPerson ?? data.contact_person ?? '',
    payment_terms: data.paymentTerms ?? data.payment_terms ?? '30_days',
    is_active: data.isActive ?? data.is_active ?? true,
    notes: data.notes || '',
    balance: Number(data.balance || 0),
    created_at: data.createdAt ?? data.created_at ?? now,
    updated_at: data.updatedAt ?? data.updated_at ?? now,
  };
}

function mapProductPayloadForElectron(data: any) {
  const now = new Date().toISOString();
  const cost = Number(data.cost ?? 0);

  return {
    id: data.id || generateId(),
    name: data.name || '',
    sku: data.sku || '',
    barcode: data.barcode || '',
    category: data.category || 'GERAL',
    price: Number(data.price ?? 0),
    price_2: Number(data.price2 ?? data.price_2 ?? 0),
    price_3: Number(data.price3 ?? data.price_3 ?? 0),
    price_4: Number(data.price4 ?? data.price_4 ?? 0),
    cost,
    first_cost: Number(data.firstCost ?? data.first_cost ?? cost),
    last_cost: Number(data.lastCost ?? data.last_cost ?? cost),
    weighted_avg_cost: Number(data.avgCost ?? data.avg_cost ?? cost),
    stock: Number(data.stock ?? 0),
    unit: data.unit || 'UN',
    tax_rate: Number(data.taxRate ?? data.tax_rate ?? DEFAULT_VAT_RATE),
    branch_id: data.branchId === '' ? null : (data.branchId ?? data.branch_id ?? null),
    supplier_id: data.supplierId === '' ? null : (data.supplierId ?? data.supplier_id ?? null),
    is_active: data.isActive ?? data.is_active ?? true,
    created_at: data.createdAt ?? data.created_at ?? now,
    updated_at: data.updatedAt ?? data.updated_at ?? now,
  };
}

async function ensureSupplierSubAccountElectron(
  supplierName: string,
  supplierNif?: string,
  parentCode?: string,
): Promise<string | null> {
  if (!isElectronMode() || !supplierName) return null;

  const ENTITY_ACCOUNT_CODE_LENGTH = 8;
  const SUPPLIER_GROUP_CODE = '32';
  const DEFAULT_SUPPLIER_PARENT_CODE = '321';

  try {
    // Avoid duplicates anywhere in the supplier group, regardless of chosen parent
    const existing = await ipcQuery<any>(
      `SELECT code FROM chart_of_accounts
       WHERE code LIKE '32%' AND level >= 3 AND is_header = false
         AND (name = $1 OR ($2 IS NOT NULL AND $2 != '' AND description LIKE '%' || $2 || '%'))
       ORDER BY code
       LIMIT 1`,
      [supplierName, supplierNif || null]
    );

    if (existing.data?.[0]?.code) {
      return existing.data[0].code;
    }

    let resolvedParentCode = (parentCode || '').trim() || DEFAULT_SUPPLIER_PARENT_CODE;
    if (!resolvedParentCode.startsWith(SUPPLIER_GROUP_CODE)) {
      resolvedParentCode = DEFAULT_SUPPLIER_PARENT_CODE;
    }

    let parent = await ipcQuery<any>(
      `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
      [resolvedParentCode]
    );
    if (!parent.data?.[0]?.id && resolvedParentCode !== DEFAULT_SUPPLIER_PARENT_CODE) {
      resolvedParentCode = DEFAULT_SUPPLIER_PARENT_CODE;
      parent = await ipcQuery<any>(
        `SELECT id, level FROM chart_of_accounts WHERE code = $1 AND is_active = true LIMIT 1`,
        [resolvedParentCode]
      );
    }

    const parentId = parent.data?.[0]?.id;
    if (!parentId) return null;
    const childLevel = (Number(parent.data?.[0]?.level) || 2) + 1;

    const siblings = await ipcQuery<any>(
      `SELECT code FROM chart_of_accounts WHERE code LIKE $1 AND is_header = false`,
      [`${resolvedParentCode}%`]
    );
    const suffixLen = ENTITY_ACCOUNT_CODE_LENGTH - resolvedParentCode.length;
    const maxSeq = (siblings.data || []).reduce((max: number, row: any) => {
      const c = String(row.code || '');
      if (!c.startsWith(resolvedParentCode) || c.length <= resolvedParentCode.length) return max;
      const parsed = Number(c.slice(resolvedParentCode.length));
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);
    const code = `${resolvedParentCode}${String(maxSeq + 1).padStart(suffixLen, '0')}`;

    const insertResult = await ipcInsert('chart_of_accounts', {
      id: generateId(),
      code,
      name: supplierName,
      description: supplierNif ? `NIF: ${supplierNif}` : '',
      account_type: 'liability',
      account_nature: 'credit',
      parent_id: parentId,
      level: childLevel,
      is_header: false,
      is_active: true,
      opening_balance: 0,
      current_balance: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insertResult.error) {
      console.warn('[API] Failed to create supplier sub-account in Electron:', insertResult.error);
      return null;
    }

    return code;
  } catch (error) {
    console.warn('[API] Supplier sub-account sync skipped in Electron:', error);
    return null;
  }
}

// ==================== UNIFIED API ====================
export const api = {
  // Health check
  health: () => {
    if (isElectronMode()) {
      return window.electronAPI!.db.getStatus().then(status => ({
        data: { status: status.connected ? 'ok' : 'disconnected', timestamp: new Date().toISOString(), mode: status.mode }
      })).catch(() => ({ error: 'Health check failed' })) as Promise<ApiResponse<any>>;
    }
    return apiFetch<{ status: string; timestamp: string }>('/health');
  },

  // Auth
  auth: {
    login: async (identifier: string, password: string) => {
      setAuthToken(null);
      clearAuthSessionCache();
      const loginId = identifier.trim();
      if (!loginId || !password) {
        return { error: 'Email or username and password are required', errorKind: 'credentials' as LoginErrorKind };
      }

      if (isElectronMode() && !isDemoMode()) {
        clearStaleClientConfigIfServerMachine();
        invalidateElectronApiBaseCache();
        const lanClient = await isElectronLanClient();
        if (lanClient && isThinClientMode()) {
          const ready = await waitForEmbeddedBackendHealth({ timeoutMs: 15000 });
          if (!ready.ok) {
            const offlineUser = await tryOfflineLogin(loginId, password);
            if (offlineUser) {
              setAuthToken(null);
              setOfflineModeActive(true);
              return {
                data: { token: '', user: offlineUser, offline: true },
              };
            }
            return { error: ready.error, errorKind: 'connection' as LoginErrorKind };
          }
        } else {
          const ready = await waitForEmbeddedBackendHealth({ timeoutMs: 15000 });
          if (!ready.ok) {
            return { error: ready.error, errorKind: 'connection' as LoginErrorKind };
          }
        }
      }

      const httpResult = await apiFetch<{ token: string; user: any }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginId, username: loginId, password }),
      });
      if (httpResult.data?.token && isJwtAuthToken(httpResult.data.token)) {
        setAuthToken(httpResult.data.token);
        setOfflineModeActive(false);
        if (httpResult.data.user && isThinClientMode()) {
          try {
            const u = httpResult.data.user;
            await cacheOfflineLoginCredential(loginId, password, {
              id: String(u.id),
              email: String(u.email || ''),
              name: String(u.name || ''),
              username: loginId,
              role: u.role || 'cashier',
              branchId: String(u.branchId ?? u.branch_id ?? ''),
              isActive: true,
              createdAt: String(u.createdAt ?? u.created_at ?? ''),
            });
          } catch {
            /* non-fatal */
          }
        }
        return httpResult;
      }

      if (isThinClientMode()) {
        const offlineUser = await tryOfflineLogin(loginId, password);
        if (offlineUser) {
          setAuthToken(null);
          setOfflineModeActive(true);
          return {
            data: {
              token: '',
              user: offlineUser,
              offline: true,
            },
          };
        }
      }
      const err = httpResult.error || 'Credenciais inválidas';
      return { error: err, errorKind: classifyLoginError(err) };
    },
    me: () => {
      const token = getAuthToken();
      if (!isJwtAuthToken(token)) {
        return Promise.resolve({ error: 'Not authenticated' }) as Promise<ApiResponse<any>>;
      }
      return apiFetch<any>('/auth/me');
    },
    changePassword: async (currentPassword: string, newPassword: string) => {
      await ensureBackendAuthToken();
      return apiFetch<{ success: boolean }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },
    /** Confirm a supervisor (admin/manager) password to authorize a POS action (e.g. discount). */
    verifyElevated: async (password: string, options?: { identifier?: string; reason?: string }) => {
      await ensureBackendAuthToken();
      return apiFetch<{ ok: boolean; approver?: { id: string; name: string; role: string } }>(
        '/auth/verify-elevated',
        {
          method: 'POST',
          body: JSON.stringify({
            password,
            identifier: options?.identifier,
            reason: options?.reason,
          }),
        },
      );
    },
    logout: async () => {
      await ensureBackendAuthToken();
      return apiFetch<{ success: boolean }>('/auth/logout', { method: 'POST' });
    },
  },

  security: {
    status: () => apiFetch<Record<string, unknown>>('/security/status'),
    sessions: (params?: { activeOnly?: boolean; limit?: number; userId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.activeOnly) qs.set('active', 'true');
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.userId) qs.set('userId', params.userId);
      const q = qs.toString();
      return apiFetch<any[]>(`/security/sessions${q ? `?${q}` : ''}`);
    },
  },

  certification: {
    status: () => apiFetch<Record<string, unknown>>('/certification/status'),
    applyDemoProfile: (options?: { generateTestCertificate?: boolean }) =>
      apiFetch<Record<string, unknown>>('/certification/apply-demo-profile', {
        method: 'POST',
        body: JSON.stringify(options ?? {}),
      }),
  },

  // Branches — Electron + SQLite: IPC main store does not persist branches (only Express DB does).
  // Use the same embedded HTTP API as the browser so list/create/update hit backend/src/routes/branches.js.
  branches: {
    list: async () => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>('/branches');
        if (Array.isArray(apiResult.data)) return { data: apiResult.data };
        if (await isElectronLanClient()) {
          return { error: apiResult.error || 'Cannot reach server' };
        }
        return ipcGetAll('branches');
      }
      return apiFetch<any[]>('/branches');
    },
    create: async (data: any) => {
      if (isElectronMode()) {
        const body = {
          name: data.name,
          code: data.code || '',
          address: data.address || '',
          phone: data.phone || '',
          isMain: !!data.isMain,
          priceLevel: data.priceLevel ?? 1,
        };
        const apiResult = await apiFetch<any>('/branches', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        if (apiResult.error) return apiResult;
        if (apiResult.data != null) return apiResult;
        const branch = {
          id: generateId(),
          name: data.name,
          code: data.code || `FIL${Date.now().toString().slice(-4)}`,
          address: data.address || '',
          phone: data.phone || '',
          is_main: data.isMain || false,
          price_level: data.priceLevel ?? 1,
          created_at: new Date().toISOString(),
        };
        return ipcInsert('branches', branch);
      }
      return apiFetch<any>('/branches', { method: 'POST', body: JSON.stringify(data) });
    },
    update: async (id: string, data: any) => {
      if (isElectronMode()) {
        const body = {
          name: data.name,
          code: data.code || '',
          address: data.address || '',
          phone: data.phone || '',
          isMain: !!data.isMain,
          priceLevel: data.priceLevel ?? 1,
        };
        const apiResult = await apiFetch<any>(`/branches/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        if (apiResult.error) return apiResult;
        if (apiResult.data != null) return apiResult;
        return ipcUpdate('branches', id, {
          name: data.name,
          code: data.code || '',
          address: data.address || '',
          phone: data.phone || '',
          is_main: data.isMain,
          price_level: data.priceLevel ?? 1,
        });
      }
      return apiFetch<any>(`/branches/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      return apiFetch<{ success?: boolean }>(`/branches/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },

  // Products
  products: {
    list: async (branchId?: string, opts?: { light?: boolean }) => {
      const sp = new URLSearchParams();
      if (branchId) sp.set('branchId', branchId);
      if (opts?.light) sp.set('light', '1');
      const qs = sp.toString();
      return apiFetch<any[]>(`/products${qs ? `?${qs}` : ''}`);
    },
    inventoryConsolidated: () => apiFetch<any[]>('/products/inventory-consolidated'),
    lowStock: (branchId?: string) => {
      const sp = new URLSearchParams();
      if (branchId) sp.set('branchId', branchId);
      const qs = sp.toString();
      return apiFetch<any[]>(`/products/low-stock${qs ? `?${qs}` : ''}`);
    },
    inventoryGrid: (opts: { branchId?: string; consolidated?: boolean }) => {
      const sp = new URLSearchParams();
      if (opts.branchId) sp.set('branchId', opts.branchId);
      if (opts.consolidated) sp.set('consolidated', '1');
      const qs = sp.toString();
      return apiFetch<{ rows: any[]; count: number; sellingPrices?: Record<string, number> }>(
        `/products/inventory-grid${qs ? `?${qs}` : ''}`,
      );
    },
    sellingPrices: () =>
      apiFetch<Record<string, number>>('/products/selling-prices'),
    bulkTierPricing: (pcts: { price2Pct?: number | null; price3Pct?: number | null; price4Pct?: number | null }) =>
      apiFetch<{ success: boolean; updated: number }>('/products/bulk-tier-pricing', {
        method: 'POST',
        body: JSON.stringify(pcts),
      }),
    repairFilialStock: (branchId: string) =>
      apiFetch<{ success: boolean; rows: any[]; count: number; repair?: unknown; dbPath?: string }>(
        `/products/repair-filial-stock?branchId=${encodeURIComponent(branchId)}`,
        { method: 'POST' },
      ),
    get: async (id: string) => {
      return apiFetch<any>(`/products/${encodeURIComponent(id)}`);
    },
    create: async (data: any) => {
      const rawBranch = data?.branchId;
      const branchId =
        rawBranch == null || rawBranch === '' || rawBranch === 'all'
          ? undefined
          : String(rawBranch);
      const payload = {
        name: data?.name,
        sku: data?.sku,
        barcode: data?.barcode,
        category: data?.category,
        price: data?.price,
        price2: data?.price2,
        price3: data?.price3,
        price4: data?.price4,
        cost: data?.cost,
        stock: data?.stock,
        unit: data?.unit,
        taxRate: data?.taxRate,
        branchId,
        isActive: data?.isActive,
        supplierId: data?.supplierId,
        supplierName: data?.supplierName,
      };
      return apiFetch<any>('/products', { method: 'POST', body: JSON.stringify(payload) });
    },
    batchImport: async (products: any[]) => {
      return apiFetch<any>('/products/batch', { method: 'POST', body: JSON.stringify({ products }) });
    },
    update: async (id: string, data: any) => {
      return apiFetch<any>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    updateStock: (id: string, quantityChange: number) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          'UPDATE products SET stock = stock + $1 WHERE id = $2 RETURNING *',
          [quantityChange, id]
        ).then(r => ({ data: r.data?.[0] }));
      }
      return apiFetch<any>(`/products/${id}/stock`, { method: 'PATCH', body: JSON.stringify({ quantityChange }) });
    },
    canDelete: (id: string) =>
      apiFetch<{ deletable: boolean; movements: number; sales: number; total: number }>(
        `/products/${encodeURIComponent(id)}/deletable`,
      ),
    delete: async (id: string) => {
      return apiFetch<any>(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  },

  // Sales
  sales: {
    list: async (branchId?: string) => {
      const endpoint = `/sales${branchId ? `?branchId=${branchId}` : ''}`;
      const { mergeSaleRows, readPendingSalesCache } = await import('@/lib/sync/pendingSalesCache');
      const { getLocalSales } = await import('@/lib/sync/offlineFirst');

      let serverRows: any[] | undefined;
      let serverError: string | undefined;

      const apiResult = await apiFetch<any[]>(endpoint);
      if (apiResult.data !== undefined) {
        serverRows = apiResult.data;
      } else {
        serverError = apiResult.error;
        if (isElectronMode()) {
          const sql = branchId
            ? 'SELECT * FROM sales WHERE branch_id = $1 ORDER BY created_at DESC'
            : 'SELECT * FROM sales ORDER BY created_at DESC';
          const params = branchId ? [branchId] : [];
          const salesResult = await ipcQuery<any>(sql, params);
          if (salesResult.data) {
            for (const sale of salesResult.data) {
              const itemsResult = await ipcQuery<any>(
                'SELECT * FROM sale_items WHERE sale_id = $1',
                [sale.id],
              );
              sale.items = itemsResult.data || [];
            }
            serverRows = salesResult.data;
            serverError = undefined;
          }
        }
      }

      let merged = serverRows ?? [];
      if (typeof window !== 'undefined') {
        const localRows = await getLocalSales(branchId);
        const pendingRows = readPendingSalesCache(branchId);
        if (serverRows?.length) {
          const { prunePendingSalesCacheForServerRows } = await import('@/lib/sync/pendingSalesCache');
          prunePendingSalesCacheForServerRows(serverRows);
        }
        merged = mergeSaleRows(merged, [...localRows, ...pendingRows]);
      }

      if (merged.length > 0) {
        return { data: merged, error: null };
      }
      if (serverError) {
        return { error: serverError };
      }
      return { data: [], error: null };
    },
    updateDueDate: (id: string, dueDate: string) =>
      apiFetch<any>(`/sales/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate }),
      }),
    markPrinted: (
      id: string,
      meta?: {
        format?: string;
        reprint?: boolean;
        source?: string;
        documentNumber?: string;
      },
    ) =>
      apiFetch<any>(`/sales/${encodeURIComponent(id)}/mark-printed`, {
        method: 'POST',
        body: JSON.stringify(meta || {}),
      }),
    create: async (data: any) => {
      const { newClientRequestId, enqueueOfflineSale, dispatchSalesChanged } = await import('@/lib/sync/offlineSales');
      const { isOfflineFirstEnabled, saveSaleLocally } = await import('@/lib/sync/offlineFirst');
      const { savePendingSaleCache } = await import('@/lib/sync/pendingSalesCache');
      const { isOfflineModeActive } = await import('@/lib/offlineAuth');
      const body = {
        ...data,
        clientRequestId: data.clientRequestId || newClientRequestId(),
      };

      const hasOutbox = typeof window !== 'undefined' && !!(window as any).electronAPI?.syncOutbox;

      // Enqueue the sale into the offline outbox and return an immediate optimistic
      // receipt stub. Shared by the "known offline" short-circuit and the network-error fallback.
      const queueOfflineSale = async () => {
        const queued = await enqueueOfflineSale(body);
        if (!queued) return null;
        const stub = {
          id: body.clientRequestId,
          invoice_number: body.invoiceNumber || `OFF-${String(body.clientRequestId).slice(0, 8)}`,
          invoiceNumber: body.invoiceNumber || `OFF-${String(body.clientRequestId).slice(0, 8)}`,
          branch_id: body.branchId,
          branchId: body.branchId,
          cashier_id: body.cashierId,
          cashierId: body.cashierId,
          cashier_name: body.cashierName,
          cashierName: body.cashierName,
          items: body.items,
          subtotal: body.subtotal,
          tax_amount: body.taxAmount,
          taxAmount: body.taxAmount,
          discount: body.discount,
          total: body.total,
          payment_method: body.paymentMethod,
          paymentMethod: body.paymentMethod,
          amount_paid: body.amountPaid,
          amountPaid: body.amountPaid,
          change_amount: body.change,
          change: body.change,
          customer_nif: body.customerNif,
          customerNif: body.customerNif,
          customer_name: body.customerName,
          customerName: body.customerName,
          status: 'completed',
          pendingSync: true,
          client_request_id: body.clientRequestId,
          clientRequestId: body.clientRequestId,
          created_at: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        savePendingSaleCache(stub);
        dispatchSalesChanged(String(body.branchId || ''));
        return { data: stub, error: null };
      };

      if (typeof window !== 'undefined' && (await isOfflineFirstEnabled())) {
        const local = await saveSaleLocally(body);
        if (local.ok && local.sale) {
          const sale = local.sale as Record<string, unknown>;
          dispatchSalesChanged(String(body.branchId || ''));
          return {
            data: {
              ...sale,
              ...body,
              invoice_number: sale.invoice_number ?? sale.invoiceNumber,
              pendingSync: true,
            },
            error: null,
          };
        }
        if (local.error && !/not enabled/i.test(String(local.error))) {
          return { error: local.error };
        }
      }

      // Already known to be offline: don't make the cashier wait for a 25s network
      // timeout — queue the sale right away so the receipt prints instantly.
      if (hasOutbox && isOfflineModeActive()) {
        const queuedResult = await queueOfflineSale();
        if (queuedResult) return queuedResult;
      }

      // LAN client with outbox: quick health probe so a dead server queues immediately
      // instead of blocking checkout for the full HTTP timeout.
      if (hasOutbox && !isOfflineModeActive() && typeof window !== 'undefined') {
        const elApi = (window as any).electronAPI;
        if (elApi?.isElectron) {
          const lanClient = await isElectronLanClient();
          if (lanClient && elApi?.network?.httpJson) {
            const baseUrl = await getApiUrlAsync();
            const authToken = getAuthToken();
            const healthUrl = `${baseUrl}/api/health`;
            const health = await electronHttpJson(healthUrl, {
              method: 'GET',
              headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
              timeoutMs: 2500,
            });
            if (!health.ok) {
              const queuedResult = await queueOfflineSale();
              if (queuedResult) return queuedResult;
            }
          }
        }
      }

      const result = await apiFetch<any>('/sales', { method: 'POST', body: JSON.stringify(body) });
      if (result.error && hasOutbox && isNetworkErrorMessage(result.error)) {
        const queuedResult = await queueOfflineSale();
        if (queuedResult) return queuedResult;
      }
      if (result.data) {
        const { clearPendingSaleMatches } = await import('@/lib/sync/pendingSalesCache');
        clearPendingSaleMatches({
          ...result.data,
          clientRequestId: body.clientRequestId,
          client_request_id: body.clientRequestId,
        });
        dispatchSalesChanged(String(body.branchId || data.branchId || ''));
      }
      return result;
    },
    generateInvoiceNumber: (
      branchCode: string,
      params?: { paymentMethod?: string; total?: number; customerNif?: string; invoiceType?: string },
    ) => {
      const qs = new URLSearchParams();
      if (params?.paymentMethod) qs.set('paymentMethod', params.paymentMethod);
      if (params?.total != null) qs.set('total', String(params.total));
      if (params?.customerNif) qs.set('customerNif', params.customerNif);
      if (params?.invoiceType) qs.set('invoiceType', params.invoiceType);
      const q = qs.toString();
      return apiFetch<{ invoiceNumber: string; invoiceType?: string }>(
        `/sales/generate-invoice-number/${encodeURIComponent(branchCode)}${q ? `?${q}` : ''}`,
      );
    },
  },

  // Clients
  clients: {
    list: async () => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>('/clients');
        if (apiResult.data !== undefined) return apiResult;
        return ipcGetAll<any>('clients');
      }
      return apiFetch<any[]>('/clients');
    },
    // HTTP-first (authoritative + broadcasts sync); fall back to direct IPC only if the
    // embedded HTTP backend is unavailable — avoids "Database not connected" on installs
    // where the direct IPC pool isn't open.
    create: async (data: any) => {
      const apiResult = await apiFetch<any>('/clients', { method: 'POST', body: JSON.stringify(data) });
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) return ipcInsert('clients', { id: generateId(), ...data, created_at: new Date().toISOString() });
      return apiResult;
    },
    update: async (id: string, data: any) => {
      const apiResult = await apiFetch<any>(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) return ipcUpdate('clients', id, data);
      return apiResult;
    },
    delete: async (id: string) => {
      const apiResult = await apiFetch<any>(`/clients/${id}`, { method: 'DELETE' });
      if (!apiResult.error) return apiResult;
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) return ipcDelete('clients', id);
      return apiResult;
    },
  },

  // Categories
  categories: {
    list: () => {
      if (isElectronMode()) return ipcGetAll('categories');
      return apiFetch<any[]>('/categories');
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('categories', { id: generateId(), ...data, created_at: new Date().toISOString() });
      return apiFetch<any>('/categories', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('categories', id, data);
      return apiFetch<any>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('categories', id);
      return apiFetch<any>(`/categories/${id}`, { method: 'DELETE' });
    },
  },

  // Suppliers
  suppliers: {
    list: async () => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>('/suppliers');
        if (apiResult.data !== undefined) return apiResult;
        return ipcQuery<any>(
          `SELECT s.*,
                  COALESCE((
                    SELECT SUM(CASE WHEN oi.is_debit THEN oi.remaining_amount ELSE -oi.remaining_amount END)
                    FROM open_items oi
                    WHERE oi.entity_type = 'supplier' AND oi.entity_id = s.id
                  ), 0) AS balance
           FROM suppliers s
           WHERE s.is_active = 1
           ORDER BY s.name`
        );
      }
      return apiFetch<any[]>('/suppliers');
    },
    reconcileBalances: () => {
      return apiFetch<{ repaired: number; updated: number }>('/suppliers/reconcile-balances', { method: 'POST' });
    },
    create: async (data: any) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>('/suppliers', { method: 'POST', body: JSON.stringify(data) });
        if (apiResult.data) return apiResult;
        if (!shouldTrySupplierIpcAfterApiFailure(apiResult)) return apiResult;
        const payload = mapSupplierPayloadForElectron(data);
        const result = await ipcInsert('suppliers', payload);
        if (result.data) {
          await ensureSupplierSubAccountElectron(payload.name, payload.nif, data?.accountParentCode);
        }
        return result;
      }
      return apiFetch<any>('/suppliers', { method: 'POST', body: JSON.stringify(data) });
    },
    batchImport: async (suppliers: any[]) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>('/suppliers/batch', { method: 'POST', body: JSON.stringify({ suppliers }) });
        if (apiResult.data) return apiResult;
        if (!shouldTrySupplierIpcAfterApiFailure(apiResult)) return apiResult;
        let imported = 0, failed = 0;
        const errors: any[] = [];

        for (const supplier of suppliers) {
          const payload = mapSupplierPayloadForElectron(supplier);

          try {
            const existing = await ipcQuery<any>(
              `SELECT id FROM suppliers
               WHERE (NULLIF($1, '') IS NOT NULL AND nif = $1)
                  OR name = $2
               ORDER BY created_at ASC
               LIMIT 1`,
              [payload.nif || '', payload.name]
            );

            const existingId = existing.data?.[0]?.id;
            const result = existingId
              ? await ipcUpdate('suppliers', existingId, {
                  ...payload,
                  id: undefined,
                  created_at: undefined,
                  updated_at: new Date().toISOString(),
                })
              : await ipcInsert('suppliers', payload);

            if (result.data) {
              await ensureSupplierSubAccountElectron(payload.name, payload.nif);
              imported++;
            } else {
              failed++;
              errors.push({ supplier: payload.name, error: result.error || 'Import failed' });
            }
          } catch (error: any) {
            failed++;
            errors.push({ supplier: payload.name, error: error.message || 'Import failed' });
          }
        }

        return { data: { imported, failed, errors } } as ApiResponse<any>;
      }
      return apiFetch<any>('/suppliers/batch', { method: 'POST', body: JSON.stringify({ suppliers }) });
    },
    update: async (id: string, data: any) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        if (apiResult.data) return apiResult;
        if (!shouldTrySupplierIpcAfterApiFailure(apiResult)) return apiResult;
        const payload = mapSupplierPayloadForElectron({ ...data, id, updated_at: new Date().toISOString() });
        delete payload.id;
        const result = await ipcUpdate('suppliers', id, payload);
        if (result.data) {
          await ensureSupplierSubAccountElectron(data.name || payload.name, data.nif || payload.nif, data?.accountParentCode);
        }
        return result;
      }
      return apiFetch<any>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: async (id: string) => {
      if (isElectronMode()) {
        const apiResult = await apiFetch<any>(`/suppliers/${id}`, { method: 'DELETE' });
        if (apiResult.data) return apiResult;
        if (!shouldTrySupplierIpcAfterApiFailure(apiResult)) return apiResult;
        return ipcDelete('suppliers', id);
      }
      return apiFetch<any>(`/suppliers/${id}`, { method: 'DELETE' });
    },
  },

  caixa: {
    listRegisters: (branchId?: string) => {
      const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/caixa/registers${q}`);
    },
    ensureRegister: (body: { branchId: string; branchName?: string }) =>
      apiFetch<any>('/caixa/registers/ensure', { method: 'POST', body: JSON.stringify(body) }),
    reconciliation: (params: {
      branchId: string;
      date: string;
      session?: {
        openingBalance?: number;
        totalIn?: number;
        totalOut?: number;
        salesTotal?: number;
        expensesTotal?: number;
        openedAt?: string;
      };
    }) => {
      const sp = new URLSearchParams();
      sp.set('branchId', params.branchId);
      sp.set('date', params.date);
      if (params.session?.openingBalance != null) {
        sp.set('sessionOpening', String(params.session.openingBalance));
      }
      if (params.session?.totalIn != null) {
        sp.set('sessionCashIn', String(params.session.totalIn));
      }
      if (params.session?.totalOut != null) {
        sp.set('sessionCashOut', String(params.session.totalOut));
      }
      if (params.session?.salesTotal != null) {
        sp.set('sessionSalesTotal', String(params.session.salesTotal));
      }
      if (params.session?.expensesTotal != null) {
        sp.set('sessionExpensesTotal', String(params.session.expensesTotal));
      }
      if (params.session?.openedAt) {
        sp.set('sessionOpenedAt', params.session.openedAt);
      }
      return apiFetch<any>(`/caixa/reconciliation?${sp}`);
    },
    getOpenSession: (branchId: string) =>
      apiFetch<any | null>(`/caixa/sessions/open?branchId=${encodeURIComponent(branchId)}`),
    openSession: (body: Record<string, unknown>) =>
      apiFetch<any>('/caixa/sessions/open', { method: 'POST', body: JSON.stringify(body) }),
    closeSession: (sessionId: string, body: Record<string, unknown>) =>
      apiFetch<any>(`/caixa/sessions/${encodeURIComponent(sessionId)}/close`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    postGlEntry: (body: Record<string, unknown>) =>
      apiFetch<any>('/caixa/gl/post', { method: 'POST', body: JSON.stringify(body) }),
  },

  expenses: {
    list: (branchId?: string) => {
      const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/expenses${q}`);
    },
    save: (expense: Record<string, unknown>) =>
      apiFetch<any>('/expenses', { method: 'POST', body: JSON.stringify(expense) }),
    pay: (id: string, paidBy: string) =>
      apiFetch<any>(`/expenses/${encodeURIComponent(id)}/pay`, {
        method: 'POST',
        body: JSON.stringify({ paidBy }),
      }),
  },

  // Daily Reports — always via HTTP API (aggregates sales on the server)
  dailyReports: {
    list: (branchId?: string) => {
      const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/daily-reports${q}`).then((res) => {
        const localRows = JSON.parse(localStorage.getItem('kwanzaerp_daily_reports') || '[]') as any[];
        const mergeLocal = isDemoMode() || isElectronMode();
        if (!mergeLocal && res.data !== undefined) return res;

        const apiRows = Array.isArray(res.data) ? res.data : [];
        const byKey = new Map<string, any>();
        for (const row of apiRows) {
          const key = `${row.date}|${row.branch_id ?? row.branchId ?? ''}`;
          byKey.set(key, row);
        }
        for (const row of localRows) {
          const key = `${row.date}|${row.branch_id ?? row.branchId ?? ''}`;
          if (!byKey.has(key)) byKey.set(key, row);
        }
        let rows = Array.from(byKey.values());
        if (branchId) {
          rows = rows.filter((r) => (r.branchId || r.branch_id) === branchId);
        }
        rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        return { data: rows, error: res.error };
      });
    },
    generate: (branchId: string, date: string) =>
      apiFetch<any>('/daily-reports/generate', {
        method: 'POST',
        body: JSON.stringify({ branchId, date }),
      }),
    close: (id: string, data: { closingBalance: number; notes: string; closedBy: string }) =>
      apiFetch<any>(`/daily-reports/${id}/close`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // Stock Transfers
  stockTransfers: {
    list: async (branchId?: string) => {
      const endpoint = `/stock-transfers${branchId ? `?branchId=${branchId}` : ''}`;
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>(endpoint);
        if (apiResult.data !== undefined) return apiResult;
        if (await isElectronLanClient()) {
          return { error: apiResult.error || 'Cannot reach server' };
        }
        return (async () => {
          const transfersResult = branchId
            ? await ipcQuery<any>(
                'SELECT * FROM stock_transfers WHERE from_branch_id = $1 OR to_branch_id = $1 ORDER BY created_at DESC',
                [branchId],
              )
            : await ipcQuery<any>('SELECT * FROM stock_transfers ORDER BY created_at DESC');

          if (!transfersResult.data) return transfersResult;

          const transfersWithItems = await Promise.all(
            transfersResult.data.map(async (transfer: any) => {
              const itemsResult = await ipcQuery<any>(
                'SELECT * FROM stock_transfer_items WHERE transfer_id = $1 ORDER BY id ASC',
                [transfer.id],
              );

              return {
                ...transfer,
                items: itemsResult.data || [],
              };
            }),
          );

          return { data: transfersWithItems } as ApiResponse<any[]>;
        })();
      }
      return apiFetch<any[]>(endpoint);
    },
    create: (data: any) => {
      return apiFetch<any>('/stock-transfers', { method: 'POST', body: JSON.stringify(data) });
    },
    approve: (id: string, approvedBy: string) => {
      return apiFetch<any>(`/stock-transfers/${id}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy }) });
    },
    receive: (id: string, receivedBy: string, receivedQuantities?: Record<string, number>) => {
      return apiFetch<any>(`/stock-transfers/${id}/receive`, { method: 'POST', body: JSON.stringify({ receivedBy, receivedQuantities }) });
    },
    cancel: (id: string, cancelledBy: string) => {
      return apiFetch<any>(`/stock-transfers/${id}/cancel`, { method: 'POST', body: JSON.stringify({ cancelledBy }) });
    },
  },

  importOrders: {
    list: (branchId?: string) => {
      const endpoint = `/import-orders${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`;
      return apiFetch<any[]>(endpoint);
    },
    get: (id: string) => apiFetch<any>(`/import-orders/${id}`),
    create: (data: any) => apiFetch<any>('/import-orders', { method: 'POST', body: JSON.stringify(data) }),
    updateStatus: (id: string, status: string) =>
      apiFetch<any>(`/import-orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
    receive: (id: string, data: { receivedBy: string; branchId?: string; warehouseId?: string }) =>
      apiFetch<any>(`/import-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),
  },

  // Purchase Orders
  purchaseOrders: {
    list: async (branchId?: string) => {
      const apiResult = await apiFetch<any[]>(`/purchase-orders${branchId ? `?branchId=${branchId}` : ''}`);
      if (apiResult.data !== undefined || !isElectronMode()) return apiResult;

      const ordersResult = branchId
        ? await ipcQuery<any>('SELECT * FROM purchase_orders WHERE branch_id = $1 ORDER BY created_at DESC', [branchId])
        : await ipcQuery<any>('SELECT * FROM purchase_orders ORDER BY created_at DESC');

      if (!ordersResult.data) return ordersResult;

      const ordersWithItems = await Promise.all(
        ordersResult.data.map(async (order: any) => {
          const itemsResult = await ipcQuery<any>('SELECT * FROM purchase_order_items WHERE order_id = $1 ORDER BY id ASC', [order.id]);
          return { ...order, items: itemsResult.data || [] };
        })
      );

      return { data: ordersWithItems };
    },
    create: (data: any) => {
      return apiFetch<any>('/purchase-orders', { method: 'POST', body: JSON.stringify(data) });
    },
    approve: (id: string, approvedBy: string) => {
      return apiFetch<any>(`/purchase-orders/${id}/approve`, { method: 'POST', body: JSON.stringify({ approvedBy }) });
    },
    receive: (id: string, receivedBy: string, receivedQuantities: Record<string, number>) => {
      return apiFetch<any>(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify({ receivedBy, receivedQuantities }) });
    },
    /** Status-only: PO lines fully received; stock already handled by purchase invoice. */
    markReceivedFromInvoice: (body: { orderNumber: string; supplierId: string; receivedBy?: string }) => {
      return apiFetch<{ success?: boolean; skipped?: boolean }>(
        '/purchase-orders/mark-received-from-invoice',
        { method: 'POST', body: JSON.stringify(body) },
      );
    },
  },

  proformas: {
    list: (branchId?: string) => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/proformas${qs}`);
    },
    get: (id: string) => apiFetch<any>(`/proformas/${encodeURIComponent(id)}`),
    create: (data: any) =>
      apiFetch<any>('/proformas', { method: 'POST', body: JSON.stringify(data) }),
    update: (data: any) =>
      apiFetch<any>(`/proformas/${encodeURIComponent(data.id)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      apiFetch<any>(`/proformas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  purchaseInvoices: {
    list: (params?: { branchId?: string; status?: string }) => {
      const sp = new URLSearchParams();
      if (params?.branchId) sp.append('branchId', params.branchId);
      if (params?.status) sp.append('status', params.status);
      const qs = sp.toString();
      return apiFetch<any[]>(`/purchase-invoices${qs ? `?${qs}` : ''}`, undefined, { timeoutMs: 90000 });
    },
    get: (id: string) => apiFetch<any>(`/purchase-invoices/${encodeURIComponent(id)}`),
    checkDuplicate: (params: { supplierId: string; supplierInvoiceNo: string; excludeId?: string }) => {
      const sp = new URLSearchParams();
      sp.append('supplierId', params.supplierId);
      sp.append('supplierInvoiceNo', params.supplierInvoiceNo);
      if (params.excludeId) sp.append('excludeId', params.excludeId);
      return apiFetch<{ duplicate: boolean; existingId?: string; existingInvoiceNumber?: string }>(
        `/purchase-invoices/check-duplicate?${sp.toString()}`
      );
    },
    save: (invoice: any) =>
      apiFetch<any>('/purchase-invoices', { method: 'POST', body: JSON.stringify(invoice) }, { timeoutMs: 120000 }),
    resolveFreightTreasury: (body: Record<string, unknown>) =>
      apiFetch<{
        paymentSource: string;
        accountCode: string;
        accountName: string;
        caixaId?: string | null;
        bankAccountId?: string | null;
      }>('/purchase-invoices/resolve-freight-treasury', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      apiFetch<any>(`/purchase-invoices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    repostAccounting: (id: string) =>
      apiFetch<{
        success: boolean;
        skipped?: boolean;
        repostedStock?: boolean;
        stockMovementIds?: string[];
        openItemId?: string | null;
        backfill?: { created: number; skipped: number };
        errors?: string[];
        warnings?: string[];
      }>(`/purchase-invoices/${encodeURIComponent(id)}/repost-accounting`, { method: 'POST' }, { timeoutMs: 120000 }),
    backfillAccounting: (limit = 100) =>
      apiFetch<{ posted: number; failed: number; errors?: { id: string; error: string }[] }>(
        '/purchase-invoices/backfill-accounting',
        { method: 'POST', body: JSON.stringify({ limit }) },
      ),
  },

  // Chart of Accounts
  chartOfAccounts: {
    list: async () => {
      const apiResult = await apiFetch<any[]>('/chart-of-accounts');
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode()) {
        return ipcQuery<any>(`
          SELECT
            coa.*,
            parent.name AS parent_name,
            parent.code AS parent_code,
            (SELECT COUNT(*) FROM chart_of_accounts child WHERE child.parent_id = coa.id) AS children_count
          FROM chart_of_accounts coa
          LEFT JOIN chart_of_accounts parent ON coa.parent_id = parent.id
          WHERE coa.is_active = 1
          ORDER BY coa.code
        `);
      }
      return apiResult;
    },
    get: (id: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE id = $1', [id]).then(r => ({ data: r.data?.[0] }));
      return apiFetch<any>(`/chart-of-accounts/${id}`);
    },
    getByType: (type: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE account_type = $1 ORDER BY code', [type]);
      return apiFetch<any[]>(`/chart-of-accounts/type/${type}`);
    },
    getChildren: (id: string) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE parent_id = $1 ORDER BY code', [id]);
      return apiFetch<any[]>(`/chart-of-accounts/${id}/children`);
    },
    getBalance: (id: string, startDate?: string, endDate?: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>('SELECT * FROM chart_of_accounts WHERE id = $1', [id]).then(r => ({ data: r.data?.[0] }));
      }
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      return apiFetch<any>(`/chart-of-accounts/${id}/balance?${params}`);
    },
    getBalanceSheet: (asOf: string, previousAsOf?: string) => {
      const params = new URLSearchParams({ as_of: asOf });
      if (previousAsOf) params.append('previous_as_of', previousAsOf);
      return apiFetch<{ as_of: string; previous_as_of: string | null; rows: any[] }>(
        `/chart-of-accounts/reports/balance-sheet?${params}`,
      );
    },
    getTrialBalance: async (startDate?: string, endDate?: string, branchId?: string) => {
      const params = new URLSearchParams();
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (branchId) params.append('branchId', branchId);
      const qs = params.toString();
      const apiResult = await apiFetch<any[]>(
        `/chart-of-accounts/reports/trial-balance${qs ? `?${qs}` : ''}`,
      );
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT ca.*, 
           COALESCE(SUM(jl.debit_amount), 0) as total_debit,
           COALESCE(SUM(jl.credit_amount), 0) as total_credit
           FROM chart_of_accounts ca
           LEFT JOIN journal_entry_lines jl ON jl.account_id = ca.id
           LEFT JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.is_posted = true
           WHERE ca.is_active = true
           GROUP BY ca.id
           ORDER BY ca.code`,
        );
      }
      return apiResult;
    },
    // Write ops prefer the HTTP backend (authoritative + broadcasts sync); fall back to
    // direct IPC only if the embedded HTTP backend is unavailable. This avoids the
    // "Database not connected" error on installs where the direct IPC pool isn't open.
    create: async (data: any) => {
      const apiResult = await apiFetch<any>('/chart-of-accounts', { method: 'POST', body: JSON.stringify(data) });
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) {
        return ipcInsert('chart_of_accounts', { id: generateId(), ...data, is_active: true, current_balance: 0, created_at: new Date().toISOString() });
      }
      return apiResult;
    },
    update: async (id: string, data: any) => {
      const apiResult = await apiFetch<any>(`/chart-of-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) return ipcUpdate('chart_of_accounts', id, data);
      return apiResult;
    },
    delete: async (id: string) => {
      const apiResult = await apiFetch<any>(`/chart-of-accounts/${id}`, { method: 'DELETE' });
      if (!apiResult.error) return apiResult;
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) return ipcDelete('chart_of_accounts', id);
      return apiResult;
    },
    reseed: () => apiFetch<{ success: boolean; active: number; seeded: number }>(
      '/chart-of-accounts/reseed',
      { method: 'POST' },
    ),
    getLedger: async (id: string, startDate?: string, endDate?: string, _branchId?: string) => {
      const p = new URLSearchParams();
      if (startDate) p.append('start_date', startDate);
      if (endDate) p.append('end_date', endDate);
      // COA drill-down is company-wide — never send branchId (supplier AP spans filials).
      const qs = p.toString();
      const apiResult = await apiFetch<any[]>(
        `/chart-of-accounts/${encodeURIComponent(id)}/ledger${qs ? `?${qs}` : ''}`,
      );
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode()) {
        let sql = `
          WITH RECURSIVE account_tree AS (
            SELECT id, code, name FROM chart_of_accounts WHERE id = $1
            UNION ALL
            SELECT c.id, c.code, c.name
            FROM chart_of_accounts c
            INNER JOIN account_tree t ON c.parent_id = t.id
          )
          SELECT jel.*, atree.code AS account_code, atree.name AS account_name,
                 je.entry_number, je.entry_date, je.description as journal_description,
                 je.reference_type, je.reference_id, je.branch_id,
                 b.name AS branch_name, je.is_posted, je.created_at as journal_created_at
          FROM journal_entry_lines jel
          INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
          INNER JOIN account_tree atree ON atree.id = jel.account_id
          LEFT JOIN branches b ON CAST(b.id AS TEXT) = CAST(je.branch_id AS TEXT)
          WHERE je.is_posted = true
        `;
        const params: any[] = [id];
        if (startDate && endDate) {
          sql += ' AND je.entry_date BETWEEN $2 AND $3';
          params.push(startDate, endDate);
        }
        sql += ' ORDER BY je.entry_date DESC, je.created_at DESC';
        return ipcQuery<any>(sql, params);
      }
      return apiResult;
    },
  },

  // Journal Entries — always read from Express API (journal data lives in embedded SQLite)
  journalEntries: {
    list: (params?: { branchId?: string; referenceType?: string; startDate?: string; endDate?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.branchId) searchParams.append('branchId', params.branchId);
      if (params?.referenceType) searchParams.append('referenceType', params.referenceType);
      if (params?.startDate) searchParams.append('startDate', params.startDate);
      if (params?.endDate) searchParams.append('endDate', params.endDate);
      const qs = searchParams.toString();
      return apiFetch<any[]>(`/journal-entries${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => {
      return apiFetch<any>(`/journal-entries/${encodeURIComponent(id)}`);
    },
    getByReference: (type: string, id: string) => {
      return apiFetch<any[]>(
        `/journal-entries/reference/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      );
    },
    summary: async (params?: { branchId?: string; startDate?: string; endDate?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.branchId) searchParams.append('branchId', params.branchId);
      if (params?.startDate) searchParams.append('startDate', params.startDate);
      if (params?.endDate) searchParams.append('endDate', params.endDate);
      const qs = searchParams.toString();
      const apiResult = await apiFetch<any[]>(
        `/journal-entries/reports/summary${qs ? `?${qs}` : ''}`,
      );
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT reference_type, COUNT(*) as count, 
           SUM(total_debit) as total_debit, SUM(total_credit) as total_credit
           FROM journal_entries WHERE is_posted = true
           GROUP BY reference_type ORDER BY reference_type`,
        );
      }
      return apiResult;
    },
  },

  // Payments & Open Items
  payments: {
    list: (params?: { entityType?: string; entityId?: string; branchId?: string }) => {
      const sp = new URLSearchParams();
      if (params?.entityType) sp.append('entityType', params.entityType);
      if (params?.entityId) sp.append('entityId', params.entityId);
      if (params?.branchId) sp.append('branchId', params.branchId);
      const query = sp.toString();
      return apiFetch<any[]>(`/payments${query ? `?${query}` : ''}`).then((res) => {
        if (res.data !== undefined || !isDemoMode()) return res;
        let rows = JSON.parse(localStorage.getItem('kwanzaerp_payments') || '[]') as any[];
        if (params?.entityType) rows = rows.filter((p) => p.entityType === params.entityType || p.entity_type === params.entityType);
        if (params?.entityId) rows = rows.filter((p) => p.entityId === params.entityId || p.entity_id === params.entityId);
        if (params?.branchId) rows = rows.filter((p) => p.branchId === params.branchId || p.branch_id === params.branchId);
        rows.sort((a, b) => String(b.createdAt || b.created_at || '').localeCompare(String(a.createdAt || a.created_at || '')));
        return { data: rows };
      });
    },
    payablesAging: () => apiFetch<any[]>('/payments/payables-aging'),
    checklistDues: () =>
      apiFetch<{ receivables: any[]; payables: any[] }>('/payments/checklist-dues'),
    backfillMissingPayables: () =>
      apiFetch<{ created: number; skipped: number }>(
        '/payments/backfill-missing-payables',
        { method: 'POST' },
      ),
    repairSupplierPayables: () =>
      apiFetch<{ backfill: { created: number; skipped: number }; payablesCount: number }>(
        '/payments/repair-supplier-payables',
        { method: 'POST' },
      ),
    receivablesAging: () => apiFetch<any[]>('/payments/receivables-aging'),
    create: (data: any) => {
      return apiFetch<any>('/payments', { method: 'POST', body: JSON.stringify(data) }).then((res) => {
        if (res.data !== undefined || !isDemoMode()) return res;
        const now = new Date().toISOString();
        const prefix = data.paymentType === 'receipt' ? 'REC' : 'PAG';
        const stored = {
          id: generateId(),
          payment_number: `${prefix}-${now.slice(0, 10).replace(/-/g, '')}-${String(Date.now()).slice(-4)}`,
          payment_type: data.paymentType,
          entity_type: data.entityType,
          entity_id: data.entityId,
          entity_name: data.entityName,
          payment_method: data.paymentMethod,
          amount: data.amount,
          currency: data.currency || 'AOA',
          reference: data.reference || '',
          notes: data.notes || '',
          branch_id: data.branchId,
          created_by: data.createdBy,
          created_at: now,
        };
        const rows = JSON.parse(localStorage.getItem('kwanzaerp_payments') || '[]');
        rows.push(stored);
        localStorage.setItem('kwanzaerp_payments', JSON.stringify(rows));
        return { data: stored };
      });
    },
    openItems: (entityType: string, entityId: string) => {
      if (isDemoMode()) {
        const items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]')
          .filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId && oi.status !== 'cleared')
          .sort((a: any, b: any) => `${a.documentDate || ''}${a.createdAt || ''}`.localeCompare(`${b.documentDate || ''}${b.createdAt || ''}`));
        return Promise.resolve({ data: items }) as Promise<ApiResponse<any[]>>;
      }
      return apiFetch<any[]>(`/payments/open-items/${entityType}/${entityId}`);
    },
    balance: (entityType: string, entityId: string) => {
      if (isDemoMode()) {
        const items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]')
          .filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId && oi.status !== 'cleared');
        const balance = items.reduce((sum: number, oi: any) => {
          const remaining = Number(oi.remainingAmount ?? oi.originalAmount ?? 0);
          return sum + (oi.isDebit ? remaining : -remaining);
        }, 0);
        return Promise.resolve({ data: { balance, open_items_count: items.length } }) as Promise<ApiResponse<any>>;
      }
      return apiFetch<any>(`/payments/balance/${entityType}/${entityId}`);
    },
    statement: (entityType: string, entityId: string, dateFrom?: string, dateTo?: string) => {
      if (isElectronMode()) {
        // Build combined query for electron mode
        return (async () => {
          const oiParams: any[] = [entityType, entityId];
          let oiSql = `SELECT id, document_type, document_id, document_number, document_date, due_date,
                        original_amount, remaining_amount, is_debit, status, created_at
                        FROM open_items WHERE entity_type = $1 AND entity_id = $2`;
          let idx = 3;
          if (dateFrom) { oiSql += ` AND document_date >= $${idx++}`; oiParams.push(dateFrom); }
          if (dateTo)   { oiSql += ` AND document_date <= $${idx++}`; oiParams.push(dateTo); }
          oiSql += ' ORDER BY document_date ASC, created_at ASC';

          const pParams: any[] = [entityType, entityId];
          let pSql = `SELECT id, payment_number, payment_type, payment_method, amount, reference, notes, created_at
                      FROM payments WHERE entity_type = $1 AND entity_id = $2`;
          idx = 3;
          if (dateFrom) { pSql += ` AND created_at >= $${idx++}`; pParams.push(dateFrom); }
          if (dateTo)   { pSql += ` AND created_at <= $${idx++}`; pParams.push(dateTo + 'T23:59:59'); }
          pSql += ' ORDER BY created_at ASC';

          const balSql = `SELECT
            COALESCE(SUM(CASE WHEN is_debit = 1 THEN remaining_amount ELSE -remaining_amount END), 0) AS balance,
            COALESCE(SUM(CASE WHEN status != 'cleared' THEN 1 ELSE 0 END), 0) AS open_items_count
            FROM open_items WHERE entity_type = $1 AND entity_id = $2`;
          const [oiRes, pRes, balRes] = await Promise.all([
            ipcQuery<any>(oiSql, oiParams),
            ipcQuery<any>(pSql, pParams),
            ipcQuery<any>(balSql, [entityType, entityId]),
          ]);

          return { data: { openItems: oiRes.data || [], payments: pRes.data || [], balance: balRes.data?.[0] || { balance: 0 } } } as ApiResponse<any>;
        })();
      }
      if (isDemoMode()) {
        const openItems = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]')
          .filter((oi: any) => oi.entityType === entityType && oi.entityId === entityId)
          .filter((oi: any) => !dateFrom || oi.documentDate >= dateFrom)
          .filter((oi: any) => !dateTo || oi.documentDate <= dateTo)
          .sort((a: any, b: any) => `${a.documentDate || ''}${a.createdAt || ''}`.localeCompare(`${b.documentDate || ''}${b.createdAt || ''}`));

        const payments = JSON.parse(localStorage.getItem('kwanzaerp_payments') || '[]')
          .filter((payment: any) => payment.entityType === entityType && payment.entityId === entityId)
          .filter((payment: any) => !dateFrom || payment.createdAt >= dateFrom)
          .filter((payment: any) => !dateTo || payment.createdAt <= `${dateTo}T23:59:59`)
          .sort((a: any, b: any) => (a.createdAt || '').localeCompare(b.createdAt || ''));

        const balance = openItems.reduce((sum: number, oi: any) => {
          const remaining = Number(oi.remainingAmount ?? oi.originalAmount ?? 0);
          return sum + (oi.isDebit ? remaining : -remaining);
        }, 0);

        return Promise.resolve({
          data: {
            openItems,
            payments,
            balance: { balance, open_items_count: openItems.filter((oi: any) => oi.status !== 'cleared').length },
          },
        }) as Promise<ApiResponse<any>>;
      }
      const sp = new URLSearchParams();
      if (dateFrom) sp.append('dateFrom', dateFrom);
      if (dateTo) sp.append('dateTo', dateTo);
      return apiFetch<any>(`/payments/statement/${entityType}/${entityId}?${sp}`);
    },
    periods: async (year?: number) => {
      const qs = year != null ? `?year=${encodeURIComponent(String(year))}` : '';
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>(`/payments/periods${qs}`);
        if (Array.isArray(apiResult.data)) return { data: apiResult.data };
        if (await isElectronLanClient()) {
          return { error: apiResult.error || 'Cannot reach server' };
        }
        let sql = 'SELECT * FROM accounting_periods';
        const params: unknown[] = [];
        if (year != null) {
          sql += ' WHERE year = $1';
          params.push(year);
        }
        sql += ' ORDER BY year DESC, month DESC';
        return ipcQuery<any>(sql, params);
      }
      return apiFetch<any[]>(`/payments/periods${qs}`);
    },
    closePeriod: (id: string, closedBy: string) => {
      if (isElectronMode()) {
        return apiFetch<{ success?: boolean }>(`/payments/periods/${encodeURIComponent(id)}/close`, {
          method: 'POST',
          body: JSON.stringify({ closedBy }),
        }).then(async (apiResult) => {
          if (apiResult.error) {
            if (await isElectronLanClient()) return apiResult;
            return ipcUpdate('accounting_periods', id, {
              status: 'closed',
              closed_by: closedBy,
              closed_at: new Date().toISOString(),
            });
          }
          return apiResult;
        });
      }
      return apiFetch<{ success?: boolean }>(`/payments/periods/${encodeURIComponent(id)}/close`, {
        method: 'POST',
        body: JSON.stringify({ closedBy }),
      });
    },
    lockPeriod: (id: string) => {
      if (isElectronMode()) {
        return apiFetch<{ success?: boolean }>(`/payments/periods/${encodeURIComponent(id)}/lock`, {
          method: 'POST',
          body: JSON.stringify({}),
        }).then(async (apiResult) => {
          if (apiResult.error) {
            if (await isElectronLanClient()) return apiResult;
            return ipcUpdate('accounting_periods', id, { status: 'locked' });
          }
          return apiResult;
        });
      }
      return apiFetch<{ success?: boolean }>(`/payments/periods/${encodeURIComponent(id)}/lock`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    reopenPeriod: (id: string) => {
      if (isElectronMode()) {
        return apiFetch<{ success?: boolean }>(`/payments/periods/${encodeURIComponent(id)}/reopen`, {
          method: 'POST',
          body: JSON.stringify({}),
        }).then(async (apiResult) => {
          if (apiResult.error) {
            if (await isElectronLanClient()) return apiResult;
            return ipcUpdate('accounting_periods', id, {
              status: 'open',
              closed_by: null,
              closed_at: null,
            });
          }
          return apiResult;
        });
      }
      return apiFetch<{ success?: boolean }>(`/payments/periods/${encodeURIComponent(id)}/reopen`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
    },
    stockMovements: (params?: { productId?: string; warehouseId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT sm.*, p.name as product_name, p.sku FROM stock_movements sm LEFT JOIN products p ON p.id = sm.product_id WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.productId) { sql += ` AND sm.product_id = $${idx++}`; sqlParams.push(params.productId); }
        if (params?.warehouseId) { sql += ` AND sm.warehouse_id = $${idx++}`; sqlParams.push(params.warehouseId); }
        sql += ' ORDER BY sm.created_at DESC LIMIT 500';
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.productId) sp.append('productId', params.productId);
      if (params?.warehouseId) sp.append('warehouseId', params.warehouseId);
      return apiFetch<any[]>(`/payments/stock-movements?${sp}`);
    },
    documentFlow: (docType: string, docId: string) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM document_links WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2)',
        [docType, docId]
      );
      return apiFetch<any[]>(`/payments/document-flow/${docType}/${docId}`);
    },
  },

  // Tax Engine
  tax: {
    codes: () => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM tax_codes ORDER BY code');
      return apiFetch<any[]>('/tax/codes');
    },
    createCode: (data: any) => {
      if (isElectronMode()) return ipcInsert('tax_codes', { id: generateId(), ...data });
      return apiFetch<any>('/tax/codes', { method: 'POST', body: JSON.stringify(data) });
    },
    updateCode: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('tax_codes', id, data);
      return apiFetch<any>(`/tax/codes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    taxLines: (docType: string, docId: string) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM tax_summaries WHERE document_type = $1 AND document_id = $2', [docType, docId]
      );
      return apiFetch<any[]>(`/tax/lines/${docType}/${docId}`);
    },
    ivaReport: (year?: number, month?: number) => {
      if (isElectronMode()) {
        let sql = `SELECT direction, tax_code, tax_rate,
                   SUM(total_base) AS total_base, SUM(total_tax) AS total_tax,
                   COUNT(*) AS document_count
                   FROM tax_summaries WHERE tax_code LIKE 'IVA%'`;
        const params: any[] = [];
        let idx = 1;
        if (year) { sql += ` AND period_year = $${idx++}`; params.push(year); }
        if (month) { sql += ` AND period_month = $${idx++}`; params.push(month); }
        sql += ' GROUP BY direction, tax_code, tax_rate ORDER BY direction, tax_rate';
        return ipcQuery<any>(sql, params).then((r) => {
          const lines = (r.data || []) as Array<{
            direction: string;
            tax_code: string;
            tax_rate: number;
            total_base: string | number;
            total_tax: string | number;
            document_count: string | number;
          }>;
          const outputTax = lines
            .filter((row) => row.direction === 'output')
            .reduce((sum, row) => sum + Number(row.total_tax || 0), 0);
          const inputTax = lines
            .filter((row) => row.direction === 'input')
            .reduce((sum, row) => sum + Number(row.total_tax || 0), 0);
          return { data: { lines, outputTax, inputTax, ivaPayable: outputTax - inputTax } };
        });
      }
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (month) sp.append('month', month.toString());
      return apiFetch<any>(`/tax/iva-report?${sp}`);
    },
    fiscalDocumentsReport: (year?: number, month?: number) => {
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (month) sp.append('month', month.toString());
      return apiFetch<{
        lines: Array<{
          docType: string;
          documentCount: number;
          subtotal: number;
          taxAmount: number;
          total: number;
          agtValidatedCount: number;
        }>;
        totals: {
          documentCount: number;
          subtotal: number;
          taxAmount: number;
          total: number;
          agtValidatedCount: number;
        };
      }>(`/tax/fiscal-documents-report?${sp}`);
    },
    summary: (year?: number, month?: number) => {
      if (isElectronMode()) {
        let sql = `SELECT tax_code, direction, SUM(total_base) as total_base, SUM(total_tax) as total_tax
                   FROM tax_summaries WHERE 1=1`;
        const params: any[] = [];
        let idx = 1;
        if (year) { sql += ` AND period_year = $${idx++}`; params.push(year); }
        if (month) { sql += ` AND period_month = $${idx++}`; params.push(month); }
        sql += ' GROUP BY tax_code, direction';
        return ipcQuery<any>(sql, params);
      }
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (month) sp.append('month', month.toString());
      return apiFetch<any[]>(`/tax/summary?${sp}`);
    },
  },

  // Audit Trail
  audit: {
    list: async (params?: { tableName?: string; action?: string; userId?: string; startDate?: string; endDate?: string; limit?: number }) => {
      const sp = new URLSearchParams();
      if (params?.tableName) sp.append('tableName', params.tableName);
      if (params?.action) sp.append('action', params.action);
      if (params?.userId) sp.append('userId', params.userId);
      if (params?.startDate) sp.append('startDate', params.startDate);
      if (params?.endDate) sp.append('endDate', params.endDate);
      if (params?.limit) sp.append('limit', params.limit.toString());
      const qs = sp.toString();
      const apiResult = await apiFetch<any[]>(`/audit${qs ? `?${qs}` : ''}`);
      if (apiResult.data !== undefined && !apiResult.error) return apiResult;
      if (isElectronMode()) {
        let sql = 'SELECT * FROM audit_log WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.tableName) { sql += ` AND table_name = $${idx++}`; sqlParams.push(params.tableName); }
        if (params?.action) { sql += ` AND action = $${idx++}`; sqlParams.push(params.action); }
        if (params?.userId) { sql += ` AND user_id = $${idx++}`; sqlParams.push(params.userId); }
        sql += ` ORDER BY created_at DESC LIMIT $${idx++}`;
        sqlParams.push(params?.limit || 200);
        return ipcQuery<any>(sql, sqlParams);
      }
      return apiResult;
    },
    recordHistory: (tableName: string, recordId: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          'SELECT * FROM audit_log WHERE table_name = $1 AND record_id = $2 ORDER BY created_at DESC',
          [tableName, recordId],
        );
      }
      return apiFetch<any[]>(`/audit/record/${tableName}/${recordId}`);
    },
    stats: (days?: number) => {
      if (isElectronMode()) return ipcQuery<any>(
        `SELECT entity_type, action, COUNT(*) as count FROM audit_logs 
         WHERE timestamp >= NOW() - INTERVAL '${days || 30} days' 
         GROUP BY entity_type, action ORDER BY count DESC`
      );
      return apiFetch<any[]>(`/audit/stats?days=${days || 30}`);
    },
    log: (data: {
      tableName?: string;
      recordId?: string;
      action: string;
      description?: string;
      metadata?: Record<string, unknown>;
      oldValues?: Record<string, unknown>;
      newValues?: Record<string, unknown>;
    }) => apiFetch<any>('/audit', { method: 'POST', body: JSON.stringify(data) }),
  },

  // Budgets & Cost Centers
  budgets: {
    costCenters: () => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM cost_centers ORDER BY name');
      return apiFetch<any[]>('/budgets/cost-centers');
    },
    createCostCenter: (data: any) => {
      if (isElectronMode()) return ipcInsert('cost_centers', { id: generateId(), ...data });
      return apiFetch<any>('/budgets/cost-centers', { method: 'POST', body: JSON.stringify(data) });
    },
    updateCostCenter: (id: string, data: any) => {
      if (isElectronMode()) return ipcUpdate('cost_centers', id, data);
      return apiFetch<any>(`/budgets/cost-centers/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    list: (params?: { year?: number; month?: number; costCenterId?: string }) => {
      if (isElectronMode()) return ipcQuery<any>('SELECT * FROM budgets ORDER BY year DESC, month DESC');
      const sp = new URLSearchParams();
      if (params?.year) sp.append('year', params.year.toString());
      if (params?.month) sp.append('month', params.month.toString());
      if (params?.costCenterId) sp.append('costCenterId', params.costCenterId);
      return apiFetch<any[]>(`/budgets/budgets?${sp}`);
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('budgets', { id: generateId(), ...data });
      return apiFetch<any>('/budgets/budgets', { method: 'POST', body: JSON.stringify(data) });
    },
    summary: (year?: number) => {
      if (isElectronMode()) return ipcQuery<any>(
        'SELECT * FROM budgets WHERE year = $1 ORDER BY month', [year || new Date().getFullYear()]
      );
      return apiFetch<any[]>(`/budgets/summary?year=${year || new Date().getFullYear()}`);
    },
  },

  // Approvals
  approvals: {
    workflows: (documentType?: string) => {
      if (isElectronMode()) {
        if (documentType) return ipcQuery<any>('SELECT * FROM approval_workflows WHERE document_type = $1', [documentType]);
        return ipcQuery<any>('SELECT * FROM approval_workflows ORDER BY created_at DESC');
      }
      const sp = documentType ? `?documentType=${documentType}` : '';
      return apiFetch<any[]>(`/approvals/workflows${sp}`);
    },
    createWorkflow: (data: any) => {
      if (isElectronMode()) return ipcInsert('approval_workflows', { id: generateId(), ...data });
      return apiFetch<any>('/approvals/workflows', { method: 'POST', body: JSON.stringify(data) });
    },
    requests: (params?: { status?: string; documentType?: string; branchId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM approval_requests WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.status) { sql += ` AND status = $${idx++}`; sqlParams.push(params.status); }
        if (params?.documentType) { sql += ` AND document_type = $${idx++}`; sqlParams.push(params.documentType); }
        if (params?.branchId) { sql += ` AND branch_id = $${idx++}`; sqlParams.push(params.branchId); }
        sql += ' ORDER BY created_at DESC';
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.status) sp.append('status', params.status);
      if (params?.documentType) sp.append('documentType', params.documentType);
      if (params?.branchId) sp.append('branchId', params.branchId);
      return apiFetch<any[]>(`/approvals/requests?${sp}`);
    },
    submitRequest: (data: any) => {
      if (isElectronMode()) return ipcInsert('approval_requests', { id: generateId(), ...data, status: 'pending', created_at: new Date().toISOString() });
      return apiFetch<any>('/approvals/requests', { method: 'POST', body: JSON.stringify(data) });
    },
    approve: (id: string, userId: string, userName: string, comments?: string) => {
      if (isElectronMode()) return ipcUpdate('approval_requests', id, {
        status: 'approved', approved_by: userId, approver_name: userName,
        comments: comments || '', approved_at: new Date().toISOString(),
      });
      return apiFetch<any>(`/approvals/requests/${id}/approve`, {
        method: 'POST', body: JSON.stringify({ userId, userName, comments }),
      });
    },
    reject: (id: string, userId: string, userName: string, comments: string) => {
      if (isElectronMode()) return ipcUpdate('approval_requests', id, {
        status: 'rejected', rejected_by: userId, rejector_name: userName,
        comments, rejected_at: new Date().toISOString(),
      });
      return apiFetch<any>(`/approvals/requests/${id}/reject`, {
        method: 'POST', body: JSON.stringify({ userId, userName, comments }),
      });
    },
    pendingCount: () => {
      if (isElectronMode()) return ipcQuery<any>("SELECT COUNT(*) as count FROM approval_requests WHERE status = 'pending'");
      return apiFetch<any[]>('/approvals/pending-count');
    },
  },

  // SAF-T AO
  saft: {
    generate: (params?: {
      year?: number;
      startDate?: string;
      endDate?: string;
      branchId?: string;
      includeVoided?: boolean;
      company?: Record<string, unknown>;
    }) => {
      const sp = new URLSearchParams();
      if (params?.year) sp.append('year', params.year.toString());
      if (params?.startDate) sp.append('startDate', params.startDate);
      if (params?.endDate) sp.append('endDate', params.endDate);
      if (params?.branchId) sp.append('branchId', params.branchId);
      if (params?.includeVoided) sp.append('includeVoided', 'true');
      if (params?.company) {
        return apiFetch<any>('/saft/generate', {
          method: 'POST',
          body: JSON.stringify({ ...params, company: params.company }),
        });
      }
      return apiFetch<any>(`/saft/generate?${sp}`);
    },
    preview: (params: {
      startDate: string;
      endDate: string;
      branchId?: string;
      includeVoided?: boolean;
    }) => {
      const sp = new URLSearchParams();
      sp.append('startDate', params.startDate);
      sp.append('endDate', params.endDate);
      if (params.branchId) sp.append('branchId', params.branchId);
      if (params.includeVoided) sp.append('includeVoided', 'true');
      return apiFetch<any>(`/saft/preview?${sp}`);
    },
    exportUrl: (params: {
      startDate: string;
      endDate: string;
      branchId?: string;
      includeVoided?: boolean;
      format?: 'json' | 'xml';
    }) => {
      const sp = new URLSearchParams();
      sp.append('startDate', params.startDate);
      sp.append('endDate', params.endDate);
      if (params.branchId) sp.append('branchId', params.branchId);
      if (params.includeVoided) sp.append('includeVoided', 'true');
      sp.append('format', params.format || 'xml');
      return `${getApiUrl()}/api/saft/export?${sp}`;
    },
    export: (params: {
      startDate: string;
      endDate: string;
      branchId?: string;
      includeVoided?: boolean;
      format?: 'json' | 'xml';
      company?: Record<string, unknown>;
    }) => {
      const sp = new URLSearchParams();
      sp.append('format', params.format || 'json');
      return apiFetch<any>(`/saft/export?${sp}`, {
        method: 'POST',
        body: JSON.stringify({
          startDate: params.startDate,
          endDate: params.endDate,
          branchId: params.branchId,
          includeVoided: params.includeVoided,
          company: params.company,
        }),
      });
    },
    summary: (year?: number, branchId?: string) => {
      const sp = new URLSearchParams();
      sp.append('year', (year || new Date().getFullYear()).toString());
      if (branchId) sp.append('branchId', branchId);
      return apiFetch<any>(`/saft/summary?${sp}`);
    },
    validate: (params: {
      startDate: string;
      endDate: string;
      branchId?: string;
      includeVoided?: boolean;
      company?: Record<string, unknown>;
    }) =>
      apiFetch<{
        ok: boolean;
        issues: Array<{ level: string; code: string; message: string; xpath?: string }>;
        errorCount: number;
        warningCount: number;
        engine: string;
        schemaVersion?: string;
        xsdPath?: string;
        filename?: string;
        period?: { start: string; end: string };
      }>('/saft/validate', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  },

  companySettings: {
    get: () => apiFetch<any>('/company-settings'),
    save: (settings: Record<string, unknown>) =>
      apiFetch<any>('/company-settings', { method: 'PUT', body: JSON.stringify(settings) }),
  },

  dailyBriefing: {
    get: (branchId?: string) => {
      const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<{
        lowStock: any[];
        receivables: any[];
        payables: any[];
        unprintedInvoices: any[];
        priceChanges: any[];
      }>(`/daily-briefing${q}`);
    },
  },

  deployment: {
    status: () =>
      apiFetch<{
        ok: boolean;
        engine: string;
        appVersion: string;
        schemaVersion: number | null;
        schemaVersionExpected: number;
        schemaUpToDate: boolean;
        database: {
          path: string | null;
          sizeBytes: number;
          modifiedAt: string | null;
          counts?: Record<string, number | null>;
        };
        ipFile?: { ipPath: string; configuredPath: string | null };
        backups: {
          directory: string | null;
          count: number;
          latest: { filename: string; sizeBytes: number; createdAt: string } | null;
        };
        duplicateDatabases: { path: string; sizeBytes: number; sizeMb?: number }[];
        warnings: { code: string; message: string; paths?: string[] }[];
        checkedAt: string;
      }>('/deployment/status'),
  },

  sync: {
    overview: () => apiFetch<any>('/sync/overview'),
    consolidation: (params?: { startDate?: string; endDate?: string }) => {
      const q = new URLSearchParams();
      if (params?.startDate) q.set('startDate', params.startDate);
      if (params?.endDate) q.set('endDate', params.endDate);
      const qs = q.toString();
      return apiFetch<any>(`/sync/consolidation${qs ? `?${qs}` : ''}`);
    },
    deadLetter: (limit = 50) => apiFetch<{ events: any[] }>(`/sync/dead-letter?limit=${limit}`),
    replayDeadLetter: (id: string) =>
      apiFetch<any>(`/sync/dead-letter/${encodeURIComponent(id)}/replay`, { method: 'POST' }),
    resolveDeadLetter: (id: string, note?: string) =>
      apiFetch<any>(`/sync/dead-letter/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      }),
    masterData: (branchId: string, since?: string) => {
      const q = new URLSearchParams({ branchId });
      if (since) q.set('since', since);
      return apiFetch<any>(`/sync/master-data?${q.toString()}`);
    },
  },

  installations: {
    config: () => apiFetch<{
      id: string;
      role: string;
      cityId?: string;
      branchId?: string;
      mainApiUrl?: string;
      hasApiKey: boolean;
      isMainServer: boolean;
      isCityServer: boolean;
    }>('/installations/config'),
    registerMain: () =>
      apiFetch<{ success: boolean; installationId?: string; apiKey?: string }>(
        '/installations/register-main',
        { method: 'POST', body: JSON.stringify({}) },
      ),
    registerCity: (data: {
      province: string;
      municipio: string;
      mainApiUrl?: string | null;
      branchId?: string;
    }) =>
      apiFetch<any>('/installations/register-city', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },

  // Dashboard KPIs
  dashboard: {
    kpis: (branchId?: string) => {
      const q = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any>(`/dashboard${q}`).then((res) => {
        if (!res.data) return res;
        const d = res.data;
        return {
          data: {
            todaySales: {
              count: Number(d.todaySales?.count ?? d.todaySalesCount ?? 0),
              total: Number(d.todaySales?.total ?? d.todaySalesTotal ?? 0),
            },
            monthSales: {
              count: Number(d.monthSales?.count ?? d.monthSalesCount ?? 0),
              total: Number(d.monthSales?.total ?? d.monthSalesTotal ?? 0),
            },
            openAR: d.openAR ?? { count: 0, total: 0 },
            openAP: d.openAP ?? { count: 0, total: 0 },
            lowStockCount: Number(d.lowStockCount ?? 0),
            pendingApprovals: Number(d.pendingApprovals ?? 0),
            monthExpenses: Number(d.monthExpenses ?? 0),
          },
        };
      });
    },
  },

  // Exchange Rates
  exchangeRates: {
    list: (limit?: number) => {
      if (isElectronMode()) return ipcQuery<any>(`SELECT * FROM exchange_rates ORDER BY effective_date DESC LIMIT ${limit || 50}`);
      const sp = limit ? `?limit=${limit}` : '';
      return apiFetch<any[]>(`/exchange-rates${sp}`);
    },
    latest: () => {
      if (isElectronMode()) return ipcQuery<any>(
        `SELECT DISTINCT ON (from_currency, to_currency) * FROM exchange_rates ORDER BY from_currency, to_currency, effective_date DESC`
      );
      return apiFetch<any[]>('/exchange-rates/latest');
    },
    create: (data: any) => {
      if (isElectronMode()) return ipcInsert('exchange_rates', { id: generateId(), ...data, created_at: new Date().toISOString() });
      return apiFetch<any>('/exchange-rates', { method: 'POST', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      if (isElectronMode()) return ipcDelete('exchange_rates', id);
      return apiFetch<any>(`/exchange-rates/${id}`, { method: 'DELETE' });
    },
    convert: (from: string, to: string, amount: number, date?: string) => {
      if (isElectronMode()) {
        return ipcQuery<any>(
          `SELECT rate FROM exchange_rates WHERE from_currency = $1 AND to_currency = $2 ORDER BY effective_date DESC LIMIT 1`,
          [from, to]
        ).then(r => {
          const rate = parseFloat(r.data?.[0]?.rate || '1');
          return { data: { convertedAmount: amount * rate, rate } };
        });
      }
      const sp = new URLSearchParams({ from, to, amount: amount.toString() });
      if (date) sp.append('date', date);
      return apiFetch<any>(`/exchange-rates/convert?${sp}`);
    },
  },

  // SAF-T XML
  saftXml: {
    downloadUrl: (params?: {
      year?: number;
      startDate?: string;
      endDate?: string;
      branchId?: string;
      includeVoided?: boolean;
    }) => {
      const baseUrl = getApiUrl();
      const sp = new URLSearchParams();
      if (params?.year) sp.append('year', params.year.toString());
      if (params?.startDate) sp.append('startDate', params.startDate);
      if (params?.endDate) sp.append('endDate', params.endDate);
      if (params?.branchId) sp.append('branchId', params.branchId);
      if (params?.includeVoided) sp.append('includeVoided', 'true');
      const qs = sp.toString();
      return `${baseUrl}/api/saft-xml/download${qs ? `?${qs}` : ''}`;
    },
  },

  // Users — always via Express /api/auth/users (admin JWT required; no IPC fallback)
  users: {
    list: async () => {
      await ensureBackendAuthToken();
      const apiResult = await apiFetch<any[]>('/auth/users');
      if (isElectronMode() && shouldTryIpcAfterApiFailure(apiResult)) {
        return ipcQuery<any>(
          'SELECT id, name, email, role, branch_id, is_active, created_at, updated_at FROM users ORDER BY name',
        );
      }
      return apiResult;
    },
    create: async (data: any) => {
      const body = {
        name: data.name,
        email: data.email,
        username: data.username,
        role: data.role || 'cashier',
        branchId: data.branchId,
        password: data.password,
      };
      await ensureBackendAuthToken();
      return apiFetch<any>('/auth/users', { method: 'POST', body: JSON.stringify(body) });
    },
    update: async (id: string, data: any) => {
      const body = {
        name: data.name,
        email: data.email,
        username: data.username,
        role: data.role,
        branchId: data.branchId ?? data.branch_id,
        isActive: data.isActive ?? data.is_active,
        password: data.password,
        ...(data.permissionOverrides !== undefined ? { permissionOverrides: data.permissionOverrides } : {}),
      };
      await ensureBackendAuthToken();
      return apiFetch<any>(`/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    },
    delete: async (id: string) => {
      await ensureBackendAuthToken();
      return apiFetch<any>(`/auth/users/${id}`, { method: 'DELETE' });
    },
  },

  agt: {
    getConfig: () => apiFetch<{
      environment: string;
      apiUrl: string;
      statusUrl: string;
      companyNif: string;
      softwareCertificateNumber: string;
      simulate: boolean;
      autoTransmit: boolean;
      hasApiKey: boolean;
    }>('/agt/config'),
    saveConfig: (data: Record<string, unknown>) =>
      apiFetch<any>('/agt/config', { method: 'PUT', body: JSON.stringify(data) }),
    transmit: (data: { entityType: string; entityId: string; force?: boolean; documentNumber?: string; invoiceNumber?: string }) =>
      apiFetch<{
        success: boolean;
        skipped?: boolean;
        agtCode?: string;
        agtStatus?: string;
        validatedAt?: string;
        error?: string;
      }>('/agt/transmit', { method: 'POST', body: JSON.stringify(data) }),
    getSaleStatus: (saleId: string, documentNumber?: string) => {
      const qs = new URLSearchParams();
      if (documentNumber) qs.set('documentNumber', documentNumber);
      const q = qs.toString();
      return apiFetch<any>(`/agt/status/${encodeURIComponent(saleId)}${q ? `?${q}` : ''}`);
    },
    getDocumentStatus: (entityType: string, entityId: string, documentNumber?: string) => {
      const qs = new URLSearchParams();
      if (documentNumber) qs.set('documentNumber', documentNumber);
      const q = qs.toString();
      return apiFetch<{
        agtStatus?: string;
        agtCode?: string;
        agtValidatedAt?: string;
        documentNumber?: string;
      }>(`/agt/document-status/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}${q ? `?${q}` : ''}`);
    },
    listTransmissions: (params?: { status?: 'failed' | 'pending' | string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set('status', params.status);
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return apiFetch<any[]>(`/agt/transmissions${q ? `?${q}` : ''}`);
    },
    retryFailedTransmissions: (limit = 20) =>
      apiFetch<{ success: boolean; retried: number; failed: number; scanned: number }>(
        '/agt/retry-failed',
        { method: 'POST', body: JSON.stringify({ limit }) },
      ),
    reconcile: (limit = 10) =>
      apiFetch<{
        success: boolean;
        failed: { retried: number; failed: number; scanned: number };
        pending: { polled: number; updated: number; skipped?: boolean };
        backfill: { transmitted: number; failed: number; scanned: number; skipped?: boolean };
      }>('/agt/reconcile', { method: 'POST', body: JSON.stringify({ limit }) }),
    transmissionsReport: (year?: number, month?: number) => {
      const sp = new URLSearchParams();
      if (year) sp.append('year', year.toString());
      if (month) sp.append('month', month.toString());
      return apiFetch<{
        summary: { total: number; validated: number; failed: number; pending: number };
        byTypeStatus: Array<{ transmission_type: string; agt_status: string; count: number }>;
      }>(`/agt/transmissions-report?${sp}`);
    },
    retryTransmission: (transmissionId: string) =>
      apiFetch<any>(`/agt/retry/${encodeURIComponent(transmissionId)}`, { method: 'POST' }),
    voidInvoice: (data: { invoiceId: string; reason: string }) =>
      apiFetch<{
        success: boolean;
        invoiceId: string;
        invoiceNumber: string;
        agtStatus?: string;
        simulated?: boolean;
        error?: string;
      }>('/agt/void', { method: 'POST', body: JSON.stringify(data) }),
  },

  signing: {
    getStatus: () => apiFetch<{
      mode: 'rsa' | 'hash-only';
      activeKeyId: string | null;
      activeKeyAlias: string | null;
      certificates: Array<{
        id: string;
        alias: string;
        keyType: string;
        certificateNumber?: string;
        subjectCn?: string;
        validFrom: string;
        validUntil: string;
        isActive: boolean;
      }>;
    }>('/signing/status'),
    uploadCertificate: (data: {
      alias: string;
      pfxBase64: string;
      passphrase: string;
      certificateNumber?: string;
    }) =>
      apiFetch<any>('/signing/certificates', { method: 'POST', body: JSON.stringify(data) }),
    activateCertificate: (id: string) =>
      apiFetch<{ success: boolean }>(`/signing/certificates/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
      }),
    deleteCertificate: (id: string) =>
      apiFetch<{ success: boolean }>(`/signing/certificates/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    verifyDocument: (entityType: string, entityId: string) =>
      apiFetch<any>(`/signing/verify/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`),
  },

  fiscalDocuments: {
    listCreditNotes: (branchId?: string) => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/fiscal-documents/credit-notes${qs}`);
    },
    createCreditNote: (data: Record<string, unknown>) =>
      apiFetch<any>('/fiscal-documents/credit-notes', { method: 'POST', body: JSON.stringify(data) }),
    listDebitNotes: (branchId?: string) => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/fiscal-documents/debit-notes${qs}`);
    },
    createDebitNote: (data: Record<string, unknown>) =>
      apiFetch<any>('/fiscal-documents/debit-notes', { method: 'POST', body: JSON.stringify(data) }),
    listTransportDocuments: (branchId?: string) => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<any[]>(`/fiscal-documents/transport-documents${qs}`);
    },
    createTransportDocument: (data: Record<string, unknown>) =>
      apiFetch<any>('/fiscal-documents/transport-documents', { method: 'POST', body: JSON.stringify(data) }),
    updateTransportStatus: (id: string, status: string) =>
      apiFetch<any>(`/fiscal-documents/transport-documents/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
  },

  supplierReturns: {
    list: async (branchId?: string) => {
      const endpoint = branchId
        ? `/supplier-returns?branchId=${encodeURIComponent(branchId)}`
        : '/supplier-returns';
      if (isElectronMode()) {
        const apiResult = await apiFetch<any[]>(endpoint);
        if (Array.isArray(apiResult.data)) return apiResult;
      }
      return apiFetch<any[]>(endpoint);
    },
    create: (data: any) => {
      return apiFetch<any>('/supplier-returns', { method: 'POST', body: JSON.stringify(data) });
    },
    update: (id: string, data: any) => {
      return apiFetch<any>(`/supplier-returns/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete: (id: string) => {
      return apiFetch<any>(`/supplier-returns/${id}`, { method: 'DELETE' });
    },
  },

  // Transactions (Central Transaction Engine)
  transactions: {
    process: (data: any) => {
      return apiFetch<any>('/transactions/process', { method: 'POST', body: JSON.stringify(data) });
    },
    peekNextNumber: (documentType: string, branchId?: string) => {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
      return apiFetch<{ documentNumber: string; documentType: string; branchId?: string }>(
        `/transactions/next-number/${encodeURIComponent(documentType)}${qs}`,
      );
    },
    allocateNumber: (documentType: string, branchId?: string) => {
      return apiFetch<{ documentNumber: string; documentType: string; branchId?: string }>('/transactions/allocate-number', {
        method: 'POST',
        body: JSON.stringify({ documentType, branchId }),
      });
    },
    stockMovements: (params?: { productId?: string; warehouseId?: string; referenceType?: string; limit?: number }) => {
      const sp = new URLSearchParams();
      if (params?.productId) sp.append('productId', params.productId);
      if (params?.warehouseId) sp.append('warehouseId', params.warehouseId);
      if (params?.referenceType) sp.append('referenceType', params.referenceType);
      if (params?.limit) sp.append('limit', params.limit.toString());

      if (isElectronMode()) {
        return apiFetch<any[]>(`/transactions/stock-movements?${sp}`).then(result => {
          if (result.data !== undefined) return result;
          let sql = `SELECT sm.*, p.name AS product_name, p.sku,
            b.name AS branch_name, b.code AS branch_code,
            u.name AS created_by_name, u.email AS created_by_email
            FROM stock_movements sm
            LEFT JOIN products p ON p.id = sm.product_id
            LEFT JOIN branches b ON b.id = sm.warehouse_id
            LEFT JOIN users u ON u.id = sm.created_by
            WHERE 1=1`;
          const sqlParams: any[] = [];
          let idx = 1;
          if (params?.productId) { sql += ` AND sm.product_id = $${idx++}`; sqlParams.push(params.productId); }
          if (params?.warehouseId) { sql += ` AND sm.warehouse_id = $${idx++}`; sqlParams.push(params.warehouseId); }
          if (params?.referenceType) { sql += ` AND sm.reference_type = $${idx++}`; sqlParams.push(params.referenceType); }
          sql += ` ORDER BY sm.created_at DESC LIMIT $${idx}`;
          sqlParams.push(params?.limit || 500);
          return ipcQuery<any>(sql, sqlParams);
        });
      }
      return apiFetch<any[]>(`/transactions/stock-movements?${sp}`);
    },
    createStockMovement: (data: any) => {
      return apiFetch<any>('/transactions/stock-movements', { method: 'POST', body: JSON.stringify(data) });
    },
    stockAdjustment: (data: {
      direction: 'IN' | 'OUT';
      warehouseId: string;
      referenceNumber: string;
      referenceType: string;
      entryDate?: string;
      notes?: string;
      createdBy?: string;
      lines: { productId: string; quantity: number; unitCost: number }[];
      landingCosts?: number;
      freightSourceAccount?: string;
      freightSourceName?: string;
    }) => {
      return apiFetch<{
        documentId: string;
        referenceNumber: string;
        movementIds: string[];
        journalEntryId: string | null;
        totalValue: number;
        direction: string;
      }>('/transactions/stock-adjustment', { method: 'POST', body: JSON.stringify(data) }, { timeoutMs: 90000 });
    },
    voidStockAdjustment: (documentId: string, body?: { reason?: string; createdBy?: string }) =>
      apiFetch<{
        documentId: string;
        voidReferenceNumber: string;
        reversalMovementIds: string[];
        voidJournalEntryId?: string | null;
      }>(`/transactions/stock-adjustment/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
        body: JSON.stringify(body || {}),
      }),
    replaceStockAdjustment: (
      documentId: string,
      body: {
        direction: 'IN' | 'OUT';
        warehouseId: string;
        referenceNumber?: string;
        referenceType?: string;
        entryDate?: string;
        notes?: string;
        createdBy?: string;
        lines: { productId: string; quantity: number; unitCost: number }[];
        voidReason?: string;
      },
    ) =>
      apiFetch<{
        documentId: string;
        referenceNumber: string;
        movementIds: string[];
        journalEntryId: string | null;
        totalValue: number;
        direction: string;
      }>(`/transactions/stock-adjustment/${encodeURIComponent(documentId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    openItems: (params?: { entityType?: string; entityId?: string; branchId?: string; status?: string }) => {
      const sp = new URLSearchParams();
      if (params?.entityType) sp.append('entityType', params.entityType);
      if (params?.entityId) sp.append('entityId', params.entityId);
      if (params?.branchId) sp.append('branchId', params.branchId);
      if (params?.status) sp.append('status', params.status);
      const query = sp.toString();
      return apiFetch<any[]>(`/transactions/open-items${query ? `?${query}` : ''}`).then((res) => {
        if (res.data !== undefined || !isDemoMode()) return res;
        let items = JSON.parse(localStorage.getItem('kwanzaerp_open_items') || '[]') as any[];
        if (params?.entityType) items = items.filter((oi) => oi.entityType === params.entityType);
        if (params?.entityId) items = items.filter((oi) => oi.entityId === params.entityId);
        if (params?.branchId) items = items.filter((oi) => oi.branchId === params.branchId);
        if (params?.status) items = items.filter((oi) => oi.status === params.status);
        else items = items.filter((oi) => oi.status !== 'cleared');
        items.sort((a, b) => String(a.documentDate || a.createdAt || '').localeCompare(String(b.documentDate || b.createdAt || '')));
        return { data: items };
      });
    },
    documentLinks: (params?: { sourceType?: string; sourceId?: string; targetType?: string; targetId?: string }) => {
      if (isElectronMode()) {
        let sql = 'SELECT * FROM document_links WHERE 1=1';
        const sqlParams: any[] = [];
        let idx = 1;
        if (params?.sourceType) { sql += ` AND source_type = $${idx++}`; sqlParams.push(params.sourceType); }
        if (params?.sourceId) { sql += ` AND source_id = $${idx++}`; sqlParams.push(params.sourceId); }
        if (params?.targetType) { sql += ` AND target_type = $${idx++}`; sqlParams.push(params.targetType); }
        if (params?.targetId) { sql += ` AND target_id = $${idx++}`; sqlParams.push(params.targetId); }
        return ipcQuery<any>(sql, sqlParams);
      }
      const sp = new URLSearchParams();
      if (params?.sourceType) sp.append('sourceType', params.sourceType);
      if (params?.sourceId) sp.append('sourceId', params.sourceId);
      if (params?.targetType) sp.append('targetType', params.targetType);
      if (params?.targetId) sp.append('targetId', params.targetId);
      return apiFetch<any[]>(`/transactions/document-links?${sp}`);
    },
  },
};
