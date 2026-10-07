const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveSaleInvoiceType,
  normalizeCustomerNif,
  fsMaxAmount,
  sequenceKeyForInvoiceType,
  validateSaleInvoiceType,
  normalizeFinalConsumerDocType,
} = require('../src/lib/fiscalInvoiceType');

test('final consumer cash sale ≤ FS limit → FS', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'cash', total: 50_000 }),
    'FS',
  );
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '999999990', paymentMethod: 'card', total: 99_999 }),
    'FS',
  );
});

test('final consumer cash sale above FS limit → FR', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'cash', total: fsMaxAmount() + 1 }),
    'FR',
  );
});

test('final consumer transfer / Multibanco sale → FR (paid at issue)', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'transfer', total: 200_000 }),
    'FR',
  );
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'multibanco', total: 50_000 }),
    'FS',
  );
});

test('identified customer paid at issue → FR', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '5000123456', paymentMethod: 'cash', total: 10_000 }),
    'FR',
  );
});

test('finalConsumerDocType TV replaces FS for final consumer paid ≤ limit', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'cash', total: 50_000, finalConsumerDocType: 'TV' }),
    'TV',
  );
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'cash', total: fsMaxAmount() + 1, finalConsumerDocType: 'TV' }),
    'FR',
  );
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '5000123456', paymentMethod: 'cash', total: 10_000, finalConsumerDocType: 'TV' }),
    'FR',
  );
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'credit', total: 10_000, finalConsumerDocType: 'TV' }),
    'FT',
  );
});

test('normalizeFinalConsumerDocType defaults to FS', () => {
  assert.equal(normalizeFinalConsumerDocType(undefined), 'FS');
  assert.equal(normalizeFinalConsumerDocType('xx'), 'FS');
  assert.equal(normalizeFinalConsumerDocType(' tv '), 'TV');
});

test('TV uses its own sales_ticket sequence', () => {
  assert.equal(sequenceKeyForInvoiceType('TV'), 'sales_ticket');
  assert.equal(sequenceKeyForInvoiceType('FS'), 'simplified_invoice');
});

test('explicit TV above the limit is rejected', () => {
  assert.throws(
    () => validateSaleInvoiceType({
      invoiceType: 'TV',
      trustExplicit: true,
      customerNif: '',
      paymentMethod: 'cash',
      total: fsMaxAmount() + 1,
    }),
    /Talão de venda \(TV\)/,
  );
});

test('normalizeCustomerNif treats consumidor final placeholders as empty', () => {
  assert.equal(normalizeCustomerNif('999999990'), '');
  assert.equal(normalizeCustomerNif('CF'), '');
  assert.equal(normalizeCustomerNif('  '), '');
  assert.equal(normalizeCustomerNif('1234567890'), '1234567890');
});
