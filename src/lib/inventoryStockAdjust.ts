import { api } from '@/lib/api/client';
import { PRODUCTS_CHANGED_EVENT, saveStockMovement } from '@/lib/storage';
import type { Product, StockMovement } from '@/types/erp';

function notifyProductsChanged(warehouseId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(PRODUCTS_CHANGED_EVENT, { detail: { branchId: warehouseId } }),
  );
}

function isStockAdjustmentEndpointMissing(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('404')
    || m.includes('not found')
    || m.includes('stock-adjustment')
    || m.includes('cannot post')
    || m.includes('failed to fetch')
    || m.includes('network error')
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
  fallbackUpdateProduct?: (product: Product) => Promise<void>;
  productsById?: Map<string, Product>;
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
    fallbackUpdateProduct,
    productsById,
    landingCosts,
    freightSourceAccount,
    freightSourceName,
  } = params;

  const validLines = lines.filter((l) => l.productId && l.quantity > 0);
  if (validLines.length === 0) {
    return { applied: 0, errors: [] };
  }

  try {
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
        unitCost: l.unitCost ?? productsById?.get(l.productId)?.cost ?? 0,
      })),
      landingCosts: landingCosts && landingCosts > 0 ? landingCosts : undefined,
      freightSourceAccount: freightSourceAccount?.trim() || undefined,
      freightSourceName: freightSourceName?.trim() || undefined,
    });

    if (result.error) {
      throw new Error(result.error);
    }

    const data = result.data;
    const movementCount = data?.movementIds?.length ?? 0;
    if (movementCount === 0) {
      throw new Error('Stock adjustment returned no movements');
    }
    notifyProductsChanged(warehouseId);
    return {
      applied: movementCount,
      errors: [],
      documentId: data?.documentId,
      journalEntryId: data?.journalEntryId,
      totalValue: data?.totalValue,
    };
  } catch (apiErr) {
    const message = apiErr instanceof Error ? apiErr.message : String(apiErr);

    if (isStockAdjustmentEndpointMissing(message)) {
      const legacyIds: string[] = [];
      const legacyErrors: string[] = [];
      for (const line of validLines) {
        const unitCost = line.unitCost ?? productsById?.get(line.productId)?.cost ?? 0;
        const legacy = await api.transactions.createStockMovement({
          productId: line.productId,
          warehouseId,
          movementType,
          quantity: line.quantity,
          unitCost,
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
      if (legacyErrors.length > 0) {
        return { applied: 0, errors: legacyErrors };
      }
    }

    if (fallbackUpdateProduct && productsById) {
      const errors: string[] = [];
      let applied = 0;
      const refType = referenceType || 'adjustment';

      for (const line of validLines) {
        const product = productsById.get(line.productId);
        if (!product) continue;
        try {
          const prevStock = product.stock ?? 0;
          const delta = movementType === 'IN' ? line.quantity : -line.quantity;
          const newStock = Math.max(0, prevStock + delta);
          const next: Product = {
            ...product,
            stock: newStock,
            updatedAt: new Date().toISOString(),
          };
          if (movementType === 'IN' && line.unitCost != null && line.unitCost > 0) {
            const prevValue = prevStock * (product.cost || 0);
            const addValue = line.quantity * line.unitCost;
            next.cost = newStock > 0 ? (prevValue + addValue) / newStock : line.unitCost;
          }
          await fallbackUpdateProduct(next);

          const movement: StockMovement = {
            id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
            productId: line.productId,
            productName: line.name,
            sku: line.sku,
            branchId: warehouseId,
            type: movementType,
            quantity: line.quantity,
            reason: refType as StockMovement['reason'],
            createdBy: createdBy || 'system',
            referenceNumber,
            notes,
            createdAt: new Date().toISOString(),
          };
          await saveStockMovement(movement);
          applied += 1;
        } catch (fallbackErr) {
          errors.push(
            `${line.sku}: ${message}; fallback: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }`,
          );
        }
      }

      if (applied > 0) {
        notifyProductsChanged(warehouseId);
        return {
          applied,
          errors,
        };
      }
    }

    return {
      applied: 0,
      errors: validLines.map((l) => `${l.sku}: ${message}`),
    };
  }
}
