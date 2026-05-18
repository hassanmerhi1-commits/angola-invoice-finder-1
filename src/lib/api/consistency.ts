import {
  getApiUrl,
  getApiUrlAsync,
  invalidateElectronApiBaseCache,
  isDemoMode,
} from '@/lib/api/config';
import { BackupApiError, probeBackupApi, type BackupConnectionIssue } from '@/lib/api/backup';
import { ensureBackendAuthToken } from '@/lib/api/client';

export type ConsistencyCheckStatus = 'ok' | 'fail' | 'warn' | 'skip' | 'error';

export interface ConsistencySampleRow {
  key?: string;
  detail?: string;
  count?: number;
  stored?: number;
  expected?: number;
  diff?: number;
}

export interface ConsistencyCheckEntry {
  label: string;
  kind: 'duplicate' | 'consistency';
  status: ConsistencyCheckStatus;
  count: number;
  samples: ConsistencySampleRow[];
  severity?: 'error' | 'warn';
  hint?: string;
  message?: string;
}

export interface ConsistencyReport {
  status: 'ok' | 'warnings' | 'errors';
  summary: { errors: number; warnings: number; skipped: number; ok: number };
  uniqueness: ConsistencyCheckEntry[];
  reconciliation: ConsistencyCheckEntry[];
  engine?: string;
  databasePath?: string | null;
}

export interface ConsistencyRepairResult {
  supplierReturns?: { repaired?: number };
  supplierBalances?: { updated?: number };
  clientBalances?: { updated?: number };
  duplicateSkusRenamed?: number;
  productsBranchAssigned?: number;
  productStockReconciled?: number;
  supplierError?: string;
  clientError?: string;
  productError?: string;
}

async function consistencyFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (isDemoMode()) {
    throw new BackupApiError('Demo mode', 'demo');
  }

  const token = await ensureBackendAuthToken();
  if (!token) {
    throw new BackupApiError('Authentication required', 'unauthorized');
  }

  const headers: HeadersInit = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  const attempt = async (base: string): Promise<T> => {
    const origin = new URL(base).origin;
    await probeBackupApi(origin);
    const res = await fetch(`${origin}${path}`, {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        msg = j?.error || j?.message || msg;
      } catch {
        if (text) msg = text.slice(0, 200);
      }
      const issue =
        res.status === 401
          ? 'unauthorized'
          : res.status === 403
            ? 'forbidden'
            : res.status >= 500
              ? 'server_error'
              : 'unknown';
      throw new BackupApiError(msg, issue as BackupConnectionIssue, origin);
    }
    return res.json() as Promise<T>;
  };

  const isElectron = typeof window !== 'undefined' && !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

  try {
    const base = isElectron ? await getApiUrlAsync({ waitForPortMs: 12000 }) : getApiUrl();
    return await attempt(base);
  } catch (err) {
    if (!isElectron || err instanceof BackupApiError) throw err;
    invalidateElectronApiBaseCache();
    const base = await getApiUrlAsync({ waitForPortMs: 12000 });
    return await attempt(base);
  }
}

export async function runConsistencyCheck(): Promise<ConsistencyReport> {
  return consistencyFetch<ConsistencyReport>('/api/consistency/check');
}

export async function runConsistencyRepair(): Promise<{ repair: ConsistencyRepairResult; check: ConsistencyReport }> {
  return consistencyFetch('/api/consistency/repair', { method: 'POST' });
}

export function downloadConsistencyReport(
  report: ConsistencyReport,
  repair?: ConsistencyRepairResult | null,
): void {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const payload = {
    exportedAt: new Date().toISOString(),
    report,
    ...(repair ? { repair } : {}),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nexor-consistency-${stamp}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function formatConsistencyIssue(row: ConsistencySampleRow, kind: 'duplicate' | 'consistency'): string {
  if (kind === 'duplicate') {
    return `${row.key ?? '?'} × ${row.count ?? '?'}`;
  }
  const label = row.detail || row.key || '?';
  if (row.stored != null && row.expected != null && row.diff != null) {
    return `${label} — ${row.stored.toFixed(2)} / ${row.expected.toFixed(2)} (Δ ${row.diff.toFixed(2)})`;
  }
  return String(label);
}

export type { BackupConnectionIssue };
