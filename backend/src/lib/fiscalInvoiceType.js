/**
 * Angola fiscal invoice types — FT (invoice), FR (invoice-receipt), FS (simplified).
 */
const FINAL_CONSUMER_NIFS = new Set(['999999990', '999999999', '']);

function fsMaxAmount() {
  const n = Number(process.env.AGT_FS_MAX_AMOUNT || 100000);
  return Number.isFinite(n) && n > 0 ? n : 100000;
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
  return paymentMethod === 'cash' || paymentMethod === 'card' || paymentMethod === 'mixed';
}

/**
 * Resolve AGT document type for a sale.
 * @returns {'FT'|'FR'|'FS'}
 */
function resolveSaleInvoiceType({ customerNif, paymentMethod, total, invoiceType, trustExplicit = false }) {
  const explicit = String(invoiceType || '').trim().toUpperCase();
  if (trustExplicit && ['FT', 'FR', 'FS'].includes(explicit)) return explicit;

  const nif = normalizeCustomerNif(customerNif);
  const amount = Number(total) || 0;
  const paidNow = isPaidAtIssue(paymentMethod);

  if (!isFinalConsumer(nif)) {
    return paidNow ? 'FR' : 'FT';
  }

  if (paidNow && amount <= fsMaxAmount()) return 'FS';
  if (paidNow) return 'FR';
  return 'FT';
}

function sequenceKeyForInvoiceType(invoiceType) {
  switch (String(invoiceType || 'FT').toUpperCase()) {
    case 'FS':
      return 'simplified_invoice';
    case 'FR':
      return 'invoice_receipt';
    default:
      return 'sales_invoice';
  }
}

function prefixForInvoiceType(invoiceType) {
  return String(invoiceType || 'FT').toUpperCase();
}

function validateSaleInvoiceType({ invoiceType, customerNif, paymentMethod, total, trustExplicit = false }) {
  const type = resolveSaleInvoiceType({
    customerNif,
    paymentMethod,
    total,
    invoiceType,
    trustExplicit,
  });
  if (type === 'FS' && Number(total) > fsMaxAmount()) {
    throw new Error(
      `Fatura simplificada (FS) limitada a ${fsMaxAmount().toLocaleString('pt-AO')} AOA. `
      + 'Indique o NIF do cliente para emitir fatura completa.',
    );
  }
  return type;
}

module.exports = {
  FINAL_CONSUMER_NIFS,
  fsMaxAmount,
  normalizeCustomerNif,
  isFinalConsumer,
  resolveSaleInvoiceType,
  sequenceKeyForInvoiceType,
  prefixForInvoiceType,
  validateSaleInvoiceType,
};
