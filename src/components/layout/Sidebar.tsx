import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { CompanyLogo } from '@/components/layout/CompanyLogo';
import { usePermissions } from '@/hooks/usePermissions';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Package,
  Users,
  Building2,
  BarChart3,
  Settings,
  ArrowRightLeft,
  Calendar,
  Upload,
  Truck,
  ClipboardList,
  Tags,
  FileCheck,
  Shield,
  BookOpen,
  FileEdit,
  Receipt,
  Landmark,
  Wallet,
  CreditCard,
  CalendarCheck,
  Calculator,
  Target,
  GitBranch,
  Coins,
  Lock,
  Scale,
  Factory,
  UserCheck,
  NotebookPen,
  TrendingUp,
} from 'lucide-react';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

// Map routes to required permissions
const ROUTE_PERMISSIONS: Record<string, string | string[]> = {
  '/pos': 'pos_access',
  '/invoices': 'invoice_view',
  '/proforma': 'proforma_create',
  '/fiscal-documents': 'invoice_view',
  '/inventory': 'inventory_view',
  '/categories': 'inventory_view',
  '/suppliers': 'inventory_view',
  '/purchase-orders': 'purchase_create',
  '/purchase-invoices': 'purchase_create',
  '/stock-transfer': 'inventory_transfer',
  '/caixa': 'caixa_open',
  '/expenses': 'expense_create',
  '/bank-accounts': 'bank_manage',
  '/bank-reconciliation': 'bank_manage',
  '/payments': 'accounting_payment',
  '/chart-of-accounts': 'accounting_view',
  '/accounting-periods': 'accounting_view',
  '/tax-management': 'accounting_view',
  '/budget-control': 'accounting_view',
  '/approvals': 'accounting_view',
  '/audit-trail': 'reports_audit',
  '/users': 'admin_users',
  '/branches': 'admin_branches',
  '/reports': 'reports_daily',
  '/settings': 'admin_settings',
};

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();

  // Get current user ID for permission checking
  let currentUserId: string | undefined;
  try {
    const cu = localStorage.getItem('kwanzaerp_current_user');
    if (cu) currentUserId = JSON.parse(cu)?.id;
  } catch { /* ignore */ }

  const { hasPermission, isAdmin } = usePermissions(currentUserId);

  const navItems = [
    { icon: LayoutDashboard, label: t.nav.dashboard, path: '/' },
    { icon: ShoppingCart, label: t.nav.pos, path: '/pos' },
    { icon: FileText, label: t.nav.invoices, path: '/invoices' },
    { icon: FileEdit, label: t.nav.proforma, path: '/proforma' },
    { icon: FileCheck, label: t.nav.fiscalDocuments, path: '/fiscal-documents' },
    { icon: Package, label: t.nav.inventory, path: '/inventory' },
    { icon: Tags, label: t.nav.categories, path: '/categories' },
    { icon: Truck, label: t.nav.suppliers, path: '/suppliers' },
    { icon: ClipboardList, label: t.nav.purchaseOrders, path: '/purchase-orders' },
    { icon: FileText, label: t.nav.purchaseInvoices, path: '/purchase-invoices' },
    { icon: Calendar, label: t.nav.dailyReports, path: '/daily-reports' },
    { icon: ArrowRightLeft, label: t.stockTransfer.title, path: '/stock-transfer' },
    { icon: Users, label: t.nav.clients, path: '/clients' },
    { icon: Wallet, label: t.nav.caixa, path: '/caixa' },
    { icon: Receipt, label: t.nav.expenses, path: '/expenses' },
    { icon: Landmark, label: t.nav.bankAccounts, path: '/bank-accounts' },
    { icon: Scale, label: t.nav.bankReconciliation, path: '/bank-reconciliation' },
    { icon: Upload, label: t.nav.dataSync, path: '/data-sync' },
    { icon: CreditCard, label: t.nav.payments, path: '/payments' },
    { icon: BookOpen, label: t.nav.chartOfAccounts, path: '/chart-of-accounts' },
    { icon: CalendarCheck, label: t.nav.accountingPeriods, path: '/accounting-periods' },
    { icon: Calculator, label: t.nav.taxManagement, path: '/tax-management' },
    { icon: Target, label: t.nav.budgetControl, path: '/budget-control' },
    { icon: GitBranch, label: t.nav.approvals, path: '/approvals' },
    { icon: Coins, label: t.nav.exchangeRates, path: '/exchange-rates' },
    { icon: Shield, label: t.nav.auditTrail, path: '/audit-trail' },
    { icon: NotebookPen, label: t.nav.journals, path: '/journals' },
    { icon: TrendingUp, label: t.nav.sales, path: '/vendas' },
    { icon: Factory, label: t.nav.production, path: '/production' },
    { icon: UserCheck, label: t.nav.hr, path: '/hr' },
    { icon: Shield, label: t.nav.users, path: '/users' },
    { icon: Building2, label: t.nav.branches, path: '/branches' },
    { icon: BarChart3, label: t.nav.reports, path: '/reports' },
    { icon: Settings, label: t.nav.settings, path: '/settings' },
  ];

  // Filter by permissions (admin sees everything, dashboard always visible)
  const visibleItems = navItems.filter(item => {
    if (item.path === '/' || item.path === '/data-sync' || item.path === '/clients' || item.path === '/exchange-rates') return true;
    if (isAdmin) return true;
    const requiredPerm = ROUTE_PERMISSIONS[item.path];
    if (!requiredPerm) return true;
    if (Array.isArray(requiredPerm)) return requiredPerm.some(p => hasPermission(p));
    return hasPermission(requiredPerm);
  });

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform duration-200 lg:translate-x-0 flex flex-col",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 border-b flex items-center px-4 lg:hidden">
          <CompanyLogo size="md" />
        </div>

        <ScrollArea className="flex-1">
          <nav className="p-4 space-y-1">
            {visibleItems.map(item => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )
                }
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </ScrollArea>
      </aside>
    </>
  );
}
