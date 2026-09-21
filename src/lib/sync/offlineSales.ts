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
  entityId?: string;
  clientRequestId?: string;
  invoiceNumber?: string;
};

async function fetchRawPendingSummary(): Promise<{
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

function outboxItemKeys(item: OfflinePendingItem): string[] {
  return [...new Set([
    item.id,
    item.entityId,
    item.clientRequestId,
    item.invoiceNumber,
  ].map((v) => String(v || '').trim()).filter(Boolean))];
}

function itemIsAcked(item: OfflinePendingItem, acked: Set<string>): boolean {
  return outboxItemKeys(item).some((key) => acked.has(key));
}

export async function getOfflinePendingSummary(): Promise<{
  count: number;
  items: OfflinePendingItem[];
}> {
  const raw = await fetchRawPendingSummary();
  const acked = readAckedOutboxKeys();
  if (acked.size === 0) return raw;
  const items = raw.items.filter((item) => !itemIsAcked(item, acked));
  if (raw.items.length > 0) {
    return { count: items.length, items };
  }
  return { count: Math.max(0, raw.count - acked.size), items };
}

const ACKED_OUTBOX_KEY = 'nexor:outbox-acked-keys:v1';

function readAckedOutboxKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(ACKED_OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(parsed) ? parsed : []).map((k) => String(k || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function ackReconciledSaleKeys(keys: string[]): void {
  const next = readAckedOutboxKeys();
  for (const key of keys) {
    const trimmed = String(key || '').trim();
    if (trimmed) next.add(trimmed);
  }
  try {
    localStorage.setItem(ACKED_OUTBOX_KEY, JSON.stringify([...next].slice(-500)));
  } catch {
    /* ignore */
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

function saleLookupKeys(row: Record<string, unknown>): string[] {
  return [...new Set([
    row.clientRequestId,
    row.client_request_id,
    row.id,
    row.entityId,
    row.entity_id,
    row.invoiceNumber,
    row.invoice_number,
  ].map((v) => String(v || '').trim()).filter(Boolean))];
}

/**
 * If the city already has the official sale, drop the till OFF- stub and
 * stop counting that outbox row as pending (old Electron cannot mark it sent).
 */
export async function reconcilePendingSalesWithCity(): Promise<number> {
  const { api } = await import('@/lib/api/client');
  const { readPendingSalesCache, clearPendingSaleMatches, prunePendingSalesCacheForServerRows, salesRowsMatch } =
    await import('@/lib/sync/pendingSalesCache');
  const { getLocalSales } = await import('@/lib/sync/offlineFirst');

  const outbox = await fetchRawPendingSummary();
  const stubs = [
    ...readPendingSalesCache(),
    ...(await getLocalSales()),
  ].filter((row) => row.pendingSync || row.pending_sync);

  const lookupKeys = [...new Set([
    ...outbox.items.flatMap((item) => outboxItemKeys(item)),
    ...stubs.flatMap((row) => saleLookupKeys(row)),
  ])].slice(0, 80);

  const invoiceNumbers = [...new Set([
    ...outbox.items.map((item) => item.invoiceNumber),
    ...stubs.map((row) => row.invoiceNumber || row.invoice_number),
  ].map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 80);

  const acked: string[] = [];
  const remember = (...keys: Array<string | null | undefined>) => {
    for (const key of keys) {
      const trimmed = String(key || '').trim();
      if (trimmed && !acked.includes(trimmed)) acked.push(trimmed);
    }
  };

  const foundOnCity: any[] = [];

  if (lookupKeys.length || invoiceNumbers.length) {
    try {
      const listed = await api.sales.list(undefined, {
        light: true,
        limit: 20,
        clientRequestIds: lookupKeys,
        ids: lookupKeys,
        invoiceNumbers,
      });
      if (Array.isArray(listed.data)) foundOnCity.push(...listed.data);
    } catch {
      /* keep looking */
    }
  }

  for (const key of lookupKeys.slice(0, 40)) {
    if (foundOnCity.some((sale) => saleLookupKeys(sale).includes(key))) continue;
    try {
      const found = await api.sales.get(key);
      if (found.data) foundOnCity.push(found.data);
    } catch {
      /* keep queued */
    }
  }

  try {
    const wide = await api.sales.list(undefined, { light: true, limit: 2000 });
    if (Array.isArray(wide.data) && wide.data.length) {
      prunePendingSalesCacheForServerRows(wide.data);
      foundOnCity.push(...wide.data);
    }
  } catch {
    /* ignore */
  }

  for (const sale of foundOnCity) {
    clearPendingSaleMatches(sale);
    remember(...saleLookupKeys(sale));
  }

  for (const item of outbox.items) {
    const keys = outboxItemKeys(item);
    const matched = foundOnCity.some((sale) => {
      const saleKeys = saleLookupKeys(sale);
      return keys.some((key) => saleKeys.includes(key))
        || stubs.filter((row) => outboxItemKeys(item).some((key) => saleLookupKeys(row).includes(key)))
          .some((row) => salesRowsMatch(row, sale));
    });
    if (matched) remember(...keys);
  }

  for (const row of stubs) {
    const key = String(row.clientRequestId || row.client_request_id || row.id || '').trim();
    if (!key) continue;
    if (foundOnCity.some((sale) => salesRowsMatch(row, sale))) remember(...saleLookupKeys(row));
  }

  if (acked.length) {
    ackReconciledSaleKeys(acked);
    const mark = (window as any).electronAPI?.syncOutbox?.markCompleted;
    if (typeof mark === 'function') {
      try {
        await mark(acked);
      } catch {
        /* old Electron — badge uses the ack list until a later installer */
      }
    }
    dispatchSalesChanged();
  }

  return acked.length;
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
