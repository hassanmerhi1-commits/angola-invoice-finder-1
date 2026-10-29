const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SESSION_OPEN_PERMISSIONS,
  REGISTER_ENSURE_PERMISSIONS,
  REGISTER_SETTINGS_PERMISSIONS,
  allowsAny,
  openingBalanceOrZero,
} = require('../src/lib/caixaOpenAccess');

const none = { granted: [], revoked: [] };

test('cashier can open a shift and ensure the register without caixa settings rights', () => {
  assert.equal(allowsAny('cashier', none, SESSION_OPEN_PERMISSIONS), true);
  assert.equal(allowsAny('cashier', none, REGISTER_ENSURE_PERMISSIONS), true);
  assert.equal(allowsAny('cashier', none, REGISTER_SETTINGS_PERMISSIONS), false);
  assert.equal(allowsAny('manager', none, REGISTER_SETTINGS_PERMISSIONS), true);
  assert.equal(allowsAny('viewer', none, SESSION_OPEN_PERMISSIONS), false);
});

test('opening float of zero is kept', () => {
  assert.equal(openingBalanceOrZero(0), 0);
  assert.equal(openingBalanceOrZero('0'), 0);
  assert.equal(openingBalanceOrZero(''), 0);
  assert.equal(openingBalanceOrZero(null), 0);
  assert.equal(openingBalanceOrZero(undefined), 0);
  assert.equal(openingBalanceOrZero(1500.5), 1500.5);
  assert.equal(openingBalanceOrZero('12'), 12);
});
