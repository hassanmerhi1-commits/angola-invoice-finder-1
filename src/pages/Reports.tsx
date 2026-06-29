import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useSales, useProducts } from '@/hooks/useERP';
import { api } from '@/lib/api/client';
import { exportToExcel } from '@/lib/excel';
import { format, startOfMonth } from 'date-fns';
import {
  BarChart3, Users, Truck, TrendingUp, Calendar,
  FileText, Download, DollarSign, Check, ChevronDown,
  Package, PieChart, ArrowUpRight, ShoppingCart,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import SalesAnalysisReport from '@/components/reports/SalesAnalysisReport';
import ProfitabilityReport from '@/components/reports/ProfitabilityReport';
import PurchasesAnalysisReport from '@/components/reports/PurchasesAnalysisReport';
import InventoryReports from '@/components/reports/InventoryReports';
import StatisticsReports from '@/components/reports/StatisticsReports';
import MonthlyReport from '@/components/reports/MonthlyReport';
import FinancialReports from '@/components/reports/FinancialReports';
import StatementsReports from '@/components/reports/StatementsReports';

interface DashboardKPIs {
  monthSales: { count: number; total: number };
  openAR: { count: number; total: number };
  openAP: { count: number; total: number };
}

type FamilyTarget = { family: string; sub?: string };

const FAMILY_TABS = new Set([
  'overview',
  'sales',
  'purchases',
  'profit',
  'inventory',
  'statistics',
  'monthly',
  'financial',
  'statements',
]);

// Maps legacy / deep-link tab ids and overview category ids to the new
// family + sub-tab structure so existing navigation keeps working.
const TAB_TARGETS: Record<string, FamilyTarget> = {
  overview: { family: 'overview' },
  sales: { family: 'sales' },
  'daily-detail': { family: 'sales' },
  purchases: { family: 'purchases' },
  profitability: { family: 'profit' },
  'stock-valuation': { family: 'inventory', sub: 'valuation' },
  'stock-movements': { family: 'inventory', sub: 'movements' },
  'top-customers': { family: 'statistics', sub: 'top-customers' },
  'trial-balance': { family: 'financial', sub: 'trial-balance' },
  'income-statement': { family: 'financial', sub: 'income-statement' },
  'balance-sheet': { family: 'financial', sub: 'balance-sheet' },
  vat: { family: 'financial', sub: 'vat' },
  'cash-flow': { family: 'financial', sub: 'cash-flow' },
  'client-statement': { family: 'statements', sub: 'client-statement' },
  'supplier-statement': { family: 'statements', sub: 'supplier-statement' },
  receivables: { family: 'statements', sub: 'receivables' },
  payables: { family: 'statements', sub: 'payables' },
  'transaction-history': { family: 'statements', sub: 'transactions' },
  // Overview category ids
  clients: { family: 'statements', sub: 'client-statement' },
  suppliers: { family: 'statements', sub: 'supplier-statement' },
  inventory: { family: 'inventory', sub: 'valuation' },
  financial: { family: 'financial', sub: 'trial-balance' },
};

function resolveReportsTab(value: string | undefined): FamilyTarget | null {
  if (!value) return null;
  if (FAMILY_TABS.has(value)) return { family: value };
  return TAB_TARGETS[value] ?? null;
}

export default function Reports() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('overview');
  const [views, setViews] = useState<Record<string, string>>({
    sales: 'summary',
    purchases: 'summary',
    profit: 'summary',
    inventory: 'valuation',
    statistics: 'top-customers',
    financial: 'trial-balance',
    statements: 'client-statement',
  });
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const { apiBranchId } = useBranchScope();
  const { sales } = useSales(apiBranchId);
  const { products } = useProducts(apiBranchId);

  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);

  const goToTarget = (target: FamilyTarget) => {
    setActiveTab(target.family);
    if (target.sub) setViews((prev) => ({ ...prev, [target.family]: target.sub! }));
  };

  const setView = (family: string, value: string) =>
    setViews((prev) => ({ ...prev, [family]: value }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.dashboard.kpis(apiBranchId);
        if (!cancelled && result.data) setKpis(result.data as DashboardKPIs);
      } catch {
        /* API not available — leave null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBranchId]);

  useEffect(() => {
    const stateTab = (location.state as { reportsTab?: string } | null)?.reportsTab;
    const queryTab = new URLSearchParams(location.search).get('tab') ?? undefined;
    const target = resolveReportsTab(stateTab || queryTab || undefined);
    if (target) goToTarget(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, location.search]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: 'AOA', minimumFractionDigits: 0 }).format(value);

  // Average margin for the current month from completed sales and product costs.
  const avgMargin = useMemo(() => {
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const costMap = new Map(products.map((p) => [p.id, p.avgCost || p.cost || 0]));
    let base = 0;
    let cost = 0;
    sales
      .filter((s) => s.status === 'completed' && s.createdAt.slice(0, 10) >= monthStart)
      .forEach((s) => {
        base += Number(s.subtotal || 0);
        s.items.forEach((item) => {
          cost += (costMap.get(item.productId) || 0) * Number(item.quantity || 0);
        });
      });
    return base > 0 ? ((base - cost) / base) * 100 : 0;
  }, [sales, products]);

  const salesMonth = kpis?.monthSales?.total ?? 0;
  const receivable = kpis?.openAR?.total ?? 0;
  const payable = kpis?.openAP?.total ?? 0;

  const handleExportOverview = () => {
    exportToExcel(
      [
        {
          [t.reportsCenterUi.quickStats.salesMonth]: salesMonth,
          [t.reportsCenterUi.quickStats.receivable]: receivable,
          [t.reportsCenterUi.quickStats.payable]: payable,
          [t.reportsCenterUi.quickStats.avgMargin]: `${avgMargin.toFixed(1)}%`,
        },
      ],
      `Resumo_${format(new Date(), 'yyyyMMdd')}`,
    );
  };

  const reportCategories = [
    {
      id: 'sales',
      title: t.reportsCenterUi.categories.sales.title,
      description: t.reportsCenterUi.categories.sales.description,
      icon: TrendingUp,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      id: 'clients',
      title: t.reportsCenterUi.categories.clients.title,
      description: t.reportsCenterUi.categories.clients.description,
      icon: Users,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      id: 'suppliers',
      title: t.reportsCenterUi.categories.suppliers.title,
      description: t.reportsCenterUi.categories.suppliers.description,
      icon: Truck,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
    },
    {
      id: 'inventory',
      title: t.reportsCenterUi.categories.inventory.title,
      description: t.reportsCenterUi.categories.inventory.description,
      icon: Package,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
    {
      id: 'financial',
      title: t.reportsCenterUi.categories.financial.title,
      description: t.reportsCenterUi.categories.financial.description,
      icon: DollarSign,
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
  ];

  type FamilyDef = {
    value: string;
    label: string;
    icon: LucideIcon;
    options?: { value: string; label: string }[];
  };

  const families: FamilyDef[] = [
    { value: 'overview', label: t.reportsCenterUi.tabOverview, icon: BarChart3 },
    {
      value: 'sales',
      label: t.reportsCenterUi.tabSales,
      icon: TrendingUp,
      options: [
        { value: 'summary', label: t.salesAnalysisUi.tabSummary },
        { value: 'item', label: t.salesAnalysisUi.tabByItem },
        { value: 'category', label: t.salesAnalysisUi.tabByCategory },
        { value: 'customer', label: t.salesAnalysisUi.tabByCustomer },
        { value: 'supplier', label: t.salesAnalysisUi.tabBySupplier },
        { value: 'warehouse', label: t.salesAnalysisUi.tabByBranch },
        { value: 'user', label: t.salesAnalysisUi.tabByUser },
        { value: 'detailed', label: t.salesAnalysisUi.tabDetailed },
        { value: 'daily', label: t.reportsCenterUi.tabDailyDetail },
      ],
    },
    {
      value: 'purchases',
      label: t.reportsCenterUi.tabPurchases,
      icon: ShoppingCart,
      options: [
        { value: 'summary', label: t.purchasesReportUi.tabSummary },
        { value: 'suppliers', label: t.purchasesReportUi.bySupplier },
        { value: 'products', label: t.purchasesReportUi.byProduct },
        { value: 'categories', label: t.purchasesReportUi.byCategory },
        { value: 'months', label: t.purchasesReportUi.byMonth },
      ],
    },
    {
      value: 'profit',
      label: t.reportsCenterUi.familyProfit,
      icon: PieChart,
      options: [
        { value: 'summary', label: t.salesAnalysisUi.tabSummary },
        { value: 'item', label: t.salesAnalysisUi.tabByItem },
        { value: 'category', label: t.salesAnalysisUi.tabByCategory },
        { value: 'customer', label: t.salesAnalysisUi.tabByCustomer },
        { value: 'supplier', label: t.salesAnalysisUi.tabBySupplier },
      ],
    },
    {
      value: 'inventory',
      label: t.reportsCenterUi.familyInventory,
      icon: Package,
      options: [
        { value: 'valuation', label: t.reportsCenterUi.tabStock },
        { value: 'category', label: t.stockValuationUi.byCategory },
        { value: 'movements', label: t.reportsCenterUi.tabMovements },
      ],
    },
    {
      value: 'statistics',
      label: t.reportsCenterUi.familyStatistics,
      icon: Users,
      options: [
        { value: 'top-customers', label: t.statisticsUi.topCustomers },
        { value: 'top-products', label: t.statisticsUi.topProducts },
        { value: 'top-suppliers', label: t.statisticsUi.topSuppliers },
        { value: 'top-users', label: t.statisticsUi.topUsers },
      ],
    },
    { value: 'monthly', label: t.reportsCenterUi.familyMonthly, icon: Calendar },
    {
      value: 'financial',
      label: t.reportsCenterUi.familyFinancial,
      icon: DollarSign,
      options: [
        { value: 'trial-balance', label: t.reportsCenterUi.tabTrialBalance },
        { value: 'income-statement', label: t.reportsCenterUi.tabIncomeStatement },
        { value: 'balance-sheet', label: t.reportsCenterUi.tabBalanceSheet },
        { value: 'vat', label: t.reportsCenterUi.tabVat },
        { value: 'cash-flow', label: t.reportsCenterUi.tabCashFlow },
      ],
    },
    {
      value: 'statements',
      label: t.reportsCenterUi.familyStatements,
      icon: FileText,
      options: [
        { value: 'client-statement', label: t.reportsCenterUi.tabClients },
        { value: 'receivables', label: t.reportsCenterUi.tabReceivables },
        { value: 'supplier-statement', label: t.reportsCenterUi.tabSuppliers },
        { value: 'payables', label: t.reportsCenterUi.tabPayables },
        { value: 'transactions', label: t.reportsCenterUi.tabHistory },
      ],
    },
  ];

  const tabBtnClass = (active: boolean) =>
    `inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-none border-b-2 transition-colors ${
      active
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="flex-1 flex flex-col h-full overflow-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-6 pb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            {t.reportsCenterUi.title}
          </h1>
          <p className="text-muted-foreground">
            {t.reportsCenterUi.subtitle}
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col px-6">
        <div className="w-full flex flex-wrap items-stretch border-b bg-muted/30">
          {families.map((fam) => {
            const Icon = fam.icon;
            const active = activeTab === fam.value;
            if (!fam.options) {
              return (
                <button
                  key={fam.value}
                  type="button"
                  onClick={() => setActiveTab(fam.value)}
                  className={tabBtnClass(active)}
                >
                  <Icon className="w-4 h-4" />
                  {fam.label}
                </button>
              );
            }
            return (
              <DropdownMenu key={fam.value}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActiveTab(fam.value)}
                    className={tabBtnClass(active)}
                  >
                    <Icon className="w-4 h-4" />
                    {fam.label}
                    <ChevronDown className="w-4 h-4 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {fam.options.map((opt) => {
                    const selected = active && views[fam.value] === opt.value;
                    return (
                      <DropdownMenuItem
                        key={opt.value}
                        onSelect={() => {
                          setActiveTab(fam.value);
                          setView(fam.value, opt.value);
                        }}
                        className="flex items-center justify-between"
                      >
                        {opt.label}
                        {selected && <Check className="w-4 h-4 text-primary" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })}
        </div>

        <div className="flex-1 overflow-auto py-4">
          <TabsContent value="overview" className="mt-0 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {reportCategories.map((category) => (
                <Card
                  key={category.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => goToTarget(resolveReportsTab(category.id) ?? { family: category.id })}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-lg ${category.bgColor}`}>
                        <category.icon className={`w-6 h-6 ${category.color}`} />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold">{category.title}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {category.description}
                        </p>
                        <Button variant="link" className="p-0 h-auto mt-2 text-primary">
                          {t.reportsCenterUi.viewReports} <ArrowUpRight className="w-3 h-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>{t.reportsCenterUi.quickSummaryTitle}</CardTitle>
                    <CardDescription>{t.reportsCenterUi.quickSummaryDesc}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleExportOverview}>
                    <Download className="w-4 h-4 mr-2" />
                    {t.reportsCenterUi.exportOverview}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">{t.reportsCenterUi.quickStats.salesMonth}</p>
                    <p className="text-2xl font-bold">{formatCurrency(salesMonth)}</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">{t.reportsCenterUi.quickStats.receivable}</p>
                    <p className="text-2xl font-bold text-blue-500">{formatCurrency(receivable)}</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">{t.reportsCenterUi.quickStats.payable}</p>
                    <p className="text-2xl font-bold text-orange-500">{formatCurrency(payable)}</p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">{t.reportsCenterUi.quickStats.avgMargin}</p>
                    <p className="text-2xl font-bold text-green-500">{avgMargin.toFixed(1)}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sales" className="mt-0">
            <SalesAnalysisReport view={views.sales} onViewChange={(v) => setView('sales', v)} />
          </TabsContent>

          <TabsContent value="purchases" className="mt-0">
            <PurchasesAnalysisReport view={views.purchases} onViewChange={(v) => setView('purchases', v)} />
          </TabsContent>

          <TabsContent value="profit" className="mt-0">
            <ProfitabilityReport view={views.profit} onViewChange={(v) => setView('profit', v)} />
          </TabsContent>

          <TabsContent value="inventory" className="mt-0">
            <InventoryReports view={views.inventory} onViewChange={(v) => setView('inventory', v)} />
          </TabsContent>

          <TabsContent value="statistics" className="mt-0">
            <StatisticsReports view={views.statistics} onViewChange={(v) => setView('statistics', v)} />
          </TabsContent>

          <TabsContent value="monthly" className="mt-0">
            <MonthlyReport />
          </TabsContent>

          <TabsContent value="financial" className="mt-0">
            <FinancialReports view={views.financial} onViewChange={(v) => setView('financial', v)} />
          </TabsContent>

          <TabsContent value="statements" className="mt-0">
            <StatementsReports view={views.statements} onViewChange={(v) => setView('statements', v)} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
