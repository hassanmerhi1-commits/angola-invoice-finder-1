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

import { SALES_CHANGED_EVENT } from '@/lib/storage';

export function dispatchSalesChanged(branchId?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SALES_CHANGED_EVENT, { detail: { branchId } }),
  );
}
