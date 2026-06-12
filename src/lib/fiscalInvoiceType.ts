/** Angola fiscal invoice types — mirrors backend/src/lib/fiscalInvoiceType.js */

export type FiscalInvoiceType = 'FT' | 'FR' | 'FS';

const FINAL_CONSUMER_NIFS = new Set(['999999990', '999999999', '']);

export function fsMaxAmount(): number {
  return 100_000;
}

export function isFinalConsumer(customerNif?: string | null): boolean {
  const n = String(customerNif || '').trim();
  return !n || FINAL_CONSUMER_NIFS.has(n);
}

function isPaidAtIssue(paymentMethod?: string): boolean {
  return paymentMethod === 'cash' || paymentMethod === 'card' || paymentMethod === 'mixed';
}

export function resolveSaleInvoiceType(input: {
  customerNif?: string | null;
  paymentMethod?: string;
  total?: number;
  invoiceType?: string | null;
}): FiscalInvoiceType {
  const explicit = String(input.invoiceType || '').trim().toUpperCase();
  if (explicit === 'FT' || explicit === 'FR' || explicit === 'FS') return explicit;

  const amount = Number(input.total) || 0;
  const paidNow = isPaidAtIssue(input.paymentMethod);

  if (!isFinalConsumer(input.customerNif)) {
    return paidNow ? 'FR' : 'FT';
  }

  if (paidNow && amount <= fsMaxAmount()) return 'FS';
  if (paidNow) return 'FR';
  return 'FT';
}

export function fiscalInvoiceTypeLabel(type: FiscalInvoiceType, t: {
  invoiceTypeFt: string;
  invoiceTypeFr: string;
  invoiceTypeFs: string;
}): string {
  switch (type) {
    case 'FS':
      return t.invoiceTypeFs;
    case 'FR':
      return t.invoiceTypeFr;
    default:
      return t.invoiceTypeFt;
  }
}

export const FISCAL_INVOICE_TYPE_RECEIPT_LABEL: Record<FiscalInvoiceType, string> = {
  FT: 'FT - Fatura',
  FR: 'FR - Fatura-Recibo',
  FS: 'FS - Fatura Simplificada',
};

export function receiptDocTypeLabel(type?: string | null): string {
  const key = String(type || 'FR').toUpperCase() as FiscalInvoiceType;
  return FISCAL_INVOICE_TYPE_RECEIPT_LABEL[key] || FISCAL_INVOICE_TYPE_RECEIPT_LABEL.FR;
}
