import { useEffect, useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { toast } from '@/components/ui/sonner';
import { useAuth } from '@/hooks/useERP';
import { useTranslation } from '@/i18n';
import { resolveAppPathname } from '@/lib/nexorPurchaseCreate';
import { canAccessRoute } from '@/lib/routePermissions';

/**
 * Blocks pages the logged-in role lacks permission for, regardless of how the
 * user got there (sidebar, top menu, toolbar, or a direct URL). Redirects to the
 * dashboard with a toast instead of rendering a page they can't use. Backend
 * RBAC remains the final enforcement layer.
 */
export function RoutePermissionGuard() {
  const { user } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  const path = resolveAppPathname(location.pathname);
  const allowed = canAccessRoute(user?.role, user?.permissionOverrides, path);
  const notifiedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!allowed && notifiedFor.current !== path) {
      notifiedFor.current = path;
      toast.error(t.topNav.toolbar.noPermission);
    }
  }, [allowed, path, t]);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
