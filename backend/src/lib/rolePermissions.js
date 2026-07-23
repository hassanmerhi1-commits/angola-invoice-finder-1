/**
 * Backend role → permission map (mirrors src/lib/permissions.ts DEFAULT_ROLE_PERMISSIONS).
 */
const ROLE_PERMISSIONS = {
  admin: null, // all permissions
  manager: [
    'pos_access', 'pos_discount', 'pos_void', 'pos_refund', 'pos_price_change',
    'invoice_create', 'invoice_view', 'invoice_print', 'proforma_create', 'proforma_convert',
    'credit_note_create', 'debit_note_create', 'receipt_create', 'agt_send', 'saft_export',
    'accounting_view', 'accounting_create', 'accounting_journal', 'backdate_post', 'edit_historical',
    'accounting_payment', 'accounting_receipt',
    'caixa_open', 'caixa_close', 'bank_manage', 'expense_create', 'client_manage',
    'inventory_view', 'inventory_create', 'inventory_edit', 'inventory_adjust', 'inventory_transfer',
    'inventory_import', 'inventory_export', 'price_view', 'price_edit',
    'purchase_create', 'purchase_receive',
    'reports_daily', 'reports_close', 'reports_financial', 'reports_stock', 'reports_audit',
    'reports_client_statement', 'reports_supplier_statement',
  ],
  // POS-only baseline. Everything else is granted per-user via permission overrides.
  cashier: [
    'pos_access', 'pos_discount',
    'receipt_create', 'invoice_print',
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
  if (role === 'admin') return true;
  // QA: *_delete is admin-only until testing finishes — then delete this block
  // and grant invoice_delete / inventory_delete via role map or overrides.
  if (typeof permissionId === 'string' && permissionId.endsWith('_delete')) return false;
  const perms = ROLE_PERMISSIONS[role];
  return Array.isArray(perms) && perms.includes(permissionId);
}

/**
 * Parse the raw `users.permissions` value (JSON text or object) into a normalized
 * override delta { granted: string[], revoked: string[] }.
 */
function parsePermissionOverrides(raw) {
  const empty = { granted: [], revoked: [] };
  if (!raw) return empty;
  let obj = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return empty;
    try {
      obj = JSON.parse(trimmed);
    } catch (_) {
      return empty;
    }
  }
  if (!obj || typeof obj !== 'object') return empty;
  const toStrArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  return {
    granted: toStrArray(obj.granted),
    revoked: toStrArray(obj.revoked),
  };
}

/**
 * Effective check: role baseline with per-user grant/revoke deltas applied.
 * Admins always have everything (immune to revokes). Revoke wins over grant.
 */
function userHasPermission(role, overrides, permissionId) {
  if (role === 'admin') return true;
  // QA: *_delete is admin-only until testing finishes — then delete this block.
  if (typeof permissionId === 'string' && permissionId.endsWith('_delete')) return false;
  const o = parsePermissionOverrides(overrides);
  if (o.revoked.includes(permissionId)) return false;
  if (o.granted.includes(permissionId)) return true;
  return roleHasPermission(role, permissionId);
}

/** Full effective permission set for a user (role defaults + grants − revokes). */
function getEffectivePermissions(role, overrides) {
  if (role === 'admin') {
    return Object.keys(ROLE_PERMISSIONS).length ? null : null; // admin = all (null sentinel)
  }
  const base = Array.isArray(ROLE_PERMISSIONS[role]) ? ROLE_PERMISSIONS[role] : [];
  const o = parsePermissionOverrides(overrides);
  const set = new Set(base);
  for (const g of o.granted) set.add(g);
  for (const r of o.revoked) set.delete(r);
  return [...set];
}

module.exports = {
  roleHasPermission,
  userHasPermission,
  getEffectivePermissions,
  parsePermissionOverrides,
  ROLE_PERMISSIONS,
};
