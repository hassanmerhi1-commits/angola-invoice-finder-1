import { isOfflineFirstEnabled } from '@/lib/sync/offlineFirst';

export type ClientSyncEvent = {
  type: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  entityType?: string;
};

function isNetworkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('fetch')
    || m.includes('network')
    || m.includes('failed to fetch')
    || m.includes('econnrefused')
    || m.includes('timeout')
    || m.includes('server_unreachable')
    || m.includes('aborterror')
  );
}

export async function enqueueClientSyncEvent(event: ClientSyncEvent): Promise<boolean> {
  if (!(await isOfflineFirstEnabled())) return false;
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

export async function enqueuePaymentSync(payload: {
  payment: Record<string, unknown>;
}): Promise<boolean> {
  const id = String(payload.payment?.id || '');
  if (!id) return false;
  return enqueueClientSyncEvent({
    type: 'payment.created',
    idempotencyKey: `payment:${id}`,
    entityType: 'payment',
    payload,
  });
}

export async function enqueueStockMovementSync(payload: {
  movement: Record<string, unknown>;
}): Promise<boolean> {
  const id = String(payload.movement?.id || cryptoRandomId());
  return enqueueClientSyncEvent({
    type: 'stock_movement',
    idempotencyKey: `stock:${id}`,
    entityType: 'stock_movement',
    payload,
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
  return isNetworkError(msg);
}
