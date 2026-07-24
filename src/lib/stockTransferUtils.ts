import type { Product, StockTransfer } from '@/types/erp';
import { branchIdsEqual } from '@/lib/branchAccess';

export function mapStockTransferItem(item: Record<string, unknown>) {
  return {
    id: String(item.id || ''),
    productId: String(item.productId ?? item.product_id ?? ''),
    productName: String(item.productName ?? item.product_name ?? ''),
    sku: String(item.sku || ''),
    quantity: Number(item.quantity || 0),
    receivedQuantity:
      item.receivedQuantity ?? item.received_quantity != null
        ? Number(item.receivedQuantity ?? item.received_quantity)
        : undefined,
  };
}

export function mapStockTransferRow(transfer: Record<string, unknown>): StockTransfer {
  const items = transfer.items;
  return {
    id: String(transfer.id || ''),
    transferNumber: String(transfer.transferNumber ?? transfer.transfer_number ?? ''),
    fromBranchId: String(transfer.fromBranchId ?? transfer.from_branch_id ?? ''),
    fromBranchName: String(transfer.fromBranchName ?? transfer.from_branch_name ?? ''),
    toBranchId: String(transfer.toBranchId ?? transfer.to_branch_id ?? ''),
    toBranchName: String(transfer.toBranchName ?? transfer.to_branch_name ?? ''),
    fromWarehouseId: String(transfer.fromWarehouseId ?? transfer.from_warehouse_id ?? '') || undefined,
    fromWarehouseName: String(transfer.fromWarehouseName ?? transfer.from_warehouse_name ?? '') || undefined,
    toWarehouseId: String(transfer.toWarehouseId ?? transfer.to_warehouse_id ?? '') || undefined,
    toWarehouseName: String(transfer.toWarehouseName ?? transfer.to_warehouse_name ?? '') || undefined,
    items: Array.isArray(items) ? items.map((row) => mapStockTransferItem(row as Record<string, unknown>)) : [],
    status: String(transfer.status || 'pending').toLowerCase() as StockTransfer['status'],
    requestedBy: String(transfer.requestedBy ?? transfer.requested_by ?? ''),
    requestedAt: String(transfer.requestedAt ?? transfer.requested_at ?? transfer.created_at ?? ''),
    approvedBy: transfer.approvedBy != null ? String(transfer.approvedBy) : transfer.approved_by != null ? String(transfer.approved_by) : undefined,
    approvedAt: transfer.approvedAt != null ? String(transfer.approvedAt) : transfer.approved_at != null ? String(transfer.approved_at) : undefined,
    receivedBy: transfer.receivedBy != null ? String(transfer.receivedBy) : transfer.received_by != null ? String(transfer.received_by) : undefined,
    receivedAt: transfer.receivedAt != null ? String(transfer.receivedAt) : transfer.received_at != null ? String(transfer.received_at) : undefined,
    notes: String(transfer.notes || ''),
  };
}

export function transferMatchesInventoryScope(
  transfer: Pick<StockTransfer, 'fromBranchId' | 'toBranchId'>,
  opts: { isConsolidated: boolean; branchId?: string },
): boolean {
  if (opts.isConsolidated || !opts.branchId) return true;
  return branchIdsEqual(transfer.fromBranchId, opts.branchId)
    || branchIdsEqual(transfer.toBranchId, opts.branchId);
}

export function buildProductTransferMatchKeys(
  product: Product,
  allBranchProducts?: Record<string, Product[]>,
  scopedBranchIds?: string[],
) {
  const productIds = new Set<string>([product.id]);
  const skus = new Set<string>();
  const names = new Set<string>();

  const skuKey = (product.sku || '').trim().toLowerCase();
  if (skuKey) skus.add(skuKey);
  const nameKey = (product.name || '').trim().toLowerCase();
  if (nameKey) names.add(nameKey);
  const barcodeKey = (product.barcode || '').trim().toLowerCase();
  if (barcodeKey) skus.add(barcodeKey);

  if (allBranchProducts) {
    const branchKeys = scopedBranchIds?.length ? scopedBranchIds : Object.keys(allBranchProducts);
    for (const branchId of branchKeys) {
      for (const row of allBranchProducts[branchId] || []) {
        const rowSku = (row.sku || '').trim().toLowerCase();
        if (row.id === product.id || (skuKey && rowSku === skuKey)) {
          productIds.add(row.id);
          if (rowSku) skus.add(rowSku);
          const rowName = (row.name || '').trim().toLowerCase();
          if (rowName) names.add(rowName);
          const rowBarcode = (row.barcode || '').trim().toLowerCase();
          if (rowBarcode) skus.add(rowBarcode);
        }
      }
    }
  }

  return { productIds, skus, names };
}

export function transferItemMatchesProductKeys(
  item: { productId?: string; sku?: string; productName?: string },
  keys: ReturnType<typeof buildProductTransferMatchKeys>,
): boolean {
  if (item.productId && keys.productIds.has(item.productId)) return true;
  const itemSku = (item.sku || '').trim().toLowerCase();
  if (itemSku && keys.skus.has(itemSku)) return true;
  const itemName = (item.productName || '').trim().toLowerCase();
  if (itemName && keys.names.has(itemName)) return true;
  return false;
}

export type PendingTransferRow = {
  transferNumber: string;
  status: string;
  from: string;
  to: string;
  quantity: number;
  productName: string;
  sku: string;
};

export function buildPendingTransferRows(
  transfers: StockTransfer[],
  opts: {
    isConsolidated: boolean;
    branchId?: string;
    product?: Product | null;
    allBranchProducts?: Record<string, Product[]>;
    scopedBranchIds?: string[];
  },
): PendingTransferRow[] {
  const pending = transfers.filter(
    (tr) => tr.status === 'pending' || tr.status === 'in_transit',
  );
  const scoped = pending.filter((tr) =>
    transferMatchesInventoryScope(tr, {
      isConsolidated: opts.isConsolidated,
      branchId: opts.branchId,
    }),
  );

  const productKeys = opts.product
    ? buildProductTransferMatchKeys(opts.product, opts.allBranchProducts, opts.scopedBranchIds)
    : null;

  return scoped.flatMap((tr) =>
    (tr.items || [])
      .filter((item) => !productKeys || transferItemMatchesProductKeys(item, productKeys))
      .map((item) => ({
        transferNumber: tr.transferNumber,
        status: tr.status,
        from: tr.fromBranchName,
        to: tr.toBranchName,
        quantity: item.quantity,
        productName: item.productName,
        sku: item.sku,
      })),
  );
}
