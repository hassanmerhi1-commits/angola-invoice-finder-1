const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertExpensePaymentScope,
  assertExpenseCanPay,
  cashierNeedsExpenseApproval,
  coerceExpenseCreateStatus,
} = require('../src/lib/expensePaymentScope');

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

test('cashier till expenses wait for manager/admin approval', () => {
  assert.equal(cashierNeedsExpenseApproval(cashier), true);
  assert.equal(cashierNeedsExpenseApproval(manager), false);
  assert.equal(cashierNeedsExpenseApproval(admin), false);
  assert.equal(coerceExpenseCreateStatus(cashier, 'paid', false), 'pending_approval');
  assert.equal(coerceExpenseCreateStatus(cashier, 'draft', false), 'pending_approval');
  assert.equal(coerceExpenseCreateStatus(manager, 'draft', false), 'draft');
  assert.equal(coerceExpenseCreateStatus(cashier, 'paid', true), 'paid');
});

test('cashier cannot pay until an approver does', () => {
  throwsStatus(() => assertExpenseCanPay(cashier), 403, /aprovação/);
  assert.doesNotThrow(() => assertExpenseCanPay(manager));
  assert.doesNotThrow(() => assertExpenseCanPay(admin));
});
