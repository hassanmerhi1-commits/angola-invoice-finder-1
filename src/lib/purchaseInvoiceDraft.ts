import type { PurchaseInvoice } from '@/lib/purchaseInvoiceStorage';

export const PURCHASE_INVOICE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isPurchaseInvoiceDraft(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'draft' || s === 'pending';
}

/** Explicit unposted FC. Empty status is a legacy posted row (backend COALESCE confirmed). */
export function isPurchaseInvoiceUnposted(status?: string | null): boolean {
  const s = String(status || '').trim().toLowerCase();
  return s === 'draft' || s === 'pending';
}

export function isAdminRole(role?: string | null): boolean {
  return String(role || '').trim().toLowerCase() === 'admin';
}

export function isPurchaseInvoiceWithinEditWindow(
  createdAt?: string | Date | null,
  now = Date.now(),
): boolean {
  const ms = createdAt instanceof Date
    ? createdAt.getTime()
    : Date.parse(String(createdAt || ''));
  if (!Number.isFinite(ms)) return false;
  return now - ms <= PURCHASE_INVOICE_EDIT_WINDOW_MS;
}

export type PurchaseInvoiceEditDenial =
  | null
  | 'others_draft'
  | 'not_admin'
  | 'window_closed';

type PurchaseInvoiceEditFields = Pick<PurchaseInvoice, 'status' | 'createdBy' | 'createdAt'>;

/**
 * Drafts: author or a confirmer may keep working.
 * Posted invoices: administrator only, and only within 24 hours of creation.
 */
export function purchaseInvoiceEditDenial(
  invoice: PurchaseInvoiceEditFields | null | undefined,
  opts: { userId?: string; role?: string | null; canConfirm: boolean; now?: number },
): PurchaseInvoiceEditDenial {
  if (!invoice) return null;
  if (isPurchaseInvoiceUnposted(invoice.status)) {
    if (opts.canConfirm) return null;
    const owner = String(invoice.createdBy || '').trim();
    const me = String(opts.userId || '').trim();
    if (!owner || owner === me) return null;
    return 'others_draft';
  }
  if (!isAdminRole(opts.role)) return 'not_admin';
  if (!isPurchaseInvoiceWithinEditWindow(invoice.createdAt, opts.now)) return 'window_closed';
  return null;
}

export function canEditPurchaseInvoiceDraft(
  invoice: PurchaseInvoiceEditFields | null | undefined,
  opts: { userId?: string; role?: string | null; canConfirm: boolean; now?: number },
): boolean {
  return purchaseInvoiceEditDenial(invoice, opts) === null;
}
