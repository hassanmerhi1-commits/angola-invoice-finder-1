const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSaleJournalAmounts } = require('../src/lib/saleJournalAmounts');

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

test('discounted invoice journal credits net sales (total − IVA), not GROSS + IVA', () => {
  // Reported: Debit=10925.00, Credit=11472.62, Difference=547.62 (the discount).
  const amounts = resolveSaleJournalAmounts({
    subtotal: 10000,
    taxAmount: 1472.62,
    discount: 547.62,
    total: 10925.00,
  });
  assert.equal(amounts.netSales, 9452.38);
  assert.equal(amounts.headerWasGross, true);
  assert.equal(round2(amounts.netSales + amounts.tax), amounts.total);
  assert.equal(round2(amounts.total + amounts.discount), 11472.62);
});

test('POS net subtotal (discount already in lines) stays net', () => {
  const amounts = resolveSaleJournalAmounts({
    subtotal: 9452.38,
    taxAmount: 1472.62,
    discount: 547.62,
    total: 10925.00,
  });
  assert.equal(amounts.netSales, 9452.38);
  assert.equal(amounts.headerWasGross, false);
  assert.equal(round2(amounts.netSales + amounts.tax), 10925.00);
});

test('sale without discount: net equals header subtotal', () => {
  const amounts = resolveSaleJournalAmounts({
    subtotal: 10000,
    taxAmount: 1400,
    discount: 0,
    total: 11400,
  });
  assert.equal(amounts.netSales, 10000);
  assert.equal(amounts.headerWasGross, false);
});
