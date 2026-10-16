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
    warehouseId?: string;
    direction?: 'IN' | 'OUT';
    referenceType?: string;
    entryDate?: string;
    landingCosts?: number;
    freightSourceAccount?: string;
    freightSourceName?: string;
    supplierId?: string;
    supplierName?: string;
  },
): Promise<{ documentId: string; referenceNumber: string; journalEntryId?: string | null }> {
  const warehouseId = payload.warehouseId || original.branchId;
  const landingCosts = Number(payload.landingCosts) || 0;
  const res = await api.transactions.replaceStockAdjustment(original.id, {
    direction: payload.direction || original.direction,
    warehouseId,
    referenceNumber: payload.referenceNumber || original.referenceNumber,
    referenceType: payload.referenceType || original.reason || 'adjustment',
    entryDate: payload.entryDate,
    notes: payload.notes ?? original.notes,
    createdBy: currentUserId(),
    lines: payload.lines,
    landingCosts: landingCosts > 0 ? landingCosts : undefined,
    freightSourceAccount: payload.freightSourceAccount?.trim() || undefined,
    freightSourceName: payload.freightSourceName?.trim() || undefined,
    supplierId: payload.supplierId?.trim() || undefined,
    supplierName: payload.supplierName?.trim() || undefined,
    voidReason: `Substituição de ${original.referenceNumber}`,
  });
  if (res.error) throw new Error(res.error);
  notifyProductsChanged(original.branchId);
  if (warehouseId !== original.branchId) notifyProductsChanged(warehouseId);
  return {
    documentId: res.data?.documentId || '',
    referenceNumber: res.data?.referenceNumber || payload.referenceNumber || original.referenceNumber,
    journalEntryId: res.data?.journalEntryId,
  };
}
