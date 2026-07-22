/** True when a sale row is a local/offline stub, not a server-confirmed fiscal document. */
export function isOfflineSaleStub(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.pendingSync === true) return true;
  const inv = String(row.invoice_number || row.invoiceNumber || '').trim().toUpperCase();
  return inv.startsWith('OFF-') || inv.startsWith('LOCAL-');
}

export function isCreditPaymentMethod(paymentMethod: unknown): boolean {
  return String(paymentMethod || '').trim().toLowerCase() === 'credit';
}

export function isFiscalInvoiceNumber(invoiceNumber: unknown): boolean {
  const inv = String(invoiceNumber || '').trim().toUpperCase();
  return /^F[TR]-/.test(inv);
}
