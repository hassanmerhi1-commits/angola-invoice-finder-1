import { SALES_CHANGED_EVENT } from '@/lib/storage';

export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueOfflineSale(saleData: Record<string, unknown>): Promise<boolean> {
  const api = (window as any).electronAPI?.syncOutbox;
  if (!api?.enqueue) return false;
  const idempotencyKey = (saleData.clientRequestId as string) || newClientRequestId();
  const result = await api.enqueue({
    type: 'sale.created',
    idempotencyKey,
    payload: { saleData: { ...saleData, clientRequestId: idempotencyKey } },
  });
  return !!result?.ok;
}

export type OfflinePendingItem = {
  id: string;
  eventType: string;
  status: string;
  lastError?: string | null;
  createdAt?: string | null;
  retryCount?: number;
};

export async function getOfflinePendingSummary(): Promise<{
  count: number;
  items: OfflinePendingItem[];
}> {
  const api = (window as any).electronAPI?.syncOutbox;
  if (!api?.getPendingCount) return { count: 0, items: [] };
  try {
    if (api.listPending) {
      const r = await api.listPending();
      return {
        count: Number(r?.count ?? 0),
        items: Array.isArray(r?.items) ? (r.items as OfflinePendingItem[]) : [],
      };
    }
    const r = await api.getPendingCount();
    return { count: Number(r?.count ?? 0), items: [] };
  } catch {
    return { count: 0, items: [] };
  }
}

export async function getOfflinePendingCount(): Promise<number> {
  const { count } = await getOfflinePendingSummary();
  return count;
}

function pageCityApiBase(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return null;
    const host = window.location.hostname.toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
    if (window.location.port === '18080' || window.location.port === '5173') return null;
    return window.location.origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

async function resolveOutboxApiBase(): Promise<string> {
  const fromPage = pageCityApiBase();
  if (fromPage) return fromPage;
  const { getApiUrlAsync } = await import('@/lib/api/config');
  return getApiUrlAsync();
}

function readUserBearer(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = localStorage.getItem('kwanza_auth_token') || '';
    if (!token || token.startsWith('local-') || token.split('.').length !== 3) return null;
    return token;
  } catch {
    return null;
  }
}

function saleReplayBody(row: Record<string, unknown>): Record<string, unknown> | null {
  const items = row.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const clientRequestId = String(
    row.clientRequestId || row.client_request_id || row.id || '',
  ).trim();
  if (!clientRequestId) return null;
  const branchId = String(row.branchId || row.branch_id || '').trim();
  const cashierId = String(row.cashierId || row.cashier_id || '').trim();
  if (!branchId || !cashierId) return null;
  return {
    branchId,
    cashierId,
    cashierName: row.cashierName || row.cashier_name,
    items,
    subtotal: row.subtotal,
    taxAmount: row.taxAmount ?? row.tax_amount,
    discount: row.discount,
    total: row.total,
    paymentMethod: row.paymentMethod || row.payment_method || 'cash',
    amountPaid: row.amountPaid ?? row.amount_paid,
    change: row.change ?? row.change_amount,
    customerNif: row.customerNif || row.customer_nif,
    customerName: row.customerName || row.customer_name,
    clientId: row.clientId || row.client_id,
    clientRequestId,
    createdAt: row.createdAt || row.created_at,
    caixaId: row.caixaId || row.caixa_id,
  };
}

async function replayQueuedSalesToServer(apiBaseUrl: string, userBearer: string): Promise<number> {
  const { readPendingSalesCache, clearPendingSaleMatches } = await import('@/lib/sync/pendingSalesCache');
  const { getLocalSales } = await import('@/lib/sync/offlineFirst');
  const rows = [
    ...readPendingSalesCache(),
    ...(await getLocalSales()),
  ].filter((row) => row.pendingSync || row.pending_sync);
  const seen = new Set<string>();
  let sent = 0;
  for (const row of rows) {
    const body = saleReplayBody(row);
    if (!body) continue;
    const key = String(body.clientRequestId);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const res = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/sales`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userBearer}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok && (json.id || json.invoice_number || json.invoiceNumber)) {
        clearPendingSaleMatches({ ...row, ...json, clientRequestId: key, client_request_id: key });
        sent += 1;
      }
    } catch {
      /* keep queued */
    }
  }
  return sent;
}

/** Tell Electron main the URL/JWT the UI already uses, then push the outbox. */
export async function flushOfflineOutbox(): Promise<{
  flushed: number;
  pending: number;
  reason?: string;
  error?: string;
  target?: string;
  success?: boolean;
}> {
  const api = (window as any).electronAPI?.syncOutbox;
  const apiBaseUrl = await resolveOutboxApiBase();
  const userBearer = readUserBearer();
  let flushed = 0;
  let pending = 0;
  let reason: string | undefined;
  let error: string | undefined;
  let target = apiBaseUrl;
  let success = true;

  if (api?.flush) {
    try {
      if (api.setCredentials) {
        await api.setCredentials({ apiBaseUrl, userBearer });
      }
    } catch {
      /* old Electron */
    }
    // Old Electron only accepts a string URL; an options object would break flush.
    const result = api.setCredentials
      ? await api.flush({ apiBaseUrl, userBearer })
      : await api.flush(apiBaseUrl);
    flushed = Number(result?.flushed ?? 0);
    pending = Number(result?.pending ?? 0);
    reason = result?.reason;
    error = result?.error || undefined;
    target = result?.target || apiBaseUrl;
    success = result?.success !== false;
  }

  if (userBearer && (pending > 0 || flushed === 0)) {
    const replayed = await replayQueuedSalesToServer(apiBaseUrl, userBearer);
    if (replayed > 0) {
      flushed += replayed;
      if (api?.getPendingCount) {
        try {
          const r = await api.getPendingCount();
          pending = Number(r?.count ?? pending);
        } catch {
          /* ignore */
        }
      } else {
        pending = Math.max(0, pending - replayed);
      }
      reason = pending > 0 ? 'partial' : 'ok';
      error = pending > 0 ? error : undefined;
    }
  }

  if (flushed > 0) dispatchSalesChanged();
  return { flushed, pending, reason, error, target, success };
}

/** Keep the outbox worker on the same city URL the renderer talks to. */
export async function registerOutboxCredentials(): Promise<void> {
  const api = (window as any).electronAPI?.syncOutbox;
  if (!api?.setCredentials) return;
  try {
    await api.setCredentials({
      apiBaseUrl: await resolveOutboxApiBase(),
      userBearer: readUserBearer(),
    });
  } catch {
    /* non-fatal */
  }
}

export function dispatchSalesChanged(branchId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SALES_CHANGED_EVENT, { detail: { branchId } }),
  );
}
