// NEXOR ERP Dashboard - With Real KPIs and Financial Charts
import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { useProducts } from '@/hooks/useERP';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RevenueExpensesChart, CashFlowChart, TopProductsChart,
  ARAgingChart, DailySalesChart, ProfitMarginWidget,
  PaymentMethodChart, StockValuationWidget,
} from '@/components/dashboard/FinancialCharts';
import {
  FileText, ShoppingCart, Package, BarChart3, TrendingUp,
  ArrowRight, ClipboardList, Receipt, DollarSign, FileCheck,
  PieChart, Truck, CheckCircle, Search, BookOpen, ArrowRightLeft,
  Users, Calendar, AlertTriangle, CreditCard, GitBranch,
} from 'lucide-react';
import { Product } from '@/types/erp';
import { NEXOR_STAT_CARD, NEXOR_SECTION_LABEL, NEXOR_TONE_TILE, type NexorTone } from '@/lib/nexorToneStyles';

interface DashboardKPIs {
  todaySales: { count: number; total: number };
  monthSales: { count: number; total: number };
  openAR: { count: number; total: number };
  openAP: { count: number; total: number };
  lowStockCount: number;
  pendingApprovals: number;
  monthExpenses: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentBranch } = useBranchContext();
  const { apiBranchId } = useBranchScope();
  const { language, t } = useTranslation();
  const d = t.dashboardUi;
  const { companyName, logo } = useCompanyLogo();
  const { products } = useProducts(apiBranchId);
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);

  // Fetch real KPIs
  useEffect(() => {
    (async () => {
      try {
        const { api } = await import('@/lib/api/client');
        const result = await api.dashboard.kpis(apiBranchId);
        if (result.data) setKpis(result.data);
      } catch {
        // API not available — use zeros
      }
    })();
  }, [apiBranchId]);

  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const fmt = (n: number) => (n || 0).toLocaleString(locale);

  // Low stock alerts from actual product data
  const lowStockProducts = useMemo(() => {
    return products
      .filter(p => p.isActive && p.minStock && p.minStock > 0 && p.stock <= p.minStock)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 10);
  }, [products]);

  const overstockProducts = useMemo(() => {
    return products
      .filter(p => p.isActive && p.maxStock && p.maxStock > 0 && p.stock > p.maxStock)
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 5);
  }, [products]);

  const documentFlow = useMemo(() => [
    { label: t.documents.proforma, icon: ClipboardList, path: '/proforma' },
    { label: d.documentFlow.salesInvoice, icon: FileText, path: '/invoices' },
    { label: t.documents.receipt, icon: Receipt, path: '/invoices' },
    { label: t.documents.payment, icon: DollarSign, path: '/payments' },
    { label: d.documentFlow.statement, icon: FileCheck, path: '/extracto' },
  ], [t, d]);

  const quickActions = useMemo(() => [
    { label: d.quickActions.posSales, icon: ShoppingCart, path: '/pos', tone: 'sky' as const },
    { label: d.quickActions.invoices, icon: FileText, path: '/invoices', tone: 'indigo' as const },
    { label: d.quickActions.inventory, icon: Package, path: '/inventory', tone: 'emerald' as const },
    { label: d.quickActions.purchases, icon: Truck, path: '/purchase-invoices', tone: 'amber' as const },
    { label: d.quickActions.clients, icon: Users, path: '/clients', tone: 'slate' as const },
    { label: d.quickActions.chartOfAccounts, icon: BookOpen, path: '/chart-of-accounts', tone: 'indigo' as const },
    { label: d.quickActions.transfers, icon: ArrowRightLeft, path: '/stock-transfer', tone: 'emerald' as const },
    { label: d.quickActions.reports, icon: BarChart3, path: '/reports', tone: 'sky' as const },
  ], [d]);

  const biSidebarTone = [
    'bg-slate-50/90 border-slate-200/60 text-slate-700 hover:bg-slate-100/80 [&_svg]:text-slate-500',
    'bg-sky-50/90 border-sky-200/60 text-sky-800 hover:bg-sky-100/80 [&_svg]:text-sky-600',
    'bg-indigo-50/90 border-indigo-200/60 text-indigo-800 hover:bg-indigo-100/80 [&_svg]:text-indigo-600',
    'bg-emerald-50/90 border-emerald-200/60 text-emerald-800 hover:bg-emerald-100/80 [&_svg]:text-emerald-600',
    'bg-amber-50/90 border-amber-200/60 text-amber-900 hover:bg-amber-100/80 [&_svg]:text-amber-700',
    'bg-slate-50/90 border-slate-200/60 text-slate-700 hover:bg-slate-100/80 [&_svg]:text-slate-500',
  ];

  return (
    <div className="h-full flex flex-col lg:flex-row nexor-page-surface">
      <div className="flex-1 p-6 overflow-auto space-y-6">
        {/* Company Header */}
        <div className="flex items-center gap-3">
          {logo && (
            <img src={logo} alt={companyName} className="h-10 object-contain rounded-lg" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-800">{companyName}</h1>
            <p className="text-sm text-slate-500 font-medium">
              {currentBranch?.name || d.headquarters} • {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className={`cursor-pointer ${NEXOR_STAT_CARD} hover:shadow-md transition-shadow`} onClick={() => navigate('/vendas')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium">{d.kpis.salesToday}</span>
                <span className="p-1.5 rounded-lg bg-sky-50"><ShoppingCart className="w-4 h-4 text-sky-600" /></span>
              </div>
              <p className="text-xl font-semibold text-slate-800">{fmt(kpis?.todaySales?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-slate-500">
                {d.kpis.transactions.replace('{count}', String(kpis?.todaySales?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer ${NEXOR_STAT_CARD} hover:shadow-md transition-shadow`} onClick={() => navigate('/reports')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium">{d.kpis.salesMonth}</span>
                <span className="p-1.5 rounded-lg bg-emerald-50"><TrendingUp className="w-4 h-4 text-emerald-600" /></span>
              </div>
              <p className="text-xl font-semibold text-slate-800">{fmt(kpis?.monthSales?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-slate-500">
                {d.kpis.invoicesCount.replace('{count}', String(kpis?.monthSales?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer ${NEXOR_STAT_CARD} hover:shadow-md transition-shadow`} onClick={() => navigate('/payments')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium">{d.kpis.accountsReceivable}</span>
                <span className="p-1.5 rounded-lg bg-amber-50"><CreditCard className="w-4 h-4 text-amber-700" /></span>
              </div>
              <p className="text-xl font-semibold text-slate-800">{fmt(kpis?.openAR?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-slate-500">
                {d.kpis.openItems.replace('{count}', String(kpis?.openAR?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer ${NEXOR_STAT_CARD} hover:shadow-md transition-shadow`} onClick={() => navigate('/payments')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-medium">{d.kpis.accountsPayable}</span>
                <span className="p-1.5 rounded-lg bg-rose-50"><Truck className="w-4 h-4 text-rose-600" /></span>
              </div>
              <p className="text-xl font-semibold text-slate-800">{fmt(kpis?.openAP?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-slate-500">
                {d.kpis.openItems.replace('{count}', String(kpis?.openAP?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Alerts Row */}
        <div className="flex gap-2 flex-wrap">
          {lowStockProducts.length > 0 && (
            <Badge variant="outline" className="cursor-pointer gap-1.5 py-1 bg-amber-50/80 border-amber-200/80 text-amber-800 hover:bg-amber-100/80" onClick={() => navigate('/inventory')}>
              <AlertTriangle className="w-3 h-3" />
              {d.lowStockBadge.replace('{count}', String(lowStockProducts.length))}
            </Badge>
          )}
          {overstockProducts.length > 0 && (
            <Badge variant="outline" className="cursor-pointer gap-1.5 py-1 bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100" onClick={() => navigate('/inventory')}>
              <Package className="w-3 h-3" />
              {d.overstockBadge.replace('{count}', String(overstockProducts.length))}
            </Badge>
          )}
          {(kpis?.pendingApprovals ?? 0) > 0 && (
            <Badge variant="outline" className="cursor-pointer gap-1.5 py-1 bg-indigo-50/80 border-indigo-200/80 text-indigo-700 hover:bg-indigo-100/80" onClick={() => navigate('/approvals')}>
              <GitBranch className="w-3 h-3" />
              {d.pendingApprovals.replace('{count}', String(kpis?.pendingApprovals ?? 0))}
            </Badge>
          )}
          {(kpis?.monthExpenses ?? 0) > 0 && (
            <Badge variant="outline" className="gap-1.5 py-1 bg-slate-50 border-slate-200 text-slate-600">
              <Receipt className="w-3 h-3" />
              {d.monthExpenses.replace('{amount}', fmt(kpis?.monthExpenses ?? 0))}
            </Badge>
          )}
        </div>

        {/* Low Stock Alerts Widget */}
        {lowStockProducts.length > 0 && (
          <Card className="border-amber-200/60 bg-amber-50/30 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> {d.lowStockAlerts}
                </h3>
                <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-600" onClick={() => navigate('/inventory')}>
                  {d.viewAll} →
                </Button>
              </div>
              <div className="space-y-1.5">
                {lowStockProducts.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/70 border border-amber-100/80">
                    <div className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-amber-700" />
                      <span className="font-medium text-slate-700">{p.name}</span>
                      <span className="text-slate-500 font-mono">{p.sku}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-amber-800 font-semibold">{p.stock} {p.unit}</span>
                      <span className="text-slate-500">{d.minLabel} {p.minStock}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Document Flow */}
        <Card className="border-slate-200/80 bg-white/90 shadow-sm overflow-hidden">
          <CardContent className="p-5">
            <h3 className={`${NEXOR_SECTION_LABEL} mb-4`}>{d.documentFlowTitle}</h3>
            <div className="flex items-center justify-between gap-1 flex-wrap">
              {documentFlow.map((step, idx) => (
                <div key={step.label} className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    onClick={() => navigate(step.path)}
                    className="w-full group flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-50/80 hover:bg-slate-100/90 border border-slate-200/60 hover:border-slate-300/80 transition-all duration-200"
                  >
                    <step.icon className="w-5 h-5 text-slate-500 flex-shrink-0 group-hover:text-sky-600 transition-colors" />
                    <span className="text-xs font-medium text-slate-700 truncate">{step.label}</span>
                  </button>
                  {idx < documentFlow.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions Grid */}
        <div>
          <h3 className={`${NEXOR_SECTION_LABEL} mb-4`}>{d.quickAccess}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => navigate(action.path)}
                className={`${NEXOR_TONE_TILE[action.tone as NexorTone]} border p-5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 group text-left`}
              >
                <action.icon className="w-6 h-6 mb-3 transition-transform group-hover:scale-105" />
                <span className="text-sm font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Financial Charts */}
        <div>
          <h3 className={`${NEXOR_SECTION_LABEL} mb-4`}>{d.financialAnalysis}</h3>
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">{d.tabOverview}</TabsTrigger>
              <TabsTrigger value="cashflow">{d.tabCashflow}</TabsTrigger>
              <TabsTrigger value="products">{d.tabProducts}</TabsTrigger>
              <TabsTrigger value="aging">{d.tabAging}</TabsTrigger>
              <TabsTrigger value="payments">{d.tabPayments}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ProfitMarginWidget />
                <StockValuationWidget />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RevenueExpensesChart />
                <DailySalesChart />
              </div>
            </TabsContent>
            <TabsContent value="cashflow">
              <CashFlowChart />
            </TabsContent>
            <TabsContent value="products">
              <TopProductsChart />
            </TabsContent>
            <TabsContent value="aging">
              <ARAgingChart />
            </TabsContent>
            <TabsContent value="payments">
              <PaymentMethodChart />
            </TabsContent>
          </Tabs>
        </div>

        {/* Quick Checks */}
        <div className="flex gap-3 flex-wrap">
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm border-slate-200/80 bg-white/80 text-slate-700 hover:bg-slate-50" onClick={() => navigate('/fiscal-documents')}>
            <CheckCircle className="w-4 h-4 text-slate-500" />
            {d.verifyInvoice}
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm border-slate-200/80 bg-white/80 text-slate-700 hover:bg-slate-50" onClick={() => navigate('/proforma')}>
            <Search className="w-4 h-4 text-slate-500" />
            {d.checkProforma}
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm border-slate-200/80 bg-white/80 text-slate-700 hover:bg-slate-50" onClick={() => navigate('/daily-reports')}>
            <Calendar className="w-4 h-4 text-slate-500" />
            {d.dailyReport}
          </Button>
        </div>
      </div>

      {/* ====== BI SIDEBAR (Right) ====== */}
      <div className="hidden lg:flex w-48 flex-col bg-white/80 border-l border-slate-200/80">
        <div className="p-4 border-b border-slate-200/80">
          <h3 className="font-semibold text-sm text-center tracking-tight text-slate-700">{d.biTitle}</h3>
        </div>
        <div className="flex-1 flex flex-col gap-2 p-3">
          {[
            { label: t.reportsCenterUi.tabTrialBalance, icon: PieChart, path: '/reports' },
            { label: t.nav.invoices, icon: FileText, path: '/invoices' },
            { label: d.bi.salesProfit, icon: TrendingUp, path: '/reports' },
            { label: t.nav.purchaseOrders, icon: Truck, path: '/purchase-invoices' },
            { label: t.nav.taxManagement, icon: Receipt, path: '/tax-management' },
            { label: t.nav.inventory, icon: Package, path: '/inventory' },
          ].map((item, idx) => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-xl border ${biSidebarTone[idx % biSidebarTone.length]} transition-all duration-200 group text-left`}
            >
              <item.icon className="w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-105" />
              <span className="text-xs font-medium leading-tight">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t">
          <Button
            variant="outline"
            className="w-full h-12 text-xs font-bold gap-2 rounded-xl shadow-sm"
            onClick={() => navigate('/chart-of-accounts')}
          >
            <FileCheck className="w-4 h-4" />
            {d.accountsSaft}
          </Button>
        </div>
      </div>
    </div>
  );
}
