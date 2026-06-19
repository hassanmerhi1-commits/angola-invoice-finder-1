/**
 * Backend role → permission map (mirrors src/lib/permissions.ts DEFAULT_ROLE_PERMISSIONS).
 */
const ROLE_PERMISSIONS = {
  admin: null, // all permissions
  manager: [
    'pos_access', 'pos_discount', 'pos_void', 'pos_refund', 'pos_price_change',
    'invoice_create', 'invoice_view', 'invoice_print', 'proforma_create', 'proforma_convert',
    'credit_note_create', 'debit_note_create', 'receipt_create', 'agt_send', 'saft_export',
    'accounting_view', 'accounting_create', 'accounting_journal', 'accounting_payment', 'accounting_receipt',
    'caixa_open', 'caixa_close', 'bank_manage', 'expense_create',
    'inventory_view', 'inventory_create', 'inventory_edit', 'inventory_adjust', 'inventory_transfer',
    'inventory_import', 'inventory_export', 'price_view', 'price_edit',
    'purchase_create', 'purchase_receive',
    'reports_daily', 'reports_close', 'reports_financial', 'reports_stock', 'reports_audit',
    'reports_client_statement', 'reports_supplier_statement',
  ],
  cashier: [
    'pos_access', 'pos_discount',
    'invoice_view', 'invoice_print', 'receipt_create',
    'accounting_view', 'caixa_open',
    'inventory_view',
    'reports_daily',
  ],
  viewer: [
    'invoice_view',
    'accounting_view',
    'inventory_view',
    'reports_daily',
    'reports_audit',
  ],
};

function roleHasPermission(role, permissionId) {
  if (!role) return false;
  // TESTING OVERRIDE: delete actions are enabled for every role during QA.
  // Remove this line to restore role-based delete restrictions.
  if (typeof permissionId === 'string' && permissionId.endsWith('_delete')) return true;
  if (role === 'admin') return true;
  const perms = ROLE_PERMISSIONS[role];
  return Array.isArray(perms) && perms.includes(permissionId);
}

module.exports = { roleHasPermission, ROLE_PERMISSIONS };
