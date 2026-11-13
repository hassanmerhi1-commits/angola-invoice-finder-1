const test = require('node:test');
const assert = require('node:assert/strict');
const { cashCloseVariance, CASH_SHORT_ACCOUNT, CASH_OVER_ACCOUNT } = require('../src/lib/caixaCloseVariance');

test('a short drawer is a loss against the cash account', () => {
  const row = cashCloseVariance(10000, 2000);
  assert.equal(row.kind, 'short');
  assert.equal(row.amount, 8000);
  assert.equal(row.direction, 'out');
  assert.equal(row.accountCode, CASH_SHORT_ACCOUNT);
});

test('extra cash in the drawer is income', () => {
  const row = cashCloseVariance(10000, 10500);
  assert.equal(row.kind, 'over');
  assert.equal(row.amount, 500);
  assert.equal(row.direction, 'in');
  assert.equal(row.accountCode, CASH_OVER_ACCOUNT);
});

test('a matching count posts nothing', () => {
  assert.equal(cashCloseVariance(10000, 10000).kind, 'balanced');
  assert.equal(cashCloseVariance(10000, 10000.004).kind, 'balanced');
});

test('a missing count is not a journal', () => {
  assert.equal(cashCloseVariance(10000, undefined), null);
  assert.equal(cashCloseVariance(undefined, 2000), null);
});
