/** Angola fiscal invoice types — mirrors backend/src/lib/fiscalInvoiceType.js */

export type FiscalInvoiceType = 'FT' | 'FR' | 'FS';

const FINAL_CONSUMER_NIFS = new Set(['999999990', '999999999', '']);

export function fsMaxAmount(): number {
  return 100_000;
}

export function normalizeCustomerNif(customerNif?: string | null): string {
  const raw = String(customerNif || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (FINAL_CONSUMER_NIFS.has(raw) || FINAL_CONSUMER_NIFS.has(upper)) return '';
  if (upper === 'CF' || upper === 'CONSUMIDOR_FINAL' || upper === 'CONSUMIDOR FINAL') return '';
  return raw;
}

export function isFinalConsumer(customerNif?: string | null): boolean {
  return !normalizeCustomerNif(customerNif);
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
  const nif = normalizeCustomerNif(input.customerNif);
  const amount = Number(input.total) || 0;
  const paidNow = isPaidAtIssue(input.paymentMethod);

  if (!isFinalConsumer(nif)) {
    return paidNow ? 'FR' : 'FT';
  }

  if (paidNow && amount <= fsMaxAmount()) return 'FS';
  if (paidNow) return 'FR';
  return 'FT';
}

export function inferInvoiceTypeFromNumber(invoiceNumber?: string | null): FiscalInvoiceType | null {
  const num = String(invoiceNumber || '').trim().toUpperCase();
  const match = num.match(/^(FT|FR|FS)(?:[-/]|$)/);
  return match ? (match[1] as FiscalInvoiceType) : null;
}

export function resolveSaleDocumentType(input: {
  invoiceType?: string | null;
  invoiceNumber?: string | null;
}): FiscalInvoiceType {
  const explicit = String(input.invoiceType || '').trim().toUpperCase();
  if (explicit === 'FT' || explicit === 'FR' || explicit === 'FS') return explicit;
  return inferInvoiceTypeFromNumber(input.invoiceNumber) || 'FT';
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

export function receiptDocTypeLabel(
  type?: string | null,
  invoiceNumber?: string | null,
): string {
  const resolved = resolveSaleDocumentType({ invoiceType: type, invoiceNumber });
  return FISCAL_INVOICE_TYPE_RECEIPT_LABEL[resolved];
}
