// NEXOR ERP Dashboard - With Real KPIs and Financial Charts
import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranchContext } from '@/contexts/BranchContext';
import { useBranchScope } from '@/hooks/useBranchScope';
import { useTranslation } from '@/i18n';
import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText, ShoppingCart, Package, BarChart3, TrendingUp,
  ArrowRight, ClipboardList, Receipt, DollarSign, FileCheck,
  PieChart, Truck, CheckCircle, Search, BookOpen, ArrowRightLeft,
  Users, Calendar, CreditCard, GitBranch,
} from 'lucide-react';
import { type NexorTone } from '@/lib/nexorToneStyles';
import { useThemePreset } from '@/themes/colorTheme';

const DashboardChartsSection = lazy(() => import('@/components/dashboard/DashboardChartsSection'));

interface DashboardKPIs {
  todaySales: { count: number; total: number };
  monthSales: { count: number; total: number };
  openAR: { count: number; total: number };
  openAP: { count: number; total: number };
  lowStockCount: number;
  pendingApprovals: number;
  monthExpenses: number;
}

// Session-scoped SWR for KPIs: paint last values instantly, refresh in background.
const KPI_CACHE_TTL_MS = 30_000;
const kpiCache = new Map<string, { at: number; kpis: DashboardKPIs | null }>();

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentBranch } = useBranchContext();
  const { apiBranchId } = useBranchScope();
  const { language, t } = useTranslation();
  const d = t.dashboardUi;
  const { companyName, logo } = useCompanyLogo();
  const theme = useThemePreset();
  const themeChrome = theme.chrome;
  const cacheKey = String(apiBranchId || 'all');
  const cached = kpiCache.get(cacheKey);
  const [kpis, setKpis] = useState<DashboardKPIs | null>(cached?.kpis ?? null);

  // Fetch real KPIs (warm-start from cache; skip network while fresh)
  useEffect(() => {
    const entry = kpiCache.get(cacheKey);
    if (entry?.kpis) setKpis(entry.kpis);
    if (entry && Date.now() - entry.at < KPI_CACHE_TTL_MS) return;
    (async () => {
      try {
        const { api } = await import('@/lib/api/client');
        const result = await api.dashboard.kpis(apiBranchId);
        if (result.data) {
          setKpis(result.data);
          kpiCache.set(cacheKey, { at: Date.now(), kpis: result.data });
        }
      } catch {
        // API not available — use zeros
      }
    })();
  }, [apiBranchId, cacheKey]);

  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';
  const fmt = (n: number) => (n || 0).toLocaleString(locale);

  const documentFlow = useMemo(() => [
    { label: t.documents.proforma, icon: ClipboardList, path: '/proforma' },
    { label: d.documentFlow.salesInvoice, icon: FileText, path: '/invoices' },
    { label: t.documents.receipt, icon: Receipt, path: '/payments' },
    { label: d.documentFlow.supplierPayments, icon: DollarSign, path: '/payments' },
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
    theme.toneTile.slate,
    theme.toneTile.sky,
    theme.toneTile.indigo,
    theme.toneTile.emerald,
    theme.toneTile.amber,
    theme.toneTile.slate,
  ];

  return (
    <div className="h-full flex flex-col lg:flex-row nexor-page-surface">
      <div className={themeChrome.dashboardSurface}>
        {/* Company Header */}
        <div className="flex items-center gap-3">
          {logo && (
            <img src={logo} alt={companyName} className="h-10 object-contain rounded-lg" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{companyName}</h1>
            <p className="text-sm text-muted-foreground font-medium">
              {currentBranch?.name || d.headquarters} • {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className={`cursor-pointer ${theme.statCardTone.sky} hover:shadow-md transition-shadow`} onClick={() => navigate('/vendas')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-primary/80 font-medium">{d.kpis.salesToday}</span>
                <span className="p-1.5 rounded-lg bg-primary/10"><ShoppingCart className="w-4 h-4 text-primary" /></span>
              </div>
              <p className="text-xl font-semibold text-foreground">{fmt(kpis?.todaySales?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-primary/70">
                {d.kpis.transactions.replace('{count}', String(kpis?.todaySales?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer ${theme.statCardTone.emerald} hover:shadow-md transition-shadow`} onClick={() => navigate('/reports')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-success font-medium">{d.kpis.salesMonth}</span>
                <span className="p-1.5 rounded-lg bg-success/15"><TrendingUp className="w-4 h-4 text-success" /></span>
              </div>
              <p className="text-xl font-semibold text-foreground">{fmt(kpis?.monthSales?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-success/80">
                {d.kpis.invoicesCount.replace('{count}', String(kpis?.monthSales?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer ${theme.statCardTone.amber} hover:shadow-md transition-shadow`} onClick={() => navigate('/receivables')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-warning-foreground font-medium">{d.kpis.accountsReceivable}</span>
                <span className="p-1.5 rounded-lg bg-warning/15"><CreditCard className="w-4 h-4 text-warning" /></span>
              </div>
              <p className="text-xl font-semibold text-foreground">{fmt(kpis?.openAR?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-warning-foreground/70">
                {d.kpis.openItems.replace('{count}', String(kpis?.openAR?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer ${theme.statCardTone.rose} hover:shadow-md transition-shadow`} onClick={() => navigate('/payables')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-rose-600 font-medium">{d.kpis.accountsPayable}</span>
                <span className="p-1.5 rounded-lg bg-rose-500/15"><Truck className="w-4 h-4 text-rose-600" /></span>
              </div>
              <p className="text-xl font-semibold text-foreground">{fmt(kpis?.openAP?.total ?? 0)} Kz</p>
              <p className="text-[10px] text-rose-600/70">
                {d.kpis.openItems.replace('{count}', String(kpis?.openAP?.count ?? 0))}
              </p>
            </CardContent>
          </Card>
        </div>

        {((kpis?.pendingApprovals ?? 0) > 0 || (kpis?.monthExpenses ?? 0) > 0) && (
        <div className="flex gap-2 flex-wrap">
          {(kpis?.pendingApprovals ?? 0) > 0 && (
            <Badge variant="outline" className="cursor-pointer gap-1.5 py-1 bg-indigo-500/10 border-indigo-400/30 text-indigo-700 hover:bg-indigo-500/15" onClick={() => navigate('/approvals')}>
              <GitBranch className="w-3 h-3" />
              {d.pendingApprovals.replace('{count}', String(kpis?.pendingApprovals ?? 0))}
            </Badge>
          )}
          {(kpis?.monthExpenses ?? 0) > 0 && (
            <Badge variant="outline" className="gap-1.5 py-1 bg-muted border-border text-muted-foreground">
              <Receipt className="w-3 h-3" />
              {d.monthExpenses.replace('{amount}', fmt(kpis?.monthExpenses ?? 0))}
            </Badge>
          )}
        </div>
        )}

        {/* Document Flow */}
        <Card className={themeChrome.documentFlowCard}>
          <CardContent className="p-5">
            <h3 className={`${theme.sectionLabel} mb-4`}>{d.documentFlowTitle}</h3>
            <div className="flex items-center justify-between gap-1 flex-wrap">
              {documentFlow.map((step, idx) => (
                <div key={step.label} className="flex items-center gap-2 flex-1 min-w-0">
                  <button
                    onClick={() =>
                      navigate(step.path, 'state' in step && step.state ? { state: step.state } : undefined)
                    }
                    className={`w-full group flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all duration-200 ${theme.flowStep[idx % theme.flowStep.length]}`}
                  >
                    <step.icon className="w-5 h-5 flex-shrink-0 transition-colors" />
                    <span className="text-xs font-semibold truncate">{step.label}</span>
                  </button>
                  {idx < documentFlow.length - 1 && (
                    <ArrowRight className={themeChrome.documentFlowArrow} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions Grid */}
        <div>
          <h3 className={`${theme.sectionLabel} mb-4`}>{d.quickAccess}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => navigate(action.path)}
                className={`${theme.toneTile[action.tone as NexorTone]} border p-5 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 group text-left`}
              >
                <action.icon className="w-6 h-6 mb-3 transition-transform group-hover:scale-105" />
                <span className="text-sm font-medium">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Financial Charts — lazy chunk so recharts doesn't block the KPI paint */}
        <div>
          <h3 className={`${theme.sectionLabel} mb-4`}>{d.financialAnalysis}</h3>
          <Suspense fallback={<div className="h-64 rounded-xl bg-muted/50 border border-border animate-pulse" />}>
            <DashboardChartsSection />
          </Suspense>
        </div>

        {/* Quick Checks */}
        <div className="flex gap-3 flex-wrap">
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm border-border bg-card/80 text-foreground hover:bg-accent" onClick={() => navigate('/fiscal-documents')}>
            <CheckCircle className="w-4 h-4 text-muted-foreground" />
            {d.verifyInvoice}
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm border-border bg-card/80 text-foreground hover:bg-accent" onClick={() => navigate('/proforma')}>
            <Search className="w-4 h-4 text-muted-foreground" />
            {d.checkProforma}
          </Button>
          <Button variant="outline" className="rounded-xl gap-2 shadow-sm border-border bg-card/80 text-foreground hover:bg-accent" onClick={() => navigate('/daily-reports')}>
            <Calendar className="w-4 h-4 text-muted-foreground" />
            {d.dailyReport}
          </Button>
        </div>
      </div>

      {/* ====== BI SIDEBAR (Right) ====== */}
      <div className="hidden lg:flex w-48 flex-col bg-card/70 border-l border-border backdrop-blur-xl">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-sm text-center tracking-tight text-foreground">{d.biTitle}</h3>
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

        <div className="p-3 border-t border-border">
          <button
            type="button"
            onClick={() => navigate('/chart-of-accounts')}
            className={theme.toolbar.feature}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 group-hover:bg-primary/25 transition-colors">
              <BookOpen className="w-4 h-4 text-primary" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="text-[11px] font-semibold tracking-tight text-foreground">{t.nav.chartOfAccounts}</span>
              <span className="text-[10px] font-medium text-primary">SAF-T</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
