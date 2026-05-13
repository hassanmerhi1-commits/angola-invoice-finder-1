// NEXOR ERP Dashboard - With Real KPIs and Financial Charts
import { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranchContext } from '@/contexts/BranchContext';
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
  const { language, t } = useTranslation();
  const { companyName, logo } = useCompanyLogo();
  const { products } = useProducts(currentBranch?.id);
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);

  // Fetch real KPIs
  useEffect(() => {
    (async () => {
      try {
        const { api } = await import('@/lib/api/client');
        const result = await api.dashboard.kpis(currentBranch?.id);
        if (result.data) setKpis(result.data);
      } catch {
        // API not available — use zeros
      }
    })();
  }, [currentBranch?.id]);

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
    { label: t.dashboardUi.documentFlow.salesInvoice, icon: FileText, path: '/invoices' },
    { label: t.documents.receipt, icon: Receipt, path: '/invoices' },
    { label: t.documents.payment, icon: DollarSign, path: '/payments' },
    { label: t.dashboardUi.documentFlow.statement, icon: FileCheck, path: '/extracto' },
  ], [t]);

  const quickActions = useMemo(() => [
    { label: t.dashboardUi.quickActions.posSales, icon: ShoppingCart, path: '/pos', gradient: 'gradient-primary' },
    { label: t.dashboardUi.quickActions.invoices, icon: FileText, path: '/invoices', gradient: 'gradient-accent' },
    { label: t.dashboardUi.quickActions.inventory, icon: Package, path: '/inventory', gradient: 'gradient-success' },
    { label: t.dashboardUi.quickActions.purchases, icon: Truck, path: '/purchase-orders', gradient: 'gradient-warm' },
    { label: t.dashboardUi.quickActions.clients, icon: Users, path: '/clients', gradient: 'gradient-primary' },
    { label: t.dashboardUi.quickActions.chartOfAccounts, icon: BookOpen, path: '/chart-of-accounts', gradient: 'gradient-accent' },
    { label: t.dashboardUi.quickActions.transfers, icon: ArrowRightLeft, path: '/stock-transfer', gradient: 'gradient-success' },
    { label: t.dashboardUi.quickActions.reports, icon: BarChart3, path: '/reports', gradient: 'gradient-warm' },
  ], [t]);

  return (
    <div className="h-full flex flex-col lg:flex-row">
      <div className="flex-1 p-6 overflow-auto space-y-6">
        {/* Company Header */}
        <div className="flex items-center gap-3">
          {logo && (
            <img src={logo} alt={companyName} className="h-10 object-contain rounded-lg" />
          )}
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-gradient">{companyName}</h1>
            <p className="text-sm text-muted-foreground font-medium">
              {currentBranch?.name || t.dashboardUi.headquarters} • {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/vendas')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">{t.dashboardUi.kpis.salesToday}</span>
                <ShoppingCart className="w-4 h-4 text-primary" />
              </div>
              <p className="text-xl font-bold">{fmt(kpis?.todaySales?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-muted-foreground">
                {t.dashboardUi.kpis.transactions.replace('{count}', String(kpis?.todaySales?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/reports')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">{t.dashboardUi.kpis.salesMonth}</span>
                <TrendingUp className="w-4 h-4 text-green-600" />
              </div>
              <p className="text-xl font-bold">{fmt(kpis?.monthSales?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-muted-foreground">
                {t.dashboardUi.kpis.invoicesCount.replace('{count}', String(kpis?.monthSales?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/payments')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">{t.dashboardUi.kpis.accountsReceivable}</span>
                <CreditCard className="w-4 h-4 text-orange-500" />
              </div>
              <p className="text-xl font-bold text-orange-600">{fmt(kpis?.openAR?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-muted-foreground">
                {t.dashboardUi.kpis.openItems.replace('{count}', String(kpis?.openAR?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/payments')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground font-medium">Contas a Pagar</span>
                <Truck className="w-4 h-4 text-destructive" />
              </div>
              <p className="text-xl font-bold text-destructive">{fmt(kpis?.openAP?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-muted-foreground">{kpis?.openAP?.count ?? 0} itens abertos</p>
            </CardContent>
          </Card>
        </div>

        {/* Alerts Row */}
        <div className="flex gap-2 flex-wrap">
          {lowStockProducts.length > 0 && (
            <Badge variant="destructive" className="cursor-pointer gap-1.5 py-1" onClick={() => navigate('/inventory')}>
              <AlertTriangle className="w-3 h-3" />
              {lowStockProducts.length} produtos com stock baixo
            </Badge>
          )}
          {overstockProducts.length > 0 && (
            <Badge variant="outline" className="cursor-pointer gap-1.5 py-1 border-amber-300 text-amber-600" onClick={() => navigate('/inventory')}>
              <Package className="w-3 h-3" />
              {overstockProducts.length} produtos acima do máximo
            </Badge>
          )}
          {(kpis?.pendingApprovals ?? 0) > 0 && (
            <Badge variant="outline" className="cursor-pointer gap-1.5 py-1 border-orange-300 text-orange-600" onClick={() => navigate('/approvals')}>
              <GitBranch className="w-3 h-3" />
              {kpis?.pendingApprovals} aprovações pendentes
            </Badge>
          )}
          {(kpis?.monthExpenses ?? 0) > 0 && (
            <Badge variant="secondary" className="gap-1.5 py-1">
              <Receipt className="w-3 h-3" />
              Despesas mês: {fmt(kpis?.monthExpenses ?? 0)} Kz
            </Badge>
          )}
        </div>

        {/* Low Stock Alerts Widget */}
        {lowStockProducts.length > 0 && (
          <Card className="border-destructive/30">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-destructive uppercase tracking-widest flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Alertas de Stock Baixo
                </h3>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => navigate('/inventory')}>
                  Ver todos →
                </Button>
              </div>
              <div className="space-y-1.5">
                {lowStockProducts.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs p-2 rounded bg-destructive/5">
                    <div className="flex items-center gap-2">
                      <Package className="w-3.5 h-3.5 text-destructive" />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-muted-foreground font-mono">{p.sku}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-destructive font-bold">{p.stock} {p.unit}</span>
                      <span className="text-muted-foreground">min: {p.minStock}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Document Flow */}
        <Card className="shadow-card overflow-hidden">
          <CardContent className="p-5">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Fluxo Documental</h3>
            <div className="flex items-center justify-between gap-1 flex-wrap">
              {documentFlow.map((step, idx) => (
                <div key={step.label} className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    onClick={() => navigate(step.path)}
                    className="w-full group flex items-center gap-2.5 px-4 py-3 rounded-xl bg-accent/50 hover:bg-accent border border-transparent hover:border-primary/20 transition-all duration-200 hover:shadow-md"
                  >
                    <step.icon className="w-5 h-5 text-primary flex-shrink-0 group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold truncate">{step.label}</span>
                  </button>
                  {idx < documentFlow.length - 1 && (
                    <ArrowRight className="w-4 h-4 text-primary/40 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions Grid */}
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Acesso Rápido</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => navigate(action.path)}
                className={`${action.gradient} p-5 rounded-2xl text-white shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 group text-left`}
              >
                <action.icon className="w-7 h-7 mb-3 opacity-90 group-hover:scale-110 transition-transform" />
                <span className="text-sm font-bold">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Financial Charts */}
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Análise Financeira</h3>
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList>
              <TabsTrigger value="overview">Visão Geral</TabsTrigger>
              <TabsTrigger value="cashflow">Fluxo Caixa</TabsTrigger>
              <TabsTrigger value="products">Produtos</TabsTrigger>
              <TabsTrigger value="aging">Aging AR</TabsTrigger>
              <TabsTrigger value="payments">Pagamentos</TabsTrigger>
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
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm" onClick={() => navigate('/fiscal-documents')}>
            <CheckCircle className="w-4 h-4 text-primary" />
            Verificar Fatura
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm" onClick={() => navigate('/proforma')}>
            <Search className="w-4 h-4 text-primary" />
            Check Proforma
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm" onClick={() => navigate('/daily-reports')}>
            <Calendar className="w-4 h-4 text-primary" />
            Relatório Diário
          </Button>
        </div>
      </div>

      {/* ====== BI SIDEBAR (Right) ====== */}
      <div className="hidden lg:flex w-48 flex-col bg-card border-l">
        <div className="p-4 border-b">
          <h3 className="font-extrabold text-sm text-center tracking-tight">Business Intelligence</h3>
        </div>
        <div className="flex-1 flex flex-col gap-2 p-3">
          {[
            { label: t.reportsCenterUi.tabTrialBalance, icon: PieChart, path: '/reports', color: 'bg-primary/10 text-primary' },
            { label: t.nav.invoices, icon: FileText, path: '/invoices', color: 'bg-green-500/10 text-green-600' },
            { label: t.dashboardUi.bi.salesProfit, icon: TrendingUp, path: '/reports', color: 'bg-orange-500/10 text-orange-600' },
            { label: t.nav.purchaseOrders, icon: Truck, path: '/purchase-orders', color: 'bg-blue-500/10 text-blue-600' },
            { label: t.nav.taxManagement, icon: Receipt, path: '/tax-management', color: 'bg-destructive/10 text-destructive' },
            { label: t.nav.inventory, icon: Package, path: '/inventory', color: 'bg-primary/10 text-primary' },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-3 px-4 py-4 rounded-xl ${item.color} hover:shadow-md transition-all duration-200 group text-left`}
            >
              <item.icon className="w-6 h-6 flex-shrink-0 group-hover:scale-110 transition-transform" />
              <span className="text-sm font-bold leading-tight">{item.label}</span>
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
            CONTAS / SAF-T
          </Button>
        </div>
      </div>
    </div>
  );
}
