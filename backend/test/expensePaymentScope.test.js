const test = require('node:test');
const assert = require('node:assert/strict');
const { assertExpensePaymentScope } = require('../src/lib/expensePaymentScope');

const cashier = { role: 'cashier', permissionOverrides: { granted: [], revoked: [] } };
const manager = { role: 'manager', permissionOverrides: { granted: [], revoked: [] } };
const admin = { role: 'admin', permissionOverrides: { granted: [], revoked: [] } };

function throwsStatus(fn, status, snippet) {
  try {
    fn();
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.statusCode, status);
    assert.match(String(err.message), snippet);
  }
}

test('cashier may pay transport / materials from caixa', () => {
  assert.doesNotThrow(() => assertExpensePaymentScope(cashier, {
    paymentSource: 'caixa',
    category: 'transport',
  }));
  assert.doesNotThrow(() => assertExpensePaymentScope(cashier, {
    paymentSource: 'caixa',
    category: 'materials',
  }));
});

test('cashier cannot pay an expense from a bank account', () => {
  throwsStatus(
    () => assertExpensePaymentScope(cashier, { paymentSource: 'bank', category: 'materials' }),
    403,
    /caixa/,
  );
});

test('cashier cannot pay staff salaries from the till', () => {
  throwsStatus(
    () => assertExpensePaymentScope(cashier, { paymentSource: 'caixa', category: 'staff' }),
    403,
    /Salários/,
  );
});

test('cashier granted expense_approve may record staff', () => {
  const elevated = {
    role: 'cashier',
    permissionOverrides: { granted: ['expense_approve'], revoked: [] },
  };
  assert.doesNotThrow(() => assertExpensePaymentScope(elevated, {
    paymentSource: 'caixa',
    category: 'staff',
  }));
});

test('manager may pay from bank and record staff', () => {
  assert.doesNotThrow(() => assertExpensePaymentScope(manager, {
    paymentSource: 'bank',
    category: 'staff',
  }));
});

test('admin is unrestricted', () => {
  assert.doesNotThrow(() => assertExpensePaymentScope(admin, {
    paymentSource: 'bank',
    category: 'staff',
  }));
});
