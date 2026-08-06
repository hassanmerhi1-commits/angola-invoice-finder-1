import { api } from '@/lib/api/client';
import { PRODUCTS_CHANGED_EVENT } from '@/lib/storage';
import { invalidateInventoryGridCacheForBranches } from '@/lib/inventoryGrid';

export type StockProductUpdate = {
  productId: string;
  sku?: string;
  stock: number;
  cost?: number;
  avgCost?: number;
  lastCost?: number;
  taxRate?: number;
};

function notifyProductsChanged(
  warehouseId: string,
  opts?: { lightweight?: boolean; skipGridRefresh?: boolean; skipInvalidate?: boolean },
) {
  if (typeof window === 'undefined') return;
  if (!opts?.skipInvalidate) {
    invalidateInventoryGridCacheForBranches([warehouseId]);
  }
  window.dispatchEvent(
    new CustomEvent(PRODUCTS_CHANGED_EVENT, {
      detail: {
        branchId: warehouseId,
        lightweight: opts?.lightweight === true,
        skipGridRefresh: opts?.skipGridRefresh === true,
      },
    }),
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
  /** When set on IN, updates product tax_rate. */
  taxRate?: number;
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
  productUpdates?: StockProductUpdate[];
  pendingSync?: boolean;
}

/** Optimistic stock snapshots when city is offline / queued. */
function optimisticUpdatesFromLines(
  lines: StockAdjustLine[],
  movementType: StockAdjustMovementType,
  previousStockById?: Map<string, number>,
): StockProductUpdate[] {
  return lines.map((l) => {
    const prev = previousStockById?.get(l.productId);
    const base = Number.isFinite(prev) ? Number(prev) : 0;
    const qty = Number(l.quantity) || 0;
    const stock =
      movementType === 'IN' ? base + qty : Math.max(0, base - qty);
    const unitCost = Number(l.unitCost) || 0;
    return {
      productId: l.productId,
      sku: l.sku,
      stock,
      cost: unitCost > 0 ? unitCost : undefined,
      lastCost: unitCost > 0 ? unitCost : undefined,
      taxRate: l.taxRate,
    };
  });
}

export async function applyStockAdjustmentLines(
  params: ApplyStockAdjustParams & {
    previousStockById?: Map<string, number>;
  },
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
    previousStockById,
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
      taxRate: l.taxRate,
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
        const productUpdates = optimisticUpdatesFromLines(
          validLines,
          movementType,
          previousStockById,
        );
        notifyProductsChanged(warehouseId, {
          lightweight: true,
          skipGridRefresh: productUpdates.length > 0,
          skipInvalidate: productUpdates.length > 0,
        });
        return {
          applied: legacyIds.length,
          errors: legacyErrors,
          documentId: referenceNumber,
          journalEntryId: null,
          productUpdates,
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

  const serverUpdates = Array.isArray(data?.productUpdates)
    ? (data.productUpdates as StockProductUpdate[])
    : [];
  const productUpdates =
    serverUpdates.length > 0
      ? serverUpdates
      : optimisticUpdatesFromLines(validLines, movementType, previousStockById);

  // Caller patches rows then may fire skipGridRefresh; still notify so CoA/etc. can stale-mark lightly.
  notifyProductsChanged(warehouseId, {
    lightweight: true,
    skipGridRefresh: productUpdates.length > 0,
    skipInvalidate: productUpdates.length > 0,
  });

  return {
    applied: movementCount,
    errors: [],
    documentId: data?.documentId,
    journalEntryId: data?.journalEntryId,
    totalValue: data?.totalValue,
    productUpdates,
    pendingSync: data?.pendingSync === true,
  };
}
