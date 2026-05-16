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
  });
}

export async function syncAllPurchaseInvoiceReturnStatuses(branchId?: string): Promise<void> {
  const [invoices, returns] = await Promise.all([
    getPurchaseInvoices(branchId),
    getSupplierReturns(branchId),
  ]);

  await Promise.all(
    invoices
      .filter((inv) => inv.status === 'confirmed')
      .map(async (inv) => {
        const status = computePurchaseReturnStatus(inv, returns);
        if (status === inv.purchaseReturnsStatus) return;
        await savePurchaseInvoice({
          ...inv,
          purchaseReturnsStatus: status,
          purchaseReturnsClosedAt:
            status === 'full' ? new Date().toISOString() : inv.purchaseReturnsClosedAt,
          updatedAt: new Date().toISOString(),
        });
      }),
  );
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
