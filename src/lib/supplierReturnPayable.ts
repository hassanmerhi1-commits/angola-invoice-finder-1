import { PurchaseInvoice } from '@/lib/purchaseInvoiceStorage';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Gross total (subtotal + IVA) for invoice lines — matches purchase invoice posting before withholding. */
export function invoiceGrossTotal(invoice: PurchaseInvoice): number {
  const fromLines = invoice.lines.reduce((s, l) => s + (l.totalWithIva || 0), 0);
  if (fromLines > 0) return roundMoney(fromLines);
  return roundMoney((invoice.subtotal || 0) + (invoice.ivaTotal || 0));
}

/**
 * Map return line gross (subtotal + IVA) to supplier payable amount so open-item balance
 * matches the purchase invoice (net of withholding / stamp base rules on the invoice).
 */
export function computeSupplierReturnPayableTotal(
  invoice: PurchaseInvoice,
  grossReturnTotal: number,
): number {
  const gross = roundMoney(Math.max(grossReturnTotal, 0));
  if (gross <= 0) return 0;

  const invoiceGross = invoiceGrossTotal(invoice);
  const invoicePayable = roundMoney(Math.max(invoice.total || 0, 0));

  if (invoiceGross <= 0 || invoicePayable <= 0) return gross;
  if (gross >= invoiceGross - 0.01) return invoicePayable;

  return roundMoney(gross * (invoicePayable / invoiceGross));
}
