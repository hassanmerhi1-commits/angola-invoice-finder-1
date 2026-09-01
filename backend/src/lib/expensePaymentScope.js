const { userHasPermission } = require('./rolePermissions');

function scopeError(message) {
  const error = new Error(message);
  error.statusCode = 403;
  return error;
}

/** Cashiers may request a till expense; a manager/admin must approve before it is paid. */
function cashierNeedsExpenseApproval(user) {
  return user?.role === 'cashier'
    && !userHasPermission(user.role, user.permissionOverrides, 'expense_approve');
}

function coerceExpenseCreateStatus(user, status, alreadyPaid) {
  if (alreadyPaid) return String(status || 'paid');
  if (cashierNeedsExpenseApproval(user)) return 'pending_approval';
  return String(status || 'draft');
}

function assertExpenseCanPay(user) {
  if (cashierNeedsExpenseApproval(user)) {
    throw scopeError('Esta despesa precisa de aprovação do gerente ou administrador antes de ser paga.');
  }
}

/**
 * Cashiers may request operating expenses from caixa (taxi, materials, …).
 * Bank payouts need bank_manage. Staff/salaries stay off the cashier till
 * unless that user was explicitly given expense_approve.
 */
function assertExpensePaymentScope(user, payload = {}) {
  const role = user?.role;
  const overrides = user?.permissionOverrides;
  const source = String(payload.paymentSource || payload.payment_source || 'caixa').trim().toLowerCase();
  const category = String(payload.category || 'other').trim().toLowerCase();

  if (source === 'bank' && !userHasPermission(role, overrides, 'bank_manage')) {
    throw scopeError('Este utilizador só pode pagar despesas pela caixa, não pelo banco.');
  }

  const cashierBlockedFromStaff = role === 'cashier'
    && !userHasPermission(role, overrides, 'expense_approve');
  if (cashierBlockedFromStaff && category === 'staff') {
    throw scopeError('Salários não podem ser pagos pela caixa do operador.');
  }
}

module.exports = {
  assertExpensePaymentScope,
  assertExpenseCanPay,
  cashierNeedsExpenseApproval,
  coerceExpenseCreateStatus,
};
