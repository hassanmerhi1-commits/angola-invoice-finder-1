/** Angola fiscal invoice types — mirrors backend/src/lib/fiscalInvoiceType.js */

import { getCompanySettings } from './companySettings';

export type FiscalInvoiceType = 'FT' | 'FR' | 'FS' | 'TV';
export type FinalConsumerDocType = 'FS' | 'TV';

const FINAL_CONSUMER_NIFS = new Set(['999999990', '999999999', '']);

export function fsMaxAmount(): number {
  return 100_000;
}

export function normalizeFinalConsumerDocType(value?: string | null): FinalConsumerDocType {
  return String(value || '').trim().toUpperCase() === 'TV' ? 'TV' : 'FS';
}

/** Document the server issues for a paid final-consumer sale under the FS limit. */
export function getFinalConsumerDocType(): FinalConsumerDocType {
  return normalizeFinalConsumerDocType(getCompanySettings().finalConsumerDocType);
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

/** FS and TV share the same slot: unidentified buyer, paid at issue, under the limit. */
export function isSimplifiedSaleType(type?: string | null): boolean {
  const t = String(type || '').trim().toUpperCase();
  return t === 'FS' || t === 'TV';
}

export function resolveSaleInvoiceType(input: {
  customerNif?: string | null;
  paymentMethod?: string;
  total?: number;
  invoiceType?: string | null;
  finalConsumerDocType?: string | null;
}): FiscalInvoiceType {
  const nif = normalizeCustomerNif(input.customerNif);
  const amount = Number(input.total) || 0;
  const paidNow = isPaidAtIssue(input.paymentMethod);

  if (!isFinalConsumer(nif)) {
    return paidNow ? 'FR' : 'FT';
  }

  if (paidNow && amount <= fsMaxAmount()) {
    return input.finalConsumerDocType != null
      ? normalizeFinalConsumerDocType(input.finalConsumerDocType)
      : getFinalConsumerDocType();
  }
  if (paidNow) return 'FR';
  return 'FT';
}

export function inferInvoiceTypeFromNumber(invoiceNumber?: string | null): FiscalInvoiceType | null {
  const num = String(invoiceNumber || '').trim().toUpperCase();
  const match = num.match(/^(FT|FR|FS|TV)(?:[-/]|$)/);
  return match ? (match[1] as FiscalInvoiceType) : null;
}

export function resolveSaleDocumentType(input: {
  invoiceType?: string | null;
  invoiceNumber?: string | null;
}): FiscalInvoiceType {
  const explicit = String(input.invoiceType || '').trim().toUpperCase();
  if (explicit === 'FT' || explicit === 'FR' || explicit === 'FS' || explicit === 'TV') return explicit;
  return inferInvoiceTypeFromNumber(input.invoiceNumber) || 'FT';
}

export function fiscalInvoiceTypeLabel(type: FiscalInvoiceType, t: {
  invoiceTypeFt: string;
  invoiceTypeFr: string;
  invoiceTypeFs: string;
  invoiceTypeTv: string;
}): string {
  switch (type) {
    case 'FS':
      return t.invoiceTypeFs;
    case 'TV':
      return t.invoiceTypeTv;
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
  TV: 'TV - Talão de Venda',
};

export function receiptDocTypeLabel(
  type?: string | null,
  invoiceNumber?: string | null,
): string {
  const resolved = resolveSaleDocumentType({ invoiceType: type, invoiceNumber });
  return FISCAL_INVOICE_TYPE_RECEIPT_LABEL[resolved];
}
