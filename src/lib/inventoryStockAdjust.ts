import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';
import { saveStockMovement } from '@/lib/storage';
import type { Product, StockMovement } from '@/types/erp';

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
  notes: string;
  createdBy?: string;
  /** After IN movement — update weighted average cost on the product row. */
  updateProductCost?: (productId: string) => Promise<void>;
  /** Legacy fallback when API is unavailable. */
  fallbackUpdateProduct?: (product: Product) => Promise<void>;
  productsById?: Map<string, Product>;
}

export interface ApplyStockAdjustResult {
  applied: number;
  errors: string[];
}

function mapReasonToReferenceType(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('transfer') || r === 'transfer_in') return 'transfer';
  if (r.includes('purchase') || r.includes('compra')) return 'purchase';
  if (r.includes('damage') || r.includes('dano') || r.includes('avaria')) return 'damage';
  if (r.includes('expir') || r.includes('validade')) return 'damage';
  return 'adjustment';
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
    notes,
    createdBy,
    updateProductCost,
    fallbackUpdateProduct,
    productsById,
  } = params;

  const refType = referenceType || mapReasonToReferenceType(notes);
  const errors: string[] = [];
  let applied = 0;

  for (const line of lines) {
    if (!line.productId || line.quantity <= 0) continue;
    const product = productsById?.get(line.productId);

    try {
      const result = await api.transactions.createStockMovement({
        productId: line.productId,
        warehouseId,
        movementType,
        quantity: line.quantity,
        unitCost: line.unitCost ?? product?.cost ?? 0,
        referenceType: refType,
        referenceNumber,
        notes,
        createdBy: createdBy || 'system',
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (movementType === 'IN' && updateProductCost) {
        await updateProductCost(line.productId);
      }

      applied += 1;
    } catch (apiErr) {
      const message = apiErr instanceof Error ? apiErr.message : String(apiErr);

      if (!isDemoMode() && fallbackUpdateProduct && product) {
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
            const total = newStock > 0 ? (prevValue + addValue) / newStock : line.unitCost;
            next.cost = total;
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
            reason: refType,
            createdBy: createdBy || 'system',
            referenceNumber,
            notes,
            createdAt: new Date().toISOString(),
          };
          await saveStockMovement(movement);
          applied += 1;
          continue;
        } catch (fallbackErr) {
          errors.push(
            `${line.sku}: ${message}; fallback: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }`,
          );
          continue;
        }
      }

      errors.push(`${line.sku}: ${message}`);
    }
  }

  return { applied, errors };
}
