import type { PurchaseInvoice } from '@/lib/purchaseInvoiceStorage';

export function isPurchaseInvoiceDraft(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'draft' || s === 'pending';
}

/** Explicit unposted FC. Empty status is a legacy posted row (backend COALESCE confirmed). */
export function isPurchaseInvoiceUnposted(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  return s === 'draft' || s === 'pending';
}

export function canEditPurchaseInvoiceDraft(
  invoice: Pick<PurchaseInvoice, 'status' | 'createdBy'> | null | undefined,
  opts: { userId?: string; canConfirm: boolean },
): boolean {
  if (!invoice) return true;
  if (opts.canConfirm) return true;
  if (!isPurchaseInvoiceDraft(invoice.status)) return false;
  const owner = String(invoice.createdBy || '').trim();
  const me = String(opts.userId || '').trim();
  return !owner || owner === me;
}
