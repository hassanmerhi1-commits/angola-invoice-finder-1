/**
 * Angola fiscal invoice types — FT (invoice), FR (invoice-receipt), FS (simplified).
 */
const FINAL_CONSUMER_NIFS = new Set(['999999990', '999999999', '']);

function fsMaxAmount() {
  const n = Number(process.env.AGT_FS_MAX_AMOUNT || 100000);
  return Number.isFinite(n) && n > 0 ? n : 100000;
}

function isFinalConsumer(customerNif) {
  const n = String(customerNif || '').trim();
  return !n || FINAL_CONSUMER_NIFS.has(n);
}

function isPaidAtIssue(paymentMethod) {
  return paymentMethod === 'cash' || paymentMethod === 'card' || paymentMethod === 'mixed';
}

/**
 * Resolve AGT document type for a sale.
 * @returns {'FT'|'FR'|'FS'}
 */
function resolveSaleInvoiceType({ customerNif, paymentMethod, total, invoiceType }) {
  const explicit = String(invoiceType || '').trim().toUpperCase();
  if (['FT', 'FR', 'FS'].includes(explicit)) return explicit;

  const amount = Number(total) || 0;
  const paidNow = isPaidAtIssue(paymentMethod);

  if (!isFinalConsumer(customerNif)) {
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

function validateSaleInvoiceType({ invoiceType, customerNif, paymentMethod, total }) {
  const type = resolveSaleInvoiceType({ customerNif, paymentMethod, total, invoiceType });
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
  isFinalConsumer,
  resolveSaleInvoiceType,
  sequenceKeyForInvoiceType,
  prefixForInvoiceType,
  validateSaleInvoiceType,
};
