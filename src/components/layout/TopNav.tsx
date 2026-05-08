// NEXOR ERP - Modern Top Navigation
import { useState, useEffect } from 'react';
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
import { 
  Building2, User as UserIcon, LogOut, Settings, Menu,
  LayoutDashboard, ShoppingCart, FileText, Package, Users,
  BarChart3, ArrowRightLeft, Calendar, Upload, Truck,
  ClipboardList, Tags, FileCheck, ChevronDown, Search,
  Plus, Pencil, Trash2, Filter, Download, FileSpreadsheet,
  RefreshCw, Save, Printer, X, Info, HelpCircle,
  Database, Calculator, Receipt, Factory, Import, UserCog,
  FolderOpen, BookOpen, Landmark, CreditCard, DollarSign,
  Shield, Wallet, PieChart, TrendingUp, Globe, Keyboard,
  Monitor, Bell,
} from 'lucide-react';
import { useTranslation } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ServerConnectionIndicator } from '@/components/layout/ServerConnectionIndicator';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import defaultLogo from '/favicon.png?url';

interface TopNavProps {
  user: User | null;
  branches: Branch[];
  currentBranch: Branch | null;
  onBranchChange: (branch: Branch) => void;
  onLogout: () => void;
}

export function TopNav({ user, branches, currentBranch, onBranchChange, onLogout }: TopNavProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { logo, companyName } = useCompanyLogo();

  // ========== MENU BAR ==========
  const menuItems = [
    {
      label: t.topNav.menus.file,
      items: [
        { label: t.topNav.file.open, icon: FolderOpen },
        { label: t.topNav.file.save, icon: Save },
        { label: t.topNav.file.print, icon: Printer },
        { label: 'separator' },
        { label: t.topNav.file.backup, icon: Database },
        { label: t.topNav.file.import, icon: Download },
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
        { label: 'separator' },
        { label: t.topNav.invoicing.creditNote, icon: CreditCard, path: '/fiscal-documents' },
        { label: t.topNav.invoicing.debitNote, icon: DollarSign, path: '/fiscal-documents' },
      ],
    },
    {
      label: t.topNav.menus.accounting,
      items: [
        { label: t.topNav.accounting.receipt, icon: Receipt, path: '/invoices' },
        { label: t.topNav.accounting.receiveMethod, icon: Wallet },
        { label: t.topNav.accounting.creditAmount, icon: CreditCard },
        { label: 'separator' },
        { label: t.topNav.accounting.payment, icon: DollarSign, path: '/expenses' },
        { label: t.topNav.accounting.chequePayment, icon: FileText },
        { label: 'separator' },
        { label: t.topNav.accounting.multiCredit, icon: Plus },
        { label: t.topNav.accounting.multiDebit, icon: Plus },
        { label: t.topNav.accounting.journalEntry, icon: BookOpen, path: '/chart-of-accounts' },
      ],
    },
    {
      label: t.topNav.menus.transactions,
      items: [
        { label: t.topNav.transactions.stockTransfer, icon: ArrowRightLeft, path: '/stock-transfer' },
        { label: t.topNav.transactions.inventoryAdjustment, icon: RefreshCw, path: '/inventory' },
        { label: t.topNav.transactions.purchaseReturn, icon: Truck },
      ],
    },
    {
      label: t.topNav.menus.reports,
      items: [
        { label: t.topNav.reports.trialBalance, icon: PieChart, path: '/reports' },
        { label: t.topNav.reports.incomeStatement, icon: TrendingUp, path: '/reports' },
        { label: t.topNav.reports.balanceSheet, icon: BarChart3, path: '/reports' },
        { label: 'separator' },
        { label: t.topNav.reports.dailyReports, icon: Calendar, path: '/daily-reports' },
        { label: t.topNav.reports.accountStatement, icon: FileText, path: '/reports' },
        { label: 'separator' },
        { label: t.topNav.reports.stockMovement, icon: ArrowRightLeft, path: '/reports' },
        { label: t.topNav.reports.stockValuation, icon: DollarSign, path: '/reports' },
        { label: t.topNav.reports.stockByBranch, icon: Building2, path: '/reports' },
      ],
    },
    {
      label: t.topNav.menus.utilities,
      items: [
        { label: t.topNav.utilities.changePassword, icon: Shield },
        { label: t.topNav.utilities.maintenance, icon: Settings },
        { label: t.topNav.utilities.calculator, icon: Calculator },
        { label: 'separator' },
        { label: t.topNav.utilities.sync, icon: Upload, path: '/data-sync' },
      ],
    },
    {
      label: t.topNav.menus.help,
      items: [
        { label: t.topNav.help.about, icon: Info },
        { label: t.topNav.help.help, icon: HelpCircle },
      ],
    },
  ];

  // ========== MAIN TABS ==========
  const mainTabs = [
    { label: t.nav.dashboard, path: '/', icon: LayoutDashboard },
    { label: t.nav.chartOfAccounts, path: '/chart-of-accounts', icon: BookOpen },
    { label: t.nav.inventory, path: '/inventory', icon: Package },
    { label: t.nav.journals, path: '/journals', icon: Calendar },
    { label: t.nav.invoices, path: '/invoices', icon: FileText },
    { label: t.nav.production, path: '/production', icon: Factory },
    { label: t.common.import, path: '/import', icon: Globe },
    { label: t.nav.hr, path: '/hr', icon: Users },
  ];

  // ========== ACTION TOOLBAR ==========
  const getButtonVariant = (variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | 'modern' | 'modern-outline') => variant ?? 'outline';

  const getActionButtons = () => {
    const p = location.pathname;
    if (p === '/' || p === '') return [];

    const base = [
      { label: t.topNav.toolbar.all, icon: FolderOpen, variant: 'outline' as const },
      { label: t.topNav.toolbar.new, icon: Plus, variant: 'default' as const },
      { label: t.topNav.toolbar.delete, icon: Trash2, variant: 'destructive' as const },
      { label: t.topNav.toolbar.edit, icon: Pencil, variant: 'outline' as const },
    ];

    if (p.includes('inventory') || p.includes('stock')) {
      return [
        ...base,
        { label: t.topNav.toolbar.transfer, icon: ArrowRightLeft, variant: 'outline' as const },
        { label: t.topNav.toolbar.adjustExit, icon: RefreshCw, variant: 'outline' as const },
        { label: t.topNav.toolbar.inventoryEntry, icon: Download, variant: 'outline' as const },
        { label: t.topNav.toolbar.minQty, icon: Filter, variant: 'outline' as const },
      ];
    }
    if (p.includes('chart-of-accounts')) {
      return [
        ...base,
        { label: t.topNav.toolbar.salesInvoice, icon: FileText, variant: 'outline' as const },
        { label: t.topNav.toolbar.receipt, icon: Receipt, variant: 'outline' as const },
        { label: t.topNav.toolbar.payment, icon: DollarSign, variant: 'outline' as const },
        { label: t.topNav.toolbar.purchaseInvoice, icon: Truck, variant: 'outline' as const },
        { label: t.topNav.toolbar.journalEntry, icon: BookOpen, variant: 'outline' as const },
      ];
    }
    if (p.includes('invoices') || p.includes('fiscal') || p.includes('proforma')) {
      return [
        ...base,
        { label: t.topNav.file.print, icon: Printer, variant: 'outline' as const },
        { label: t.topNav.toolbar.agtSend, icon: Upload, variant: 'outline' as const },
      ];
    }
    if (p.includes('pos')) {
      return [
        { label: t.topNav.toolbar.newSale, icon: Plus, variant: 'default' as const },
        { label: t.topNav.toolbar.save, icon: Save, variant: 'outline' as const },
        { label: t.topNav.toolbar.void, icon: X, variant: 'destructive' as const },
      ];
    }
    return base;
  };

  const actionButtons = getActionButtons();

  return (
    <header className="sticky top-0 z-50">
      {/* ====== ROW 1: Menu Bar ====== */}
      <div className="h-10 px-3 bg-sidebar text-sidebar-foreground hidden lg:flex items-center justify-between">
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

          {menuItems.map((menu) => (
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
                        else if ('path' in item && typeof item.path === 'string') navigate(item.path);
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
          <LanguageSwitcher />

          <Select
            value={currentBranch?.id}
            onValueChange={(id) => {
              const branch = branches.find(b => b.id === id);
              if (branch) onBranchChange(branch);
            }}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground">
              <Building2 className="w-3.5 h-3.5 mr-1.5 text-sidebar-primary" />
              <SelectValue placeholder={t.topNav.toolbar.branchPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {branches.map(branch => (
                <SelectItem key={branch.id} value={branch.id} className="text-xs">
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1.5 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent">
                <div className="w-6 h-6 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-[10px] font-bold">
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
              <DropdownMenuItem className="text-xs gap-2 mt-1">
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
        {mainTabs.map((tab) => (
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
      </div>

      {/* ====== ROW 3: Action Toolbar ====== */}
      {actionButtons.length > 0 && (
        <div className="h-10 px-3 bg-background hidden lg:flex items-center gap-1.5 border-b overflow-x-auto">
          {actionButtons.filter(Boolean).map((btn, idx) => (
            <Button key={idx} variant={getButtonVariant(btn?.variant)} size="sm" className="h-7 text-xs gap-1.5 px-3 rounded-lg">
              <btn.icon className="w-3.5 h-3.5" />
              {btn.label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 px-3 rounded-lg">
            <Filter className="w-3.5 h-3.5" />
            {t.topNav.toolbar.filter}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 px-3 rounded-lg">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {t.topNav.toolbar.excel}
          </Button>
        </div>
      )}

      {/* ====== Mobile Header ====== */}
      <div className="h-14 px-4 flex lg:hidden items-center justify-between bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-sidebar-accent flex items-center justify-center">
            <img src={logo || defaultLogo} alt={companyName} className="w-full h-full object-contain" />
          </div>
          <span className="font-bold text-sm tracking-tight">{companyName}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={currentBranch?.id}
            onValueChange={(id) => {
              const branch = branches.find(b => b.id === id);
              if (branch) onBranchChange(branch);
            }}
          >
            <SelectTrigger className="h-8 w-[110px] text-xs bg-sidebar-accent border-sidebar-border text-sidebar-foreground">
              <Building2 className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branches.map(branch => (
                <SelectItem key={branch.id} value={branch.id} className="text-xs">
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <Menu className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <nav className="lg:hidden border-t bg-card p-3 max-h-[70vh] overflow-y-auto animate-fade-in">
          <div className="grid grid-cols-4 gap-2">
            {mainTabs.map((tab) => (
              <NavLink
                key={tab.path}
                to={tab.path}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) => cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl text-[10px] font-medium transition-all",
                  isActive ? "gradient-primary text-primary-foreground shadow-glow" : "bg-muted hover:bg-accent"
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
    </header>
  );
}
