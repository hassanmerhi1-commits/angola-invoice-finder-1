import { api } from '@/lib/api/client';
import { PRODUCTS_CHANGED_EVENT } from '@/lib/storage';
import type { StockAdjustmentDocument } from '@/lib/stockAdjustmentDocuments';
import { invalidateInventoryGridCacheForBranches } from '@/lib/inventoryGrid';

function currentUserId(): string {
  try {
    const user = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || '{}');
    return String(user?.id || user?.name || 'system');
  } catch {
    return 'system';
  }
}

function notifyProductsChanged(warehouseId: string) {
  if (typeof window === 'undefined') return;
  invalidateInventoryGridCacheForBranches([warehouseId]);
  window.dispatchEvent(
    new CustomEvent(PRODUCTS_CHANGED_EVENT, {
      detail: { branchId: warehouseId, lightweight: true },
    }),
  );
}

export async function voidStockAdjustmentDocument(
  documentId: string,
  reason?: string,
  warehouseId?: string,
): Promise<void> {
  const res = await api.transactions.voidStockAdjustment(documentId, {
    reason: reason || 'Anulado pelo utilizador',
    createdBy: currentUserId(),
  });
  if (res.error) throw new Error(res.error);
  if (warehouseId) notifyProductsChanged(warehouseId);
}

export async function replaceStockAdjustmentDocument(
  original: StockAdjustmentDocument,
  payload: {
    lines: { productId: string; quantity: number; unitCost: number }[];
    notes?: string;
    referenceNumber?: string;
  },
): Promise<{ documentId: string; referenceNumber: string; journalEntryId?: string | null }> {
  const res = await api.transactions.replaceStockAdjustment(original.id, {
    direction: original.direction,
    warehouseId: original.branchId,
    referenceNumber: payload.referenceNumber || original.referenceNumber,
    referenceType: original.reason || 'adjustment',
    notes: payload.notes ?? original.notes,
    createdBy: currentUserId(),
    lines: payload.lines,
    voidReason: `Substituição de ${original.referenceNumber}`,
  });
  if (res.error) throw new Error(res.error);
  notifyProductsChanged(original.branchId);
  return {
    documentId: res.data?.documentId || '',
    referenceNumber: res.data?.referenceNumber || payload.referenceNumber || original.referenceNumber,
    journalEntryId: res.data?.journalEntryId,
  };
}
