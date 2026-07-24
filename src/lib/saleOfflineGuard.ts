/** True when a sale row is a local/offline stub, not a server-confirmed fiscal document. */
export function isOfflineSaleStub(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.pendingSync === true) return true;
  const inv = String(row.invoice_number || row.invoiceNumber || '').trim().toUpperCase();
  return inv.startsWith('OFF-') || inv.startsWith('LOCAL-');
}

/** Offline stubs must not be treated as final fiscal documents (number changes on sync). */
export function offlineSalePrintWarning(row: Record<string, unknown> | null | undefined): string | null {
  if (!isOfflineSaleStub(row)) return null;
  return 'PROVISIONAL — offline receipt. Official FT/FR/FS number is assigned after sync.';
}

export function isCreditPaymentMethod(paymentMethod: unknown): boolean {
  return String(paymentMethod || '').trim().toLowerCase() === 'credit';
}

export function isFiscalInvoiceNumber(invoiceNumber: unknown): boolean {
  const inv = String(invoiceNumber || '').trim().toUpperCase();
  return /^F[TRS]-/.test(inv) || /^FR-/.test(inv) || /^FS-/.test(inv);
}
