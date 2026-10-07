/**
 * Angola fiscal invoice types — FT (invoice), FR (invoice-receipt), FS (simplified), TV (talão de venda).
 */
const FINAL_CONSUMER_NIFS = new Set(['999999990', '999999999', '']);

const SALE_INVOICE_TYPES = ['FT', 'FR', 'FS', 'TV'];

function fsMaxAmount() {
  const n = Number(process.env.AGT_FS_MAX_AMOUNT || 100000);
  return Number.isFinite(n) && n > 0 ? n : 100000;
}

/** Document issued to an unidentified, paid-at-issue buyer under the FS limit. */
function normalizeFinalConsumerDocType(value) {
  return String(value || '').trim().toUpperCase() === 'TV' ? 'TV' : 'FS';
}

/** Trim and treat consumidor final placeholders as empty (POS optional NIF field). */
function normalizeCustomerNif(customerNif) {
  const raw = String(customerNif || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (FINAL_CONSUMER_NIFS.has(raw) || FINAL_CONSUMER_NIFS.has(upper)) return '';
  if (upper === 'CF' || upper === 'CONSUMIDOR_FINAL' || upper === 'CONSUMIDOR FINAL') return '';
  return raw;
}

function isFinalConsumer(customerNif) {
  return !normalizeCustomerNif(customerNif);
}

function isPaidAtIssue(paymentMethod) {
  const m = String(paymentMethod || '').trim().toLowerCase();
  return (
    m === 'cash'
    || m === 'card'
    || m === 'mixed'
    || m === 'transfer'
    || m === 'bank_transfer'
    || m === 'multibanco'
    || m === 'mb'
  );
}

/**
 * Resolve AGT document type for a sale.
 * @returns {'FT'|'FR'|'FS'|'TV'}
 */
function resolveSaleInvoiceType({
  customerNif,
  paymentMethod,
  total,
  invoiceType,
  trustExplicit = false,
  finalConsumerDocType,
}) {
  const explicit = String(invoiceType || '').trim().toUpperCase();
  if (trustExplicit && SALE_INVOICE_TYPES.includes(explicit)) return explicit;

  const nif = normalizeCustomerNif(customerNif);
  const amount = Number(total) || 0;
  const paidNow = isPaidAtIssue(paymentMethod);

  if (!isFinalConsumer(nif)) {
    return paidNow ? 'FR' : 'FT';
  }

  if (paidNow && amount <= fsMaxAmount()) return normalizeFinalConsumerDocType(finalConsumerDocType);
  if (paidNow) return 'FR';
  return 'FT';
}

function sequenceKeyForInvoiceType(invoiceType) {
  switch (String(invoiceType || 'FT').toUpperCase()) {
    case 'FS':
      return 'simplified_invoice';
    case 'TV':
      return 'sales_ticket';
    case 'FR':
      return 'invoice_receipt';
    default:
      return 'sales_invoice';
  }
}

function prefixForInvoiceType(invoiceType) {
  return String(invoiceType || 'FT').toUpperCase();
}

function validateSaleInvoiceType({
  invoiceType,
  customerNif,
  paymentMethod,
  total,
  trustExplicit = false,
  finalConsumerDocType,
}) {
  const type = resolveSaleInvoiceType({
    customerNif,
    paymentMethod,
    total,
    invoiceType,
    trustExplicit,
    finalConsumerDocType,
  });
  if ((type === 'FS' || type === 'TV') && Number(total) > fsMaxAmount()) {
    const label = type === 'TV' ? 'Talão de venda (TV)' : 'Fatura simplificada (FS)';
    throw new Error(
      `${label} limitado a ${fsMaxAmount().toLocaleString('pt-AO')} AOA. `
      + 'Indique o NIF do cliente para emitir fatura completa.',
    );
  }
  return type;
}

module.exports = {
  FINAL_CONSUMER_NIFS,
  SALE_INVOICE_TYPES,
  fsMaxAmount,
  normalizeFinalConsumerDocType,
  normalizeCustomerNif,
  isFinalConsumer,
  resolveSaleInvoiceType,
  sequenceKeyForInvoiceType,
  prefixForInvoiceType,
  validateSaleInvoiceType,
};
