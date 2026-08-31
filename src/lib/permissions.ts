// NEXOR ERP - User Roles & Permissions System
// Every button, every tab, every action is permission-controlled

export type UserRole = 'admin' | 'manager' | 'cashier' | 'viewer';

export interface Permission {
  id: string;
  name: string;
  description: string;
  category: 'sales' | 'inventory' | 'reports' | 'admin' | 'fiscal' | 'accounting' | 'stock';
}

export interface RolePermissions {
  role: UserRole;
  permissions: string[];
}

// ==================== ALL PERMISSIONS ====================
export const PERMISSIONS: Permission[] = [
  // Sales & POS
  { id: 'pos_access', name: 'POS Access', description: 'Access the Point of Sale', category: 'sales' },
  { id: 'pos_discount', name: 'Apply Discounts', description: 'Apply discounts', category: 'sales' },
  { id: 'pos_void', name: 'Void Sales', description: 'Void sales', category: 'sales' },
  { id: 'pos_refund', name: 'Process Refunds', description: 'Process refunds', category: 'sales' },
  { id: 'pos_price_change', name: 'Change Prices at POS', description: 'Change prices at POS', category: 'sales' },

  // Invoicing / Faturação
  { id: 'invoice_create', name: 'Create Invoice', description: 'Create sales invoices', category: 'fiscal' },
  { id: 'invoice_view', name: 'View Invoices', description: 'View invoices', category: 'fiscal' },
  { id: 'invoice_delete', name: 'Delete Invoice', description: 'Reserved — issued invoices cannot be deleted; use cancellation/credit note', category: 'fiscal' },
  { id: 'invoice_print', name: 'Print Invoice', description: 'Print invoices', category: 'fiscal' },
  { id: 'proforma_create', name: 'Create Proforma', description: 'Create proforma invoices', category: 'fiscal' },
  { id: 'proforma_convert', name: 'Convert Proforma', description: 'Convert proforma to invoice', category: 'fiscal' },
  { id: 'credit_note_create', name: 'Credit Notes', description: 'Create credit notes', category: 'fiscal' },
  { id: 'debit_note_create', name: 'Debit Notes', description: 'Create debit notes', category: 'fiscal' },
  { id: 'receipt_create', name: 'Create Receipt', description: 'Create receipts', category: 'fiscal' },
  { id: 'agt_send', name: 'AGT Send', description: 'Send documents to AGT', category: 'fiscal' },
  { id: 'saft_export', name: 'SAF-T Export', description: 'Export SAF-T', category: 'fiscal' },

  // Accounting / Contabilidade
  { id: 'accounting_view', name: 'View Accounts', description: 'View chart of accounts', category: 'accounting' },
  { id: 'accounting_create', name: 'Create Entries', description: 'Create journal entries', category: 'accounting' },
  { id: 'accounting_journal', name: 'Journal Access', description: 'Access journals', category: 'accounting' },
  { id: 'backdate_post', name: 'Backdate Posting', description: 'Post with a date before today', category: 'accounting' },
  { id: 'edit_historical', name: 'Edit Historical', description: 'Edit records dated before today', category: 'accounting' },
  { id: 'accounting_payment', name: 'Process Payment', description: 'Process payments', category: 'accounting' },
  { id: 'accounting_receipt', name: 'Process Receipt', description: 'Process receipts', category: 'accounting' },
  { id: 'caixa_open', name: 'Open Caixa', description: 'Open cash register', category: 'accounting' },
  { id: 'caixa_close', name: 'Close Caixa', description: 'Close cash register', category: 'accounting' },
  { id: 'bank_manage', name: 'Manage Banks', description: 'Manage bank accounts', category: 'accounting' },
  { id: 'expense_create', name: 'Create Expense', description: 'Record expenses', category: 'accounting' },
  { id: 'expense_approve', name: 'Approve Expense', description: 'Approve expenses', category: 'accounting' },
  { id: 'client_manage', name: 'Manage Clients', description: 'Create and edit clients', category: 'accounting' },

  // Inventory / Stock
  { id: 'inventory_view', name: 'View Inventory', description: 'View stock', category: 'inventory' },
  { id: 'inventory_create', name: 'Create Products', description: 'Add products', category: 'inventory' },
  { id: 'inventory_edit', name: 'Edit Products', description: 'Modify products', category: 'inventory' },
  { id: 'inventory_delete', name: 'Delete Products', description: 'Delete products', category: 'inventory' },
  { id: 'inventory_adjust', name: 'Adjust Stock', description: 'Adjust quantities', category: 'stock' },
  { id: 'inventory_transfer', name: 'Transfer Stock', description: 'Transfer between branches', category: 'stock' },
  { id: 'inventory_import', name: 'Import Products', description: 'Import from Excel', category: 'inventory' },
  { id: 'inventory_export', name: 'Export Products', description: 'Export to Excel', category: 'inventory' },
  { id: 'price_view', name: 'View Prices', description: 'View cost prices', category: 'inventory' },
  { id: 'price_edit', name: 'Edit Prices', description: 'Modify prices', category: 'inventory' },
  { id: 'purchase_create', name: 'Create PO', description: 'Create purchase order', category: 'stock' },
  { id: 'purchase_approve', name: 'Approve PO', description: 'Approve purchase order', category: 'stock' },
  { id: 'purchase_receive', name: 'Receive PO', description: 'Receive goods', category: 'stock' },

  // Reports
  { id: 'reports_daily', name: 'Daily Reports', description: 'Daily reports', category: 'reports' },
  { id: 'reports_close', name: 'Close Day', description: 'Close the day', category: 'reports' },
  { id: 'reports_financial', name: 'Financial Reports', description: 'Financial reports', category: 'reports' },
  { id: 'reports_audit', name: 'Audit Trail', description: 'Audit history', category: 'reports' },
  { id: 'reports_stock', name: 'Stock Reports', description: 'Stock reports', category: 'reports' },
  { id: 'reports_client_statement', name: 'Client Statement', description: 'Client statement', category: 'reports' },
  { id: 'reports_supplier_statement', name: 'Supplier Statement', description: 'Supplier statement', category: 'reports' },

  // Admin
  { id: 'admin_users', name: 'Manage Users', description: 'Manage users', category: 'admin' },
  { id: 'admin_roles', name: 'Manage Roles', description: 'Assign roles', category: 'admin' },
  { id: 'admin_permissions', name: 'Manage Permissions', description: 'Manage permissions', category: 'admin' },
  { id: 'admin_branches', name: 'Manage Branches', description: 'Manage branches', category: 'admin' },
  { id: 'admin_settings', name: 'System Settings', description: 'System settings', category: 'admin' },
  { id: 'admin_backup', name: 'Backup Data', description: 'Backup data', category: 'admin' },
  { id: 'admin_restore', name: 'Restore Data', description: 'Restore data', category: 'admin' },
  { id: 'admin_consistency', name: 'Data Consistency', description: 'Check and repair consistency', category: 'admin' },
];

// Default permissions by role
export const DEFAULT_ROLE_PERMISSIONS: RolePermissions[] = [
  {
    role: 'admin',
    permissions: PERMISSIONS.map(p => p.id), // All permissions
  },
  {
    role: 'manager',
    permissions: [
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
  },
  {
    role: 'cashier',
    // POS + petty-cash expenses (taxi, materials) from the open till.
    // Everything else is granted per-user via permission overrides in User Management.
    permissions: [
      'pos_access', 'pos_discount',
      'receipt_create', 'invoice_print',
      'expense_create',
    ],
  },
  {
    role: 'viewer',
    permissions: [
      'invoice_view',
      'accounting_view',
      'inventory_view',
      'reports_daily',
    ],
  },
];

// Role display names (English fallback; UI should prefer i18n userManagementUi.roles)
export const ROLE_NAMES: Record<UserRole, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Cashier',
  viewer: 'Viewer',
};

// Role colors
export const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-destructive text-destructive-foreground',
  manager: 'bg-primary text-primary-foreground',
  cashier: 'bg-secondary text-secondary-foreground',
  viewer: 'bg-muted text-muted-foreground',
};

// Helper: Check if a role has a specific permission
export function roleHasPermission(role: UserRole, permissionId: string): boolean {
  const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
  return rolePerms?.permissions.includes(permissionId) ?? false;
}

// Per-user permission overrides (grant/revoke deltas applied on top of the role).
export interface PermissionOverrides {
  granted: string[];
  revoked: string[];
}

export function normalizeOverrides(o?: Partial<PermissionOverrides> | null): PermissionOverrides {
  return {
    granted: Array.isArray(o?.granted) ? o!.granted.filter(x => typeof x === 'string') : [],
    revoked: Array.isArray(o?.revoked) ? o!.revoked.filter(x => typeof x === 'string') : [],
  };
}

export function hasOverrides(o?: Partial<PermissionOverrides> | null): boolean {
  const n = normalizeOverrides(o);
  return n.granted.length > 0 || n.revoked.length > 0;
}

// Effective check: role baseline with per-user grant/revoke applied.
// Admins always have everything (immune to revokes); revoke wins over grant.
export function userHasPermission(
  role: UserRole,
  overrides: Partial<PermissionOverrides> | null | undefined,
  permissionId: string,
): boolean {
  if (role === 'admin') return true;
  const o = normalizeOverrides(overrides);
  if (o.revoked.includes(permissionId)) return false;
  if (o.granted.includes(permissionId)) return true;
  return roleHasPermission(role, permissionId);
}

// Full effective permission id set for a user (role defaults + grants − revokes).
// Admins get every permission.
export function getEffectivePermissions(
  role: UserRole,
  overrides?: Partial<PermissionOverrides> | null,
): string[] {
  if (role === 'admin') return PERMISSIONS.map(p => p.id);
  const base = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role)?.permissions ?? [];
  const o = normalizeOverrides(overrides);
  const set = new Set(base);
  for (const g of o.granted) set.add(g);
  for (const r of o.revoked) set.delete(r);
  return [...set];
}

// Convert a chosen effective permission set back into grant/revoke deltas vs the role.
export function diffOverridesFromEffective(role: UserRole, effective: string[]): PermissionOverrides {
  if (role === 'admin') return { granted: [], revoked: [] };
  const base = new Set(DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role)?.permissions ?? []);
  const chosen = new Set(effective);
  const granted = [...chosen].filter(p => !base.has(p));
  const revoked = [...base].filter(p => !chosen.has(p));
  return { granted, revoked };
}

// Helper: Get all permissions for a role grouped by category
export function getPermissionsByCategory(role: UserRole) {
  const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
  const granted = new Set(rolePerms?.permissions || []);

  const categories = [...new Set(PERMISSIONS.map(p => p.category))];
  return categories.map(cat => ({
    category: cat,
    permissions: PERMISSIONS.filter(p => p.category === cat).map(p => ({
      ...p,
      granted: granted.has(p.id),
    })),
  }));
}