import { isOfflineFirstEnabled } from '@/lib/sync/offlineFirst';
import { isOfflineModeActive } from '@/lib/offlineAuth';
import { isLanLikelyDown } from '@/lib/lanReachability';
import { isNetworkErrorMessage } from '@/lib/networkErrors';
import { getApiUrlAsync, isThinClientMode } from '@/lib/api/config';
import { electronHttpJson, isElectronLanClient } from '@/lib/electronHttp';

export type ClientSyncEvent = {
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  entityType?: string;
};

export async function enqueueClientSyncEvent(event: ClientSyncEvent): Promise<boolean> {
  if (!(await isOfflineFirstEnabled()) && !canUseOutboxWithoutOfflineFirst()) return false;
  const api = (window as any).electronAPI?.syncOutbox;
  if (!api?.enqueue) return false;
  const res = await api.enqueue({
    type: event.type,
    idempotencyKey: event.idempotencyKey,
    entityType: event.entityType,
    payload: event.payload,
  });
  return !!res?.ok;
}

/** Thin clients may queue even if shop_client offline-first flag is mid-setup. */
function canUseOutboxWithoutOfflineFirst(): boolean {
  if (typeof window === 'undefined') return false;
  return isThinClientMode() && !!(window as any).electronAPI?.syncOutbox?.enqueue;
}

export async function enqueueCaixaCloseSync(payload: {
  sessionData: Record<string, unknown>;
  caixaData?: Record<string, unknown>;
}): Promise<boolean> {
  const sessionId = String(payload.sessionData?.id || '');
  if (!sessionId) return false;
  return enqueueClientSyncEvent({
    type: 'caixa.close',
    idempotencyKey: `caixa:${sessionId}`,
    entityType: 'caixa_session',
    payload,
  });
}

export async function enqueuePurchaseInvoiceSync(payload: {
  invoiceData: Record<string, unknown>;
  transactionData: Record<string, unknown>;
}): Promise<boolean> {
  const invoiceId = String(payload.invoiceData?.id || '');
  if (!invoiceId) return false;
  return enqueueClientSyncEvent({
    type: 'purchase_invoice.created',
    idempotencyKey: `purchase:${invoiceId}`,
    entityType: 'purchase_invoice',
    payload,
  });
}

/** City ingest reads payload.paymentData || payload. */
export async function enqueuePaymentSync(payload: {
  paymentData: Record<string, unknown>;
}): Promise<boolean> {
  const id = String(
    payload.paymentData?.id
    || payload.paymentData?.clientRequestId
    || payload.paymentData?.client_request_id
    || '',
  ).trim();
  if (!id) return false;
  return enqueueClientSyncEvent({
    type: 'payment.created',
    idempotencyKey: `payment:${id}`,
    entityType: 'payment',
    payload: { paymentData: payload.paymentData },
  });
}

/** City ingest reads payload.movementData || payload. */
export async function enqueueStockMovementSync(payload: {
  movementData: Record<string, unknown>;
}): Promise<boolean> {
  const id = String(
    payload.movementData?.id
    || payload.movementData?.referenceId
    || payload.movementData?.clientRequestId
    || cryptoRandomId(),
  );
  return enqueueClientSyncEvent({
    type: 'stock_movement',
    idempotencyKey: `stock:${id}`,
    entityType: 'stock_movement',
    payload: { movementData: payload.movementData },
  });
}

function cryptoRandomId(): string {
  try {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return String(Date.now());
  }
}

export function shouldQueueOnNetworkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error || '');
  return isNetworkErrorMessage(msg);
}

export function hasSyncOutbox(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI?.syncOutbox?.enqueue;
}

/** True when we should skip waiting on HTTP and queue immediately. */
export function shouldQueueImmediately(): boolean {
  return hasSyncOutbox() && (isOfflineModeActive() || isLanLikelyDown());
}

/** Quick health probe for Electron LAN clients — false means city looks down. */
export async function probeCityServerReachable(timeoutMs = 2500): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  const elApi = (window as any).electronAPI;
  if (!elApi?.isElectron) return true;
  try {
    const lanClient = await isElectronLanClient();
    if (!lanClient || !elApi?.network?.httpJson) return true;
    const baseUrl = await getApiUrlAsync();
    const authToken = localStorage.getItem('kwanza_auth_token');
    const health = await electronHttpJson(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      timeoutMs,
    });
    return !!health.ok;
  } catch {
    return false;
  }
}
