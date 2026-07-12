import {
  getPurchaseInvoiceById,
  getPurchaseInvoices,
  savePurchaseInvoice,
  type PurchaseInvoice,
} from '@/lib/purchaseInvoiceStorage';
import { getSupplierReturns, type SupplierReturn } from '@/lib/supplierReturns';

const listeners = new Set<() => void>();

/** Broadcast after any supplier return is created, updated, or cancelled. */
/** Also used after journal entries are posted from purchase returns / transactions. */
export function notifyJournalEntriesChanged(): void {
  notifySupplierReturnsChanged();
}

export function notifySupplierReturnsChanged(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('[supplierReturnSync] listener error:', error);
    }
  });
}

export function subscribeSupplierReturnsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function computePurchaseReturnStatus(
  invoice: PurchaseInvoice,
  returns: SupplierReturn[],
): NonNullable<PurchaseInvoice['purchaseReturnsStatus']> {
  const active = returns.filter(
    (r) => r.purchaseOrderId === invoice.id && r.status !== 'cancelled',
  );
  if (active.length === 0) {
    return invoice.purchaseReturnsStatus ?? 'none';
  }

  if (invoice.lines.length === 0) {
    return 'partial';
  }

  let allLinesFullyReturned = true;
  let anyQtyReturned = false;

  for (const line of invoice.lines) {
    const returnedQty = active.reduce((sum, ret) => {
      return (
        sum +
        ret.items
          .filter((item) =>
            item.sourceLineId
              ? item.sourceLineId === line.id
              : item.productId === line.productId,
          )
          .reduce((itemSum, item) => itemSum + item.quantity, 0)
      );
    }, 0);

    if (returnedQty > 0) anyQtyReturned = true;
    if (returnedQty < line.totalQty) allLinesFullyReturned = false;
  }

  if (!anyQtyReturned) return invoice.purchaseReturnsStatus ?? 'none';
  return allLinesFullyReturned ? 'full' : 'partial';
}

export async function syncPurchaseInvoiceReturnStatus(
  invoiceId: string,
  branchId?: string,
): Promise<void> {
  const invoice = await getPurchaseInvoiceById(invoiceId);
  if (!invoice || invoice.status !== 'confirmed') return;

  const returns = await getSupplierReturns(branchId ?? invoice.branchId);
  const status = computePurchaseReturnStatus(invoice, returns);
  if (status === invoice.purchaseReturnsStatus) return;

  await savePurchaseInvoice({
    ...invoice,
    purchaseReturnsStatus: status,
    purchaseReturnsClosedAt:
      status === 'full' ? new Date().toISOString() : invoice.purchaseReturnsClosedAt,
    updatedAt: new Date().toISOString(),
  }, { metadataOnly: true });
}

let lastFullReturnSyncAt = 0;
const FULL_RETURN_SYNC_MIN_MS = 45_000;

export async function syncAllPurchaseInvoiceReturnStatuses(branchId?: string): Promise<void> {
  const now = Date.now();
  if (now - lastFullReturnSyncAt < FULL_RETURN_SYNC_MIN_MS) return;

  const returns = await getSupplierReturns(branchId);
  if (!returns.length) return;

  const invoices = await getPurchaseInvoices(branchId);
  const toUpdate = invoices.filter((inv) => {
    if (inv.status !== 'confirmed') return false;
    const status = computePurchaseReturnStatus(inv, returns);
    return status !== inv.purchaseReturnsStatus;
  });

  lastFullReturnSyncAt = now;
  if (toUpdate.length === 0) return;

  for (const inv of toUpdate) {
    const status = computePurchaseReturnStatus(inv, returns);
    await savePurchaseInvoice({
      ...inv,
      purchaseReturnsStatus: status,
      purchaseReturnsClosedAt:
        status === 'full' ? new Date().toISOString() : inv.purchaseReturnsClosedAt,
      updatedAt: new Date().toISOString(),
    }, { metadataOnly: true });
  }
}

export async function afterSupplierReturnMutation(options?: {
  invoiceId?: string;
  branchId?: string;
}): Promise<void> {
  if (options?.invoiceId) {
    await syncPurchaseInvoiceReturnStatus(options.invoiceId, options.branchId);
  }
  notifySupplierReturnsChanged();
}
