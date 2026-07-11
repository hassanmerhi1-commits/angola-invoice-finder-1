import { api } from '@/lib/api/client';
import { PRODUCTS_CHANGED_EVENT } from '@/lib/storage';

function notifyProductsChanged(warehouseId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: { branchId: warehouseId } }),
  );
}

/** Only use legacy per-line movement API when the unified endpoint is genuinely absent. */
function isStockAdjustmentRouteMissing(message: string, status?: number): boolean {
  if (status === 404) return true;
  const m = message.toLowerCase();
  return (
    (m.includes('stock-adjustment') || m.includes('/transactions/stock-adjustment'))
    && (m.includes('not found') || m.includes('404') || m.includes('endpoint not found'))
  );
}

export type StockAdjustMovementType = 'IN' | 'OUT';

export interface StockAdjustLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitCost?: number;
}

export interface ApplyStockAdjustParams {
  lines: StockAdjustLine[];
  warehouseId: string;
  movementType: StockAdjustMovementType;
  referenceType: string;
  referenceNumber: string;
  entryDate?: string;
  notes: string;
  createdBy?: string;
  /** @deprecated WAC is applied on the server for IN adjustments. */
  updateProductCost?: (productId: string) => Promise<void>;
  landingCosts?: number;
  freightSourceAccount?: string;
  freightSourceName?: string;
}

export interface ApplyStockAdjustResult {
  applied: number;
  errors: string[];
  documentId?: string;
  journalEntryId?: string | null;
  totalValue?: number;
}

export async function applyStockAdjustmentLines(
  params: ApplyStockAdjustParams,
): Promise<ApplyStockAdjustResult> {
  const {
    lines,
    warehouseId,
    movementType,
    referenceType,
    referenceNumber,
    entryDate,
    notes,
    createdBy,
    landingCosts,
    freightSourceAccount,
    freightSourceName,
  } = params;

  const validLines = lines.filter((l) => l.productId && l.quantity > 0);
  if (validLines.length === 0) {
    return { applied: 0, errors: [] };
  }

  const result = await api.transactions.stockAdjustment({
    direction: movementType,
    warehouseId,
    referenceNumber,
    referenceType,
    entryDate,
    notes,
    createdBy: createdBy || 'system',
    lines: validLines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity,
      unitCost: l.unitCost ?? 0,
    })),
    landingCosts: landingCosts && landingCosts > 0 ? landingCosts : undefined,
    freightSourceAccount: freightSourceAccount?.trim() || undefined,
    freightSourceName: freightSourceName?.trim() || undefined,
  });

  if (result.error) {
    const message = result.error;
    if (isStockAdjustmentRouteMissing(message, result.status)) {
      const legacyIds: string[] = [];
      const legacyErrors: string[] = [];
      for (const line of validLines) {
        const legacy = await api.transactions.createStockMovement({
          productId: line.productId,
          warehouseId,
          movementType,
          quantity: line.quantity,
          unitCost: line.unitCost ?? 0,
          referenceType,
          referenceNumber,
          notes,
          createdBy: createdBy || 'system',
        });
        if (legacy.error) {
          legacyErrors.push(`${line.sku}: ${legacy.error}`);
        } else if (legacy.data?.id) {
          legacyIds.push(legacy.data.id);
        }
      }
      if (legacyIds.length > 0) {
        notifyProductsChanged(warehouseId);
        return {
          applied: legacyIds.length,
          errors: legacyErrors,
          documentId: referenceNumber,
          journalEntryId: null,
        };
      }
      return {
        applied: 0,
        errors: legacyErrors.length > 0
          ? legacyErrors
          : validLines.map((l) => `${l.sku}: ${message}`),
      };
    }

    return {
      applied: 0,
      errors: validLines.map((l) => `${l.sku}: ${message}`),
    };
  }

  const data = result.data;
  const movementCount = data?.movementIds?.length ?? 0;
  if (movementCount === 0) {
    return {
      applied: 0,
      errors: validLines.map((l) => `${l.sku}: Stock adjustment returned no movements`),
    };
  }

  notifyProductsChanged(warehouseId);
  return {
    applied: movementCount,
    errors: [],
    documentId: data?.documentId,
    journalEntryId: data?.journalEntryId,
    totalValue: data?.totalValue,
  };
}
