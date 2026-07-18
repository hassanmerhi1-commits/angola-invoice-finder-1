import { userHasPermission, type PermissionOverrides, type UserRole } from '@/lib/permissions';

/**
 * Single source of truth mapping app routes to the permission(s) required to
 * access them. Used by both the sidebar (to hide nav items) and the route guard
 * (to block direct/menu/URL navigation). Only routes NOT listed here are open to
 * any authenticated user — currently just the dashboard ("/"), which is the
 * landing page. Everything else requires a permission, so a minimal (POS-only)
 * cashier sees only what they've been granted.
 */
export const ROUTE_PERMISSIONS: Record<string, string | string[]> = {
  '/pos': 'pos_access',
  '/vendas': 'invoice_view',
  '/invoices': 'invoice_view',
  '/proforma': 'proforma_create',
  '/fiscal-documents': 'invoice_view',
  '/inventory': 'inventory_view',
  '/categories': 'inventory_view',
  '/suppliers': 'inventory_view',
  '/clients': ['client_manage', 'invoice_view'],
  '/customers': 'invoice_view',
  '/purchase-orders': 'purchase_create',
  '/purchase-invoices': 'purchase_create',
  '/stock-transfer': 'inventory_transfer',
  '/import': 'inventory_import',
  '/production': 'inventory_adjust',
  '/caixa': 'caixa_open',
  '/expenses': 'expense_create',
  '/bank-accounts': 'bank_manage',
  '/bank-reconciliation': 'bank_manage',
  '/payments': ['accounting_payment', 'accounting_receipt'],
  '/receivables': ['accounting_payment', 'accounting_receipt'],
  '/payables': ['accounting_payment', 'accounting_receipt'],
  '/chart-of-accounts': 'accounting_view',
  '/accounting-periods': 'accounting_view',
  '/tax-management': 'accounting_view',
  '/budget-control': 'accounting_view',
  '/approvals': 'accounting_view',
  '/journals': 'accounting_journal',
  '/extracto': 'reports_client_statement',
  '/exchange-rates': 'accounting_view',
  '/reports': 'reports_daily',
  '/daily-reports': 'reports_daily',
  '/audit-trail': 'reports_audit',
  '/hr': 'hr_view',
  '/users': 'admin_users',
  '/branches': 'admin_branches',
  '/accounting': 'admin_branches',
  '/data-sync': 'admin_settings',
  '/settings': 'admin_settings',
};

/**
 * Resolves the required permission for a (already app-normalized) pathname,
 * matching exact routes and their sub-paths (e.g. `/purchase-invoices/new`).
 */
export function requiredPermissionForPath(pathname: string): string | string[] | null {
  if (ROUTE_PERMISSIONS[pathname]) return ROUTE_PERMISSIONS[pathname];
  let best: { key: string; perm: string | string[] } | null = null;
  for (const [key, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, perm };
    }
  }
  return best ? best.perm : null;
}

/** True if the user may access the route (open routes always allowed). Honors per-user overrides. */
export function canAccessRoute(
  role: UserRole | undefined,
  overrides: Partial<PermissionOverrides> | null | undefined,
  pathname: string,
): boolean {
  if (!role) return true; // auth handled separately by ProtectedRoute
  const required = requiredPermissionForPath(pathname);
  if (!required) return true;
  const perms = Array.isArray(required) ? required : [required];
  return perms.some((p) => userHasPermission(role, overrides, p));
}
