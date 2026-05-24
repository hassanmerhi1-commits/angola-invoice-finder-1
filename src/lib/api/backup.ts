import {
  getApiUrl,
  getApiUrlAsync,
  invalidateElectronApiBaseCache,
  isDemoMode,
} from '@/lib/api/config';
import { electronAwareBinaryRequest, electronAwareJsonRequest } from '@/lib/electronHttp';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('kwanza_auth_token');
}

export interface BackupInfo {
  engine: 'sqlite' | 'postgres';
  databasePath: string | null;
  databaseSize: number | null;
  backupDir: string;
  backupExtension: '.db' | '.sql';
  appVersion: string;
  restoreInProgress: boolean;
}

export interface BackupFileEntry {
  filename: string;
  size: number;
  createdAt: string;
  engine: 'sqlite' | 'postgres';
}

export interface CreateBackupResult {
  success: boolean;
  filename: string;
  size: number;
  path: string;
  engine: string;
  timestamp: string;
}

export type BackupConnectionIssue =
  | 'demo'
  | 'offline'
  | 'timeout'
  | 'not_found'
  | 'server_error'
  | 'unauthorized'
  | 'forbidden'
  | 'unknown';

export class BackupApiError extends Error {
  issue: BackupConnectionIssue;
  apiBase?: string;

  constructor(message: string, issue: BackupConnectionIssue, apiBase?: string) {
    super(message);
    this.name = 'BackupApiError';
    this.issue = issue;
    this.apiBase = apiBase;
  }
}

async function resolveApiBase(forceRefresh = false): Promise<string> {
  if (forceRefresh) invalidateElectronApiBaseCache();
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
  if (isElectron) {
    return getApiUrlAsync({ waitForPortMs: 12000 });
  }
  return getApiUrl();
}

function parseErrorFromText(text: string, status: number): string {
  if (!text) return `HTTP ${status}`;
  try {
    const j = JSON.parse(text);
    return j?.error || j?.message || text.slice(0, 200) || `HTTP ${status}`;
  } catch {
    return text.slice(0, 200) || `HTTP ${status}`;
  }
}

function classifyFetchError(err: unknown, status?: number): BackupConnectionIssue {
  if (status === 404) return 'not_found';
  if (status != null && status >= 500) return 'server_error';
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('404')) return 'not_found';
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED')) {
    return 'offline';
  }
  return 'unknown';
}

/** Verify embedded / LAN Express is up before backup routes. */
export async function probeBackupApi(base?: string): Promise<{ ok: boolean; base: string; health?: Record<string, unknown> }> {
  if (isDemoMode()) {
    throw new BackupApiError('Demo mode', 'demo');
  }

  let apiBase = base ?? (await resolveApiBase());
  const origin = new URL(apiBase).origin;

  const tryHealth = async (url: string) => {
    const res = await electronAwareJsonRequest(`${url}/api/health`, {
      timeoutMs: 8000,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new BackupApiError(
        res.text?.slice(0, 200) || `HTTP ${res.status}`,
        classifyFetchError(null, res.status),
        url,
      );
    }
    const health = (res.json && typeof res.json === 'object' ? res.json : {}) as Record<string, unknown>;
    if (health?.ok !== true) {
      throw new BackupApiError('ERP server health check failed', 'server_error', url);
    }
    return health;
  };

  try {
    const health = await tryHealth(origin);
    return { ok: true, base: origin, health };
  } catch (firstErr) {
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
    if (!isElectron) throw firstErr;

    invalidateElectronApiBaseCache();
    apiBase = await resolveApiBase(true);
    const retryOrigin = new URL(apiBase).origin;
    try {
      const health = await tryHealth(retryOrigin);
      return { ok: true, base: retryOrigin, health };
    } catch (secondErr) {
      if (firstErr instanceof BackupApiError) throw firstErr;
      if (secondErr instanceof BackupApiError) throw secondErr;
      throw new BackupApiError(
        secondErr instanceof Error ? secondErr.message : String(secondErr),
        classifyFetchError(secondErr),
        retryOrigin,
      );
    }
  }
}

async function backupFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (isDemoMode()) {
    throw new BackupApiError('Demo mode', 'demo');
  }

  const token = getAuthToken();
  const headers: HeadersInit = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const attempt = async (base: string): Promise<T> => {
    const origin = new URL(base).origin;
    await probeBackupApi(origin);
    const res = await electronAwareJsonRequest(`${origin}${path}`, {
      method: options.method || 'GET',
      body:
        options.body != null
          ? (typeof options.body === 'string'
            ? (() => { try { return JSON.parse(options.body as string); } catch { return options.body; } })()
            : options.body)
          : undefined,
      headers: headers as Record<string, string>,
      timeoutMs: 120000,
    });
    if (!res.ok) {
      const msg =
        (res.json && typeof res.json === 'object' && (res.json as { error?: string }).error)
        || res.text?.slice(0, 200)
        || `HTTP ${res.status}`;
      throw new BackupApiError(msg, classifyFetchError(null, res.status), origin);
    }
    if (res.status === 204) return undefined as T;
    return (res.json ?? undefined) as T;
  };

  try {
    const base = await resolveApiBase();
    return await attempt(base);
  } catch (err) {
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
    if (!isElectron || err instanceof BackupApiError) throw err;
    invalidateElectronApiBaseCache();
    const base = await resolveApiBase(true);
    return await attempt(base);
  }
}

export async function fetchBackupInfo(): Promise<BackupInfo> {
  return backupFetch<BackupInfo>('/api/backup/info');
}

export async function listDatabaseBackups(): Promise<BackupFileEntry[]> {
  return backupFetch<BackupFileEntry[]>('/api/backup');
}

export async function createDatabaseBackup(): Promise<CreateBackupResult> {
  return backupFetch<CreateBackupResult>('/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function downloadDatabaseBackup(filename: string): Promise<void> {
  const base = await resolveApiBase();
  const origin = new URL(base).origin;
  await probeBackupApi(origin);
  const token = getAuthToken();
  const url = `${origin}/api/backup/${encodeURIComponent(filename)}`;
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await electronAwareBinaryRequest(url, {
    method: 'GET',
    headers,
    timeoutMs: 300000,
  });
  if (!res.ok) {
    throw new BackupApiError(
      parseErrorFromText(res.text, res.status),
      classifyFetchError(null, res.status),
      origin,
    );
  }
  const blob = new Blob([res.body], {
    type: res.contentType || 'application/octet-stream',
  });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export async function restoreDatabaseBackupFile(file: File): Promise<{ requiresRestart?: boolean }> {
  const base = await resolveApiBase();
  const origin = new URL(base).origin;
  await probeBackupApi(origin);
  const token = getAuthToken();
  const buffer = await file.arrayBuffer();
  const res = await electronAwareBinaryRequest(`${origin}/api/backup/restore/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': file.name,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: buffer,
    timeoutMs: 600000,
  });
  if (!res.ok) {
    throw new BackupApiError(
      parseErrorFromText(res.text, res.status),
      classifyFetchError(null, res.status),
      origin,
    );
  }
  return (res.json && typeof res.json === 'object'
    ? res.json
    : {}) as { requiresRestart?: boolean };
}

export async function restoreDatabaseBackupByName(filename: string): Promise<{ requiresRestart?: boolean }> {
  return backupFetch<{ requiresRestart?: boolean }>(
    `/api/backup/restore/${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export async function deleteDatabaseBackup(filename: string): Promise<void> {
  await backupFetch<void>(`/api/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
