// NEXOR ERP - Modern Top Navigation
import { useState, useEffect, useCallback } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Branch, User } from '@/types/erp';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { navigateThenStartPurchaseCreate, resolveAppPathname } from '@/lib/nexorPurchaseCreate';
import { getInvoicesWorkspaceTab, NEXOR_INVOICES_NEW, NEXOR_INVOICES_NEW_RECEIPT } from '@/lib/invoicesWorkspace';
import { NEXOR_POS_NEW_SALE_NAV_STATE } from '@/lib/nexorPosNewSale';
import { dispatchToolbarEvent, NEXOR_TOOLBAR, NEXOR_SUPPLIERS_NEW } from '@/lib/nexorToolbarEvents';
import { NEXOR_TOOLBAR_BTN } from '@/lib/nexorToolbarStyles';
import { 
  Building2, User as UserIcon, LogOut, Settings, Menu,
  LayoutDashboard, ShoppingCart, FileText, Package,
  BarChart3, ArrowRightLeft, Calendar, Upload, Truck, PackagePlus, PackageMinus,
  ClipboardList, Tags, FileCheck, ChevronDown, Search,
  Plus, Pencil, Trash2, Filter, Download, FileSpreadsheet,
  RefreshCw, Save, Printer, X, Info, HelpCircle,
  Database, Calculator, Receipt, Factory, Import, UserCog,
  FolderOpen, BookOpen, Landmark, CreditCard, DollarSign,
  Shield, Wallet, PieChart, TrendingUp, Globe, Keyboard,
  Monitor, Bell, ListTodo, ClipboardCheck, CalendarCheck,
  ArrowDownCircle, ArrowUpCircle,
  type LucideIcon,
} from 'lucide-react';
import { ensureDayTodos, todayKey } from '@/lib/dailyTodos';
import { useTranslation } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ServerConnectionIndicator } from '@/components/layout/ServerConnectionIndicator';
import { OfflineModeBanner } from '@/components/layout/OfflineModeBanner';
import { SyncPendingBadge } from '@/components/layout/SyncPendingBadge';
import { GlobalSearch } from '@/components/layout/GlobalSearch';
import { CalculatorDialog } from '@/components/utilities/CalculatorDialog';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { userHasPermission } from '@/lib/permissions';
import { canAccessRoute } from '@/lib/routePermissions';
import { useBranchScope } from '@/hooks/useBranchScope';
import { formatBranchDisplayName } from '@/lib/branchDisplay';
import { BranchScopeSelectItems } from '@/components/BranchScopeSelectItems';
import { resolveBranchScopeDisplayLabel } from '@/lib/branchScopeDisplay';
import { toast } from 'sonner';
import defaultLogo from '/favicon.png?url';

interface TopNavProps {
  user: User | null;
  branches: Branch[];
  currentBranch: Branch | null;
  onBranchChange: (branch: Branch) => void;
  onLogout: () => void;
}

/** Stable ids for the row-3 action toolbar (matches handler switch). */
type ToolbarActionKey =
  | 'all'
  | 'new'
  | 'delete'
  | 'edit'
  | 'transfer'
  | 'adjustEntry'
  | 'adjustExit'
  | 'minQty'
  | 'countSheet'
  | 'reconcile'
  | 'import'
  | 'labels'
  | 'adjustStock'
  | 'salesInvoice'
  | 'receipt'
  | 'payment'
  | 'purchaseInvoice'
  | 'journalEntry'
  | 'print'
  | 'agtSend'
  | 'newSale'
  | 'save'
  | 'void';

type ToolbarButtonConfig = {
  actionKey: ToolbarActionKey;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
};

/**
 * Resolves the permission required for a toolbar action. Context-sensitive
 * actions (new/edit) depend on the current module. Returns null for actions
 * that everyone with page access may use (list/all, view-only filters, print
 * helpers) and for delete (kept open by the QA delete override).
 */
function toolbarActionPermission(actionKey: ToolbarActionKey, path: string): string | null {
  const has = (seg: string) => path === seg || path.startsWith(`${seg}/`);
  const isInventory = has('/inventory');
  const isInvoices = has('/invoices');
  const isPurchase = has('/purchase-invoices') || has('/purchase-orders');
  const isProforma = path.includes('proforma');
  const isChartOfAccounts = path.includes('chart-of-accounts');

  switch (actionKey) {
    // Always available with page access (or governed by the QA delete override).
    case 'all':
    case 'delete':
    case 'minQty':
    case 'countSheet':
    case 'labels':
      return null;

    case 'new':
      if (isInventory) return 'inventory_create';
      if (isInvoices) return 'invoice_create';
      if (isPurchase) return 'purchase_create';
      if (isProforma) return 'proforma_create';
      return null; // e.g. suppliers — no dedicated permission defined
    case 'edit':
      if (isInventory) return 'inventory_edit';
      if (isChartOfAccounts) return 'accounting_create';
      if (isPurchase) return 'purchase_create';
      if (isInvoices) return 'invoice_create';
      return null;

    case 'transfer':
      return 'inventory_transfer';
    case 'adjustEntry':
    case 'adjustExit':
    case 'adjustStock':
    case 'reconcile':
      return 'inventory_adjust';
    case 'import':
      return 'inventory_import';

    case 'newSale':
    case 'save':
      return 'pos_access';
    case 'void':
      return 'pos_void';
    case 'print':
      return 'invoice_print';
    case 'agtSend':
      return 'agt_send';

    case 'salesInvoice':
      return 'invoice_create';
    case 'receipt':
      return 'receipt_create';
    case 'payment':
      return 'accounting_payment';
    case 'purchaseInvoice':
      return 'purchase_create';
    case 'journalEntry':
      return 'accounting_journal';

    default:
      return null;
  }
}

export function TopNav({ user, branches, currentBranch, onBranchChange, onLogout }: TopNavProps) {
  const { t } = useTranslation();
  const { canSwitchBranch, scopeId, setOperatingScope } = useBranchScope();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const { logo, companyName } = useCompanyLogo();
  // Authoritative permission check based on the logged-in user's role (the prop),
  // not a localStorage lookup which can be stale after a user switch.
  const canDo = useCallback(
    (permissionId: string) => !!user && userHasPermission(user.role, user.permissionOverrides, permissionId),
    [user],
  );

  const showDailyChecklist = user?.role !== 'cashier';

  const openDailyTodos = useCallback(() => {
    if (!showDailyChecklist) return;
    ensureDayTodos(todayKey());
    window.dispatchEvent(new CustomEvent('nexor:show-daily-todos'));
  }, [showDailyChecklist]);

  // ========== MENU BAR ==========
  const menuItems = [
    {
      label: t.topNav.menus.file,
      items: [
        { label: t.topNav.file.open, icon: FolderOpen, path: '/invoices' },
        { label: t.topNav.file.save, icon: Save, action: () => dispatchToolbarEvent(NEXOR_TOOLBAR.EDIT) },
        { label: t.topNav.file.print, icon: Printer, action: () => dispatchToolbarEvent(NEXOR_TOOLBAR.DOCUMENTS_PRINT) },
        { label: 'separator' },
        { label: t.topNav.file.backup, icon: Database, path: '/settings' },
        { label: 'separator' },
        { label: t.topNav.file.exit, icon: LogOut, action: onLogout },
      ],
    },
    {
      label: t.topNav.menus.company,
      items: [
        { label: t.topNav.company.branches, icon: Building2, path: '/branches' },
        { label: t.topNav.company.users, icon: UserCog, path: '/users' },
        { label: t.topNav.company.settings, icon: Settings, path: '/settings' },
      ],
    },
    {
      label: t.topNav.menus.invoicing,
      items: [
        { label: t.topNav.invoicing.pos, icon: ShoppingCart, path: '/pos' },
        { label: t.topNav.invoicing.salesHistory, icon: Receipt, path: '/vendas' },
        { label: t.topNav.invoicing.invoices, icon: FileText, path: '/invoices' },
        { label: t.topNav.invoicing.proforma, icon: ClipboardList, path: '/proforma' },
        { label: t.topNav.invoicing.salesOrders, icon: ClipboardList, path: '/sales-orders' },
        { label: t.topNav.invoicing.fiscalDocuments, icon: FileCheck, path: '/fiscal-documents' },
        { label: 'separator' },
        { label: t.topNav.invoicing.creditNote, icon: CreditCard, path: '/fiscal-documents', state: { openCreditNoteCreate: true } },
        { label: t.topNav.invoicing.debitNote, icon: DollarSign, path: '/fiscal-documents', state: { openDebitNoteCreate: true } },
      ],
    },
    {
      label: t.topNav.menus.accounting,
      items: [
        { label: t.topNav.accounting.receipt, icon: Receipt, path: '/payments', state: { openReceipt: true } },
        { label: t.topNav.accounting.receiveMethod, icon: Wallet, path: '/payments' },
        { label: t.topNav.accounting.creditAmount, icon: CreditCard, path: '/payments' },
        { label: 'separator' },
        { label: t.topNav.accounting.receivables, icon: ArrowDownCircle, path: '/receivables' },
        { label: t.topNav.accounting.payables, icon: ArrowUpCircle, path: '/payables' },
        { label: 'separator' },
        { label: t.topNav.accounting.payment, icon: DollarSign, path: '/expenses' },
        { label: t.topNav.accounting.chequePayment, icon: FileText, path: '/payments' },
        { label: 'separator' },
        { label: t.topNav.accounting.multiCredit, icon: Plus, path: '/journals' },
        { label: t.topNav.accounting.multiDebit, icon: Plus, path: '/journals' },
        { label: t.topNav.accounting.journalEntry, icon: BookOpen, path: '/chart-of-accounts' },
        { label: t.nav.accountingPeriods, icon: CalendarCheck, path: '/accounting-periods' },
      ],
    },
    {
      label: t.topNav.menus.transactions,
      items: [
        { label: t.topNav.transactions.stockTransfer, icon: ArrowRightLeft, path: '/stock-transfer' },
        { label: t.topNav.transactions.inventoryAdjustment, icon: RefreshCw, path: '/inventory' },
        { label: t.topNav.transactions.purchaseReturn, icon: Truck, path: '/purchase-invoices', state: { openReturns: true } },
      ],
    },
    {
      label: t.topNav.menus.reports,
      items: [
        { label: t.topNav.reports.trialBalance, icon: PieChart, path: '/reports', state: { reportsTab: 'trial-balance' } },
        { label: t.topNav.reports.incomeStatement, icon: TrendingUp, path: '/reports', state: { reportsTab: 'income-statement' } },
        { label: t.topNav.reports.balanceSheet, icon: BarChart3, path: '/reports', state: { reportsTab: 'balance-sheet' } },
        { label: 'separator' },
        { label: t.topNav.reports.dailyReports, icon: Calendar, path: '/daily-reports' },
        { label: t.topNav.reports.accountStatement, icon: FileText, path: '/reports', state: { reportsTab: 'client-statement' } },
        { label: 'separator' },
        { label: t.topNav.reports.stockMovement, icon: ArrowRightLeft, path: '/reports', state: { reportsTab: 'stock-movements' } },
        { label: t.topNav.reports.stockValuation, icon: DollarSign, path: '/reports', state: { reportsTab: 'stock-valuation' } },
        { label: t.topNav.reports.stockByBranch, icon: Building2, path: '/reports', state: { reportsTab: 'stock-valuation' } },
        { label: 'separator' },
        { label: t.topNav.reports.auditTrail, icon: Shield, path: '/audit-trail' },
      ],
    },
    {
      label: t.topNav.menus.utilities,
      items: [
        { label: t.topNav.utilities.changePassword, icon: Shield, path: '/settings', state: { focus: 'password' } },
        { label: t.topNav.utilities.maintenance, icon: Settings, path: '/settings' },
        { label: t.topNav.utilities.calculator, icon: Calculator, action: () => setCalculatorOpen(true) },
        ...(showDailyChecklist
          ? [{ label: t.topNav.utilities.dailyChecklist, icon: ListTodo, action: openDailyTodos }]
          : []),
        { label: 'separator' },
        { label: t.topNav.utilities.sync, icon: Upload, path: '/data-sync' },
      ],
    },
    {
      label: t.topNav.menus.help,
      items: [
        { label: t.topNav.help.about, icon: Info, action: () => toast.info(`${companyName} — NEXOR ERP`) },
        { label: t.topNav.help.help, icon: HelpCircle, path: '/settings' },
      ],
    },
  ];

  // ========== MAIN TABS ==========
  const mainTabs = [
    { label: t.nav.pos, path: '/pos', icon: ShoppingCart },
    { label: t.nav.dashboard, path: '/', icon: LayoutDashboard },
    { label: t.nav.chartOfAccounts, path: '/chart-of-accounts', icon: BookOpen },
    { label: t.nav.inventory, path: '/inventory', icon: Package },
    { label: t.nav.suppliers, path: '/suppliers', icon: Truck },
    { label: t.nav.journals, path: '/journals', icon: Calendar },
    { label: t.nav.invoices, path: '/invoices', icon: FileText },
    { label: t.nav.fiscalDocuments, path: '/fiscal-documents', icon: FileCheck },
  ];

  // Hide nav the current user can't access (role + per-user overrides). Items
  // without a path (Save, Print, Calculator, Logout, About…) are always kept.
  const canVisit = (path?: string) =>
    !path || canAccessRoute(user?.role, user?.permissionOverrides, path);
  // Cashiers land on /pos, so the Dashboard tab (which would just redirect there) is hidden for them.
  const visibleMainTabs = mainTabs.filter(
    (tab) => canVisit(tab.path) && !(tab.path === '/' && user?.role === 'cashier'),
  );
  const visibleMenus = menuItems
    .map((menu) => {
      const kept = menu.items.filter((item) => {
        if (item.label === 'separator') return true;
        if ('path' in item && typeof item.path === 'string') return canVisit(item.path);
        return true;
      });
      // Drop leading/duplicate/trailing separators left after filtering.
      const cleaned = kept.filter((item, i) => {
        if (item.label !== 'separator') return true;
        const prev = kept[i - 1];
        if (!prev || prev.label === 'separator') return false;
        return kept.slice(i + 1).some((x) => x.label !== 'separator');
      });
      return { ...menu, items: cleaned };
    })
    .filter((menu) => menu.items.some((item) => item.label !== 'separator'));

  // ========== ACTION TOOLBAR ==========
  const handleToolbarNew = useCallback(() => {
    const p = resolveAppPathname(location.pathname);
    // Exact segment matching — avoid `includes('stock')` matching /stock-transfer, etc.
    if (p === '/purchase-invoices' || p.startsWith('/purchase-invoices/')) {
      navigateThenStartPurchaseCreate(navigate, location.pathname);
      return;
    }
    if (p === '/purchase-orders' || p.startsWith('/purchase-orders/')) {
      window.dispatchEvent(new CustomEvent('nexor:purchase-orders-new'));
      return;
    }
    if (p === '/suppliers' || p.startsWith('/suppliers/')) {
      window.dispatchEvent(new CustomEvent(NEXOR_SUPPLIERS_NEW));
      navigate('/suppliers', { state: { nexorToolbarNewSupplier: true } });
      return;
    }
    if (p === '/inventory' || p.startsWith('/inventory/')) {
      navigate('/inventory', { state: { nexorToolbarNewProduct: true } });
      return;
    }
    if (p === '/invoices' || p.startsWith('/invoices/')) {
      window.dispatchEvent(
        new CustomEvent(NEXOR_INVOICES_NEW, { detail: { tab: getInvoicesWorkspaceTab() } }),
      );
      return;
    }
    if (p === '/vendas' || p.startsWith('/vendas/')) {
      navigate('/pos', { state: NEXOR_POS_NEW_SALE_NAV_STATE });
      return;
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    const onToolbarNew = () => handleToolbarNew();
    window.addEventListener(NEXOR_TOOLBAR.NEW, onToolbarNew);
    return () => window.removeEventListener(NEXOR_TOOLBAR.NEW, onToolbarNew);
  }, [handleToolbarNew]);

  const handleToolbarClick = useCallback(
    (actionKey: ToolbarActionKey) => {
      const path = resolveAppPathname(location.pathname);
      switch (actionKey) {
        case 'new':
          handleToolbarNew();
          return;
        case 'purchaseInvoice':
          navigate('/purchase-orders');
          return;
        case 'journalEntry':
          navigate('/journals');
          return;
        case 'salesInvoice':
          navigate('/invoices');
          window.setTimeout(
            () => window.dispatchEvent(
              new CustomEvent(NEXOR_INVOICES_NEW, { detail: { tab: 'fatura_venda' } }),
            ),
            150,
          );
          return;
        case 'receipt':
          navigate('/payments', { state: { openReceipt: true } });
          return;
        case 'payment':
          navigate('/payments');
          return;
        case 'newSale':
          if (path === '/pos' || path.startsWith('/pos/')) {
            navigate(
              { pathname: location.pathname, search: location.search, hash: location.hash },
              { state: NEXOR_POS_NEW_SALE_NAV_STATE },
            );
          } else {
            navigate('/pos', { state: NEXOR_POS_NEW_SALE_NAV_STATE });
          }
          return;
        case 'all': {
          const path = resolveAppPathname(location.pathname);
          dispatchToolbarEvent(NEXOR_TOOLBAR.ALL);
          if (path === '/purchase-invoices/new' || path.endsWith('/new')) {
            navigate(path.replace(/\/new\/?$/, '') || '/purchase-invoices', { replace: true });
          }
          return;
        }
        case 'delete':
          dispatchToolbarEvent(NEXOR_TOOLBAR.DELETE);
          return;
        case 'edit':
          dispatchToolbarEvent(NEXOR_TOOLBAR.EDIT);
          return;
        case 'transfer':
          navigate('/stock-transfer');
          return;
        case 'adjustEntry':
          dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_ENTRY);
          return;
        case 'adjustExit':
          dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_ADJUST_EXIT);
          return;
        case 'minQty':
          dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_MIN_QTY);
          return;
        case 'countSheet':
          if (path === '/inventory' || path.startsWith('/inventory/')) {
            dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_COUNT_SHEET);
          } else {
            navigate('/inventory', { state: { openCountSheet: true } });
          }
          return;
        case 'reconcile':
          if (path === '/inventory' || path.startsWith('/inventory/')) {
            dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_RECONCILE);
          } else {
            navigate('/inventory', { state: { openReconcile: true } });
          }
          return;
        case 'import':
          if (path === '/inventory' || path.startsWith('/inventory/')) {
            dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_IMPORT);
          } else {
            navigate('/inventory');
            window.setTimeout(() => dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_IMPORT), 150);
          }
          return;
        case 'labels':
          if (path === '/inventory' || path.startsWith('/inventory/')) {
            dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_LABELS);
          } else {
            navigate('/inventory');
            window.setTimeout(() => dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_LABELS), 150);
          }
          return;
        case 'adjustStock':
          if (path === '/inventory' || path.startsWith('/inventory/')) {
            dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_ADJUST_STOCK);
          } else {
            navigate('/inventory');
            window.setTimeout(() => dispatchToolbarEvent(NEXOR_TOOLBAR.INVENTORY_ADJUST_STOCK), 150);
          }
          return;
        case 'print':
          dispatchToolbarEvent(NEXOR_TOOLBAR.DOCUMENTS_PRINT);
          return;
        case 'agtSend':
          navigate('/fiscal-documents', { state: { openSaft: true } });
          return;
        case 'save':
          dispatchToolbarEvent(NEXOR_TOOLBAR.POS_CHECKOUT);
          return;
        case 'void':
          dispatchToolbarEvent(NEXOR_TOOLBAR.POS_VOID);
          return;
        default:
          return;
      }
    },
    [handleToolbarNew, navigate, location.pathname, location.search, location.hash],
  );

  const getActionButtons = (): ToolbarButtonConfig[] => {
    const p = resolveAppPathname(location.pathname);
    if (p === '/' || p === '') return [];

    const base: ToolbarButtonConfig[] = [
      { actionKey: 'all', label: t.topNav.toolbar.all, icon: FolderOpen },
      { actionKey: 'new', label: t.topNav.toolbar.new, icon: Plus },
      { actionKey: 'delete', label: t.topNav.toolbar.delete, icon: Trash2 },
      { actionKey: 'edit', label: t.topNav.toolbar.edit, icon: Pencil },
    ];

    // Before `includes('invoices')` — `/purchase-invoices` matches that substring and would get the wrong toolbar.
    if (p === '/purchase-invoices' || p.startsWith('/purchase-invoices/')) {
      return base;
    }
    if (p === '/purchase-orders' || p.startsWith('/purchase-orders/')) {
      return base;
    }
    if (p === '/suppliers' || p.startsWith('/suppliers/')) {
      return base;
    }

    if (p === '/inventory' || p.startsWith('/inventory/')) {
      return [
        ...base,
        { actionKey: 'transfer', label: t.topNav.toolbar.transfer, icon: ArrowRightLeft },
        { actionKey: 'adjustEntry', label: t.topNav.toolbar.adjustEntry, icon: PackagePlus },
        { actionKey: 'adjustExit', label: t.topNav.toolbar.adjustExit, icon: PackageMinus },
        { actionKey: 'minQty', label: t.topNav.toolbar.minQty, icon: Filter },
        { actionKey: 'countSheet', label: t.topNav.toolbar.countSheet, icon: ClipboardList },
        { actionKey: 'reconcile', label: t.topNav.toolbar.reconcile, icon: ClipboardCheck },
        { actionKey: 'import', label: t.topNav.toolbar.import, icon: Import },
        { actionKey: 'labels', label: t.topNav.toolbar.labels, icon: Printer },
        { actionKey: 'adjustStock', label: t.topNav.toolbar.adjustStock, icon: Calculator },
      ];
    }
    if (p === '/stock-transfer' || p.startsWith('/stock-transfer/')) {
      return [
        ...base,
        { actionKey: 'transfer', label: t.topNav.toolbar.transfer, icon: ArrowRightLeft },
      ];
    }
    if (p.includes('chart-of-accounts')) {
      return [
        { actionKey: 'all', label: t.topNav.toolbar.all, icon: FolderOpen },
        { actionKey: 'delete', label: t.topNav.toolbar.delete, icon: Trash2 },
        { actionKey: 'edit', label: t.topNav.toolbar.edit, icon: Pencil },
        { actionKey: 'salesInvoice', label: t.topNav.toolbar.salesInvoice, icon: FileText },
        { actionKey: 'receipt', label: t.topNav.toolbar.receipt, icon: Receipt },
        { actionKey: 'payment', label: t.topNav.toolbar.payment, icon: DollarSign },
        { actionKey: 'purchaseInvoice', label: t.topNav.toolbar.purchaseInvoice, icon: Truck },
        { actionKey: 'journalEntry', label: t.topNav.toolbar.journalEntry, icon: BookOpen },
      ];
    }
    if (p === '/invoices' || p.startsWith('/invoices/')) {
      return [
        { actionKey: 'all', label: t.topNav.toolbar.all, icon: FolderOpen },
        { actionKey: 'new', label: t.topNav.toolbar.new, icon: Plus },
        { actionKey: 'print', label: t.topNav.file.print, icon: Printer },
        { actionKey: 'agtSend', label: t.topNav.toolbar.agtSend, icon: Upload },
      ];
    }
    if (p.includes('fiscal') || p.includes('proforma')) {
      return [
        ...base,
        { actionKey: 'print', label: t.topNav.file.print, icon: Printer },
        { actionKey: 'agtSend', label: t.topNav.toolbar.agtSend, icon: Upload },
      ];
    }
    if (p === '/vendas' || p.startsWith('/vendas/')) {
      return [
        { actionKey: 'newSale', label: t.topNav.toolbar.newSale, icon: Plus },
        { actionKey: 'save', label: t.topNav.toolbar.save, icon: Save },
        { actionKey: 'void', label: t.topNav.toolbar.void, icon: X },
      ];
    }
    if (p.includes('pos')) {
      return [
        { actionKey: 'newSale', label: t.topNav.toolbar.newSale, icon: Plus },
        { actionKey: 'save', label: t.topNav.toolbar.save, icon: Save },
        { actionKey: 'void', label: t.topNav.toolbar.void, icon: X },
      ];
    }
    return base;
  };

  // Grey out any toolbar action the logged-in role lacks permission for, so the
  // block happens up front instead of after the user fills in a form.
  const toolbarPath = resolveAppPathname(location.pathname);
  const actionButtons = getActionButtons().map((btn) => {
    const perm = toolbarActionPermission(btn.actionKey, toolbarPath);
    if (!perm || canDo(perm)) return btn;
    return { ...btn, disabled: true };
  });

  return (
    <header className="sticky top-0 z-50">
      <OfflineModeBanner />
      {/* ====== ROW 1: Menu Bar ====== */}
      <div className="h-10 px-3 bg-sidebar text-sidebar-foreground hidden lg:flex items-center justify-between border-b border-sidebar-border shadow-sm">
        <div className="flex items-center gap-1">
          {/* Logo */}
          <div className="flex items-center gap-2 pr-4 mr-2 border-r border-sidebar-border">
            <div className="w-6 h-6 rounded-lg overflow-hidden bg-sidebar-accent flex items-center justify-center">
              <img src={logo || defaultLogo} alt={companyName} className="w-full h-full object-contain" />
            </div>
            <span className="font-bold text-sm tracking-tight text-sidebar-primary">
              {companyName}
            </span>
          </div>

          {visibleMenus.map((menu) => (
            <DropdownMenu key={menu.label}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs font-medium text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent rounded-md">
                  {menu.label}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] animate-scale-in">
                {menu.items.map((item, idx) =>
                  item.label === 'separator' ? (
                    <DropdownMenuSeparator key={idx} />
                  ) : (
                    <DropdownMenuItem
                      key={item.label}
                      onClick={() => {
                        if ('action' in item && typeof item.action === 'function') item.action();
                        else if ('path' in item && typeof item.path === 'string') {
                          const navState = 'state' in item ? (item as { state?: object }).state : undefined;
                          navigate(item.path, navState ? { state: navState } : undefined);
                        }
                      }}
                      className="text-xs gap-2"
                    >
                      {item.icon && <item.icon className="w-3.5 h-3.5 text-muted-foreground" />}
                      {item.label}
                    </DropdownMenuItem>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ServerConnectionIndicator />
          <SyncPendingBadge />
          <GlobalSearch />
          {showDailyChecklist && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={openDailyTodos}
              title={t.topNav.utilities.dailyChecklist}
              aria-label={t.topNav.utilities.dailyChecklist}
            >
              <ListTodo className="w-4 h-4" />
            </Button>
          )}
          <LanguageSwitcher />

          {canSwitchBranch ? (
            <Select value={scopeId} onValueChange={setOperatingScope}>
              <SelectTrigger className="h-7 w-[140px] text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground">
                <Building2 className="w-3.5 h-3.5 mr-1.5 text-sidebar-primary" />
                <SelectValue placeholder={t.topNav.toolbar.branchPlaceholder}>
                  {resolveBranchScopeDisplayLabel(canSwitchBranch, scopeId, currentBranch, t.branchUi.allBranches)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <BranchScopeSelectItems branches={branches} compact />
              </SelectContent>
            </Select>
          ) : currentBranch ? (
            <div className="hidden sm:flex h-7 max-w-[140px] items-center gap-1.5 truncate rounded-md border border-sidebar-border bg-sidebar-accent px-2 text-xs text-sidebar-foreground">
              <Building2 className="w-3.5 h-3.5 shrink-0 text-sidebar-primary" />
              <span className="truncate">{formatBranchDisplayName(currentBranch)}</span>
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent">
                <div className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-[10px] font-semibold">
                  {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                </div>
                <span className="hidden xl:inline">{user?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 animate-scale-in">
              <div className="px-3 py-2 border-b">
                <p className="font-semibold text-sm">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <DropdownMenuItem className="text-xs gap-2 mt-1" onClick={() => navigate('/settings')}>
                <Shield className="w-3.5 h-3.5" />
                {t.topNav.userMenu.profile}
              </DropdownMenuItem>
              <DropdownMenuItem className="text-xs gap-2" onClick={() => navigate('/settings')}>
                <Settings className="w-3.5 h-3.5" />
                {t.nav.settings}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="text-destructive text-xs gap-2">
                <LogOut className="w-3.5 h-3.5" />
                {t.nav.logout}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ====== ROW 2: Main Tabs ====== */}
      <div className="h-10 px-2 bg-card hidden lg:flex items-end gap-0.5 border-b overflow-x-auto">
        {visibleMainTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/'}
            className={({ isActive }) => cn(
              "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all relative",
              isActive
                ? "bg-background text-primary border-t-2 border-x border-t-primary border-x-border -mb-px shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </NavLink>
        ))}
        {showDailyChecklist && (
          <button
            type="button"
            onClick={openDailyTodos}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg transition-all text-muted-foreground hover:text-foreground hover:bg-muted/50 ml-0.5"
            title={t.topNav.utilities.dailyChecklist}
          >
            <ListTodo className="w-3.5 h-3.5" />
            {t.dailyTodosUi.shortTab}
          </button>
        )}
      </div>

      {/* ====== ROW 3: Action Toolbar ====== */}
      {actionButtons.length > 0 && (
        <div className="h-10 px-3 bg-background hidden lg:flex items-center gap-1.5 border-b overflow-x-auto">
          {actionButtons.filter(Boolean).map((btn, idx) => (
            <Button
              key={`${btn.actionKey}-${idx}`}
              type="button"
              variant="outline"
              size="sm"
              className={NEXOR_TOOLBAR_BTN}
              disabled={btn.disabled}
              title={
                btn.disabled
                  ? t.topNav.toolbar.noPermission
                  : btn.actionKey === 'all'
                    ? t.topNav.toolbar.allHint
                    : undefined
              }
              onClick={() => handleToolbarClick(btn.actionKey)}
            >
              <btn.icon className="w-3.5 h-3.5" />
              {btn.label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className={NEXOR_TOOLBAR_BTN}
            onClick={() => dispatchToolbarEvent(NEXOR_TOOLBAR.FILTER)}
          >
            <Filter className="w-3.5 h-3.5" />
            {t.topNav.toolbar.filter}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={NEXOR_TOOLBAR_BTN}
            onClick={() => dispatchToolbarEvent(NEXOR_TOOLBAR.EXCEL)}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {t.topNav.toolbar.excel}
          </Button>
        </div>
      )}

      {/* ====== Mobile Header ====== */}
      <div className="h-14 px-4 flex lg:hidden items-center justify-between bg-sidebar text-sidebar-foreground border-b border-sidebar-border shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-sidebar-accent flex items-center justify-center">
            <img src={logo || defaultLogo} alt={companyName} className="w-full h-full object-contain" />
          </div>
          <span className="font-bold text-sm tracking-tight">{companyName}</span>
        </div>
        <div className="flex items-center gap-2">
          {canSwitchBranch ? (
            <Select value={scopeId} onValueChange={setOperatingScope}>
              <SelectTrigger className="h-8 w-[110px] text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground">
                <Building2 className="w-3 h-3 mr-1" />
                <SelectValue>
                  {resolveBranchScopeDisplayLabel(canSwitchBranch, scopeId, currentBranch, t.branchUi.allBranches)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <BranchScopeSelectItems branches={branches} compact />
              </SelectContent>
            </Select>
          ) : currentBranch ? (
            <div className="flex h-8 max-w-[110px] items-center gap-1 truncate rounded-md border border-sidebar-border bg-sidebar-accent px-2 text-xs text-sidebar-foreground">
              <Building2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{formatBranchDisplayName(currentBranch)}</span>
            </div>
          ) : null}
          {showDailyChecklist && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground"
              onClick={openDailyTodos}
              aria-label={t.topNav.utilities.dailyChecklist}
            >
              <ListTodo className="w-5 h-5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <Menu className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <nav className="lg:hidden border-t bg-card p-3 max-h-[70vh] overflow-y-auto animate-fade-in">
          <div className="grid grid-cols-4 gap-2">
            {visibleMainTabs.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) => cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl text-[10px] font-medium transition-all",
                  isActive ? "nexor-mobile-nav-active" : "bg-slate-50 hover:bg-slate-100 text-slate-600"
                )}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </NavLink>
            ))}
          </div>
          <div className="pt-3 mt-3 border-t flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">{user?.name}</span>
            <Button variant="ghost" size="sm" onClick={onLogout} className="text-destructive text-xs h-7 gap-1">
              <LogOut className="w-3.5 h-3.5" /> Sair
            </Button>
          </div>
        </nav>
      )}

      <CalculatorDialog
        open={calculatorOpen}
        onOpenChange={setCalculatorOpen}
        title={t.topNav.utilities.calculator}
      />
    </header>
  );
}
