const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveSaleInvoiceType,
  normalizeCustomerNif,
  fsMaxAmount,
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

test('final consumer transfer sale → FT', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '', paymentMethod: 'transfer', total: 200_000 }),
    'FT',
  );
});

test('identified customer paid at issue → FR', () => {
  assert.equal(
    resolveSaleInvoiceType({ customerNif: '5000123456', paymentMethod: 'cash', total: 10_000 }),
    'FR',
  );
});

test('normalizeCustomerNif treats consumidor final placeholders as empty', () => {
  assert.equal(normalizeCustomerNif('999999990'), '');
  assert.equal(normalizeCustomerNif('CF'), '');
  assert.equal(normalizeCustomerNif('  '), '');
  assert.equal(normalizeCustomerNif('1234567890'), '1234567890');
});
