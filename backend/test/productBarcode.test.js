const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeProductBarcode, trimProductBarcode } = require('../src/lib/productBarcode');

test('mergeProductBarcode keeps the stored code when a later write sends blank', () => {
  assert.equal(mergeProductBarcode('', '123456789'), '123456789');
  assert.equal(mergeProductBarcode(undefined, '123456789'), '123456789');
  assert.equal(mergeProductBarcode(null, '123456789'), '123456789');
  assert.equal(mergeProductBarcode('   ', '123456789'), '123456789');
});

test('mergeProductBarcode writes a new non-empty code', () => {
  assert.equal(mergeProductBarcode('987654321', '123456789'), '987654321');
  assert.equal(mergeProductBarcode('  555  ', ''), '555');
});

test('trimProductBarcode treats missing values as empty', () => {
  assert.equal(trimProductBarcode(null), '');
  assert.equal(trimProductBarcode(undefined), '');
  assert.equal(trimProductBarcode('  123  '), '123');
});
